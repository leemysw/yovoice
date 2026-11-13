import { test, expect, type Locator } from '@playwright/test';
import { seedState } from './seed';
import { saveAsCharacter } from './project-actions';
import { SubtitleParser } from '../src/features/create/subtitle-parser';
import { emptyState, synthesisSettings } from '../src/shared/workbench';

test('字幕格式保留时间、人名和多行文本，拒绝损坏输入', () => {
  const parser = new SubtitleParser();
  const srt = parser.parse('test.srt', '\uFEFF1\r\n00:00:01,000 --> 00:00:03,000\r\n你好\r\n世界\r\n\r\n2\r\n00:00:04,000 --> 00:00:05,000\r\n再见');
  expect(srt.speakers).toHaveLength(1);
  expect(srt.cues[0]).toMatchObject({ start: 1000, end: 3000, text: '你好\n世界' });
  const vtt = parser.parse('test.vtt', 'WEBVTT\n\nNOTE ignored\nhello\n\nid\n00:01.000 --> 00:02.500 align:start\n<v Alice><b>Hello &amp; hi</b></v>\n<v Bob>你好</v>\n\n00:03.000 --> 00:04.000\n<v Alice>Again');
  expect(vtt.speakers.map(s => s.sourceName)).toEqual(['Alice', 'Bob']);
  expect(vtt.cues.map(c => c.speakerId)).toEqual(['1', '2', '1']);
  expect(vtt.cues[0].text).toBe('Hello & hi');
  for (const extension of ['ass', 'ssa']) {
    const ass = parser.parse('test.' + extension, '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:02.50,Default,Alice,0,0,0,,{\\i1}Hi,there\\N你好\nComment: ignored');
    expect(ass.speakers[0].sourceName).toBe('Alice');
    expect(ass.cues[0].text).toBe('Hi,there\n你好');
  }
  for (const source of ['', 'garbage', '1\n00:99:00,000 --> 00:00:03,000\nHi', '1\n00:00:03,000 --> 00:00:01,000\nHi']) expect(() => parser.parse('bad.srt', source)).toThrow();
  expect(() => parser.parse('bad.srt', `1\n00:00:01,000 --> 00:00:02,000\n${'x'.repeat(12001)}`)).toThrow();
});

test('导入新作品、统一角色映射、逐句分配和重载持久化', async ({ page }, testInfo) => {
  const state = emptyState();
  state.characters = [{ id: 'a'.repeat(32), name: '旁白角色', settings: { ...synthesisSettings(state.drafts[0]), modelId: 'voxcpm2-q8', voiceDescription: '温柔' }, demoText: '' }];
  // 模型和推理引擎都已就绪，下面按编辑区自身的布局对齐。
  state.models = [{ id: 'index-2.5-q8', path: 'index-2.5-q8.gguf', managed: true }, { id: 'voxcpm2-q8', path: 'voxcpm2-q8.gguf', managed: true }];
  Object.assign(state, { runtimePath: 'runtime', runtimeBackend: 'cpu', runtimeVersion: '1.0.0' });
  await page.goto('/');
  await seedState(page, state);
  await page.reload();
  await page.getByTestId('nav-new').click();
  await page.getByRole('menuitem', { name: '故事配音', exact: true }).click();
  await page.locator('.editor-status').getByLabel('字幕文件').setInputFiles({ name: '对话.vtt', mimeType: 'text/vtt', buffer: Buffer.from('WEBVTT\n\n00:00.000 --> 00:01.000\n<v Alice>你好\n\n00:01.000 --> 00:02.000\n<v Bob>再见') });
  await expect(page.getByLabel('作品名称')).toHaveValue('对话');
  await page.getByRole('button', { name: '说话人设置', exact: true }).click();
  const speaker = page.getByRole('combobox', { name: '说话人 1 (Alice)', exact: true });
  await speaker.click();
  await page.getByRole('option', { name: '旁白角色', exact: true }).click();
  await page.getByRole('button', { name: '添加说话人' }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '第 2 句说话人', exact: true }).click();
  await page.getByRole('menuitem', { name: /^说话人 3/ }).click();
  await page.getByLabel('第 2 句台词', { exact: true }).fill('改过的台词');
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('第 2 句台词', { exact: true })).toHaveValue('改过的台词');
  await page.getByRole('button', { name: '说话人设置', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '说话人 1 (Alice)', exact: true })).toContainText('旁白角色');
  await page.keyboard.press('Escape');
  await expect(page.locator('.subtitle-time')).toHaveCount(0);
  await page.getByRole('button', { name: '显示时间', exact: true }).click();
  await expect(page.locator('.subtitle-time')).toHaveCount(2);
  await page.getByRole('button', { name: '隐藏时间', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '说话人 1 (Alice)', exact: true })).toHaveCount(0);
  // 关闭浮层和切换时间列后布局还在过渡，等位置稳定再比对齐。
  const offset = async (a: Locator, b: Locator) => {
    const [boxA, boxB] = [await a.boundingBox(), await b.boundingBox()];
    return Math.abs(boxA!.y + boxA!.height / 2 - boxB!.y - boxB!.height / 2);
  };
  await expect.poll(() => offset(page.getByLabel('作品名称'), page.getByTestId('nav-new'))).toBeLessThan(2);
  await expect.poll(() => offset(page.getByLabel('第 1 句台词', { exact: true }), page.locator('.nav-item').first())).toBeLessThan(2);
  const cueBox = await page.locator('.subtitle-cue').first().boundingBox();
  expect(cueBox!.height).toBeLessThan(60);
  await page.screenshot({ path: testInfo.outputPath('subtitle-editor.png') });
  await page.setViewportSize({ width: 600, height: 820 });
  await expect(page.getByLabel('第 1 句台词', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '导入字幕', exact: true })).toBeInViewport();
  const longText = '这是一段用于检查窄窗口下自动换行的台词。'.repeat(8);
  const firstCue = page.getByLabel('第 1 句台词', { exact: true });
  await firstCue.fill(longText);
  // 高度变化带过渡，等过渡结束再比对。
  await expect.poll(() => firstCue.evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
  await firstCue.fill('你好');
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('subtitle-editor-narrow.png') });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1')!).drafts);
  expect(saved).toHaveLength(3);
  expect(saved[2].text).toBe(state.drafts[0].text);
  expect(saved[0].subtitles.speakers[0].settings.voiceDescription).toBe('温柔');
  expect(saved[0].subtitles.cues[1].speakerId).toBe(saved[0].subtitles.speakers[2].id);
  await page.locator('.editor-status').getByLabel('字幕文件').setInputFiles({ name: 'bad.srt', mimeType: 'text/plain', buffer: Buffer.from('invalid') });
  await expect(page.getByRole('alert')).toContainText('字幕格式或内容无效');
  await expect(page.getByLabel('第 2 句台词', { exact: true })).toHaveValue('改过的台词');
});

test('选择台词编辑对应说话人，末尾新增继承上一句并持久化', async ({ page }, testInfo) => {
  const state = emptyState();
  const draft = state.drafts[0];
  Object.assign(draft, { modelId: 'voxcpm2-q8', voxMode: 'design', voiceDescription: '默认声音', text: '第一句\n第二句\n第三句' });
  draft.subtitles = {
    speakers: [{ id: '1', sourceName: 'Alice' }, { id: '2', sourceName: 'Bob', settings: { ...synthesisSettings(draft), voiceDescription: '低沉' } }],
    cues: ['1', '2', '1'].map((speakerId, index) => ({ start: index * 1000, end: (index + 1) * 1000, text: ['第一句', '第二句', '第三句'][index], speakerId })),
  };
  await page.goto('/');
  await seedState(page, state);
  await page.reload();
  await page.getByLabel('第 1 句台词', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Alice', exact: true })).toBeVisible();
  await page.getByLabel('声音描述', { exact: true }).fill('温柔清亮');
  await page.getByLabel('第 2 句台词', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Bob', exact: true })).toBeVisible();
  await expect(page.getByLabel('声音描述', { exact: true })).toHaveValue('低沉');
  await page.getByLabel('第 3 句台词', { exact: true }).click();
  await expect(page.getByLabel('声音描述', { exact: true })).toHaveValue('温柔清亮');
  await page.getByRole('button', { name: '新增台词', exact: true }).click();
  const added = page.getByLabel('第 4 句台词', { exact: true });
  await expect(added).toBeFocused();
  await expect(page.getByRole('button', { name: '生成语音', exact: true })).toBeEnabled();
  await added.fill('新增的一句');
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('speaker-inspector.png') });
  await page.reload();
  await page.getByLabel('第 4 句台词', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Alice', exact: true })).toBeVisible();
  await expect(page.getByLabel('声音描述', { exact: true })).toHaveValue('温柔清亮');
  await page.getByRole('button', { name: '第 4 句说话人', exact: true }).click();
  await page.getByRole('menuitem', { name: /^说话人 2 Bob/ }).click();
  await expect(page.getByRole('heading', { name: 'Bob', exact: true })).toBeVisible();
  await expect(page.getByLabel('声音描述', { exact: true })).toHaveValue('低沉');
  await page.getByRole('button', { name: '第 4 句说话人', exact: true }).click();
  await page.getByRole('menuitem', { name: /^说话人 1 Alice/ }).click();
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1')!).drafts[0]);
  expect(saved.voiceDescription).toBe('默认声音');
  expect(saved.subtitles.speakers[1].settings.voiceDescription).toBe('低沉');
  expect(saved.subtitles.cues[3].speakerId).toBe('1');
  expect(saved.text).toBe('第一句\n第二句\n第三句\n新增的一句');

  // 说话人的声音设置也能在角色选择里直接存为角色，保存后应用到该说话人。
  await page.getByLabel('第 2 句台词', { exact: true }).click();
  await saveAsCharacter(page);
  const editor = page.getByTestId('character-editor');
  await expect(editor.getByLabel('角色名称')).toHaveValue('Bob');
  await editor.getByRole('button', { name: '保存并应用', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('voice-workbench-v1')!);
    return state.characters.length === 1 && state.drafts[0].subtitles.speakers[1].characterId === state.characters[0].id;
  })).toBe(true);
});

