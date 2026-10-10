import { test, expect } from '@playwright/test';
import { seedState } from './seed';
import { cueAudioStatus, cueSettings, emptyState, synthesisSettings } from '../src/shared/workbench';

test('角色多种演绎独立配置，逐句选择与修改互不影响并持久化', async ({ page }, info) => {
  const state = emptyState();
  const draft = state.drafts[0];
  const settings = synthesisSettings(draft);
  state.characters = [{ id: 'a'.repeat(32), name: '孙悟空', settings, demoText: '师父，别怕。' }];
  draft.kind = 'story'; draft.title = '演绎测试'; draft.text = '师父，别怕。\n妖怪，站住！';
  draft.subtitles = { speakers: [{ id: 'monkey', sourceName: '悟空', characterId: state.characters[0].id, settings }], cues: [
    { id: 'first', start: 0, end: 1000, text: '师父，别怕。', speakerId: 'monkey' },
    { id: 'second', start: 1000, end: 2000, text: '妖怪，站住！', speakerId: 'monkey' },
  ] };
  await page.goto('/');
  await seedState(page, state);
  await page.reload();
  await page.getByTestId('nav-characters').click();
  await page.getByRole('button', { name: '编辑角色', exact: true }).click();
  const editor = page.getByTestId('character-editor');
  await editor.getByRole('button', { name: '新增演绎', exact: true }).click();
  await expect(editor.getByLabel('演绎名称', { exact: true })).toHaveCount(0);
  await editor.getByRole('button', { name: '演绎操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '重命名演绎', exact: true }).click();
  await page.getByLabel('演绎名称', { exact: true }).fill('愤怒');
  await page.getByRole('button', { name: '重命名演绎', exact: true }).click();
  await editor.getByLabel('情绪描述', { exact: true }).fill('愤怒，坚定地大声说话');
  await expect(editor.getByRole('combobox', { name: '模型', exact: true })).toBeVisible();
  await expect(editor.getByRole('button', { name: '添加参考音频', exact: true })).toBeVisible();
  await editor.getByRole('button', { name: '新增演绎', exact: true }).click();
  await expect(editor.getByLabel('演绎名称', { exact: true })).toHaveCount(0);
  await editor.getByRole('button', { name: '演绎操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '重命名演绎', exact: true }).click();
  await page.getByLabel('演绎名称', { exact: true }).fill('温柔');
  await page.getByRole('button', { name: '重命名演绎', exact: true }).click();
  await editor.getByLabel('情绪描述', { exact: true }).fill('温柔，轻声安慰');
  const selectorBox = await editor.getByRole('combobox', { name: '演绎方式', exact: true }).evaluate(element => element.closest('.astryx-selector')!.getBoundingClientRect().toJSON());
  for (const name of ['新增演绎', '演绎操作']) {
    const box = (await editor.getByRole('button', { name, exact: true }).boundingBox())!;
    expect(Math.abs(box.y - selectorBox.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.height - selectorBox.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.width - box.height)).toBeLessThanOrEqual(1);
  }
  await page.screenshot({ path: info.outputPath('character-performances.png') });
  await editor.getByRole('button', { name: '保存角色', exact: true }).click();
  await page.locator('.recent-projects .project-link').first().click();
  const choose = async (name: string) => {
    await page.getByRole('combobox', { name: '演绎方式', exact: true }).click();
    await page.getByRole('option', { name, exact: true }).click();
  };
  await page.getByLabel('第 1 句台词', { exact: true }).click();
  await choose('温柔');
  await page.getByLabel('第 2 句台词', { exact: true }).click();
  await choose('愤怒');
  await page.getByLabel('情绪描述', { exact: true }).fill('愤怒地质问');
  await page.getByLabel('第 1 句台词', { exact: true }).click();
  await expect(page.getByLabel('情绪描述', { exact: true })).toHaveValue('温柔，轻声安慰');
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByLabel('第 2 句台词', { exact: true }).click();
  await expect(page.getByLabel('情绪描述', { exact: true })).toHaveValue('愤怒地质问');
  await page.screenshot({ path: info.outputPath('cue-performance.png') });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1')!));
  expect(saved.characters[0].performances[0].settings.emotionText).toBe('愤怒，坚定地大声说话');
  expect(saved.drafts[0].subtitles.speakers[0].settings.emotionText).toBe(settings.emotionText);
  await choose('默认演绎');
  await expect(page.getByLabel('情绪描述', { exact: true })).toHaveValue(settings.emotionText);
  // 库中删除演绎后，已经应用到台词的快照仍可使用。
  await page.getByTestId('nav-characters').click();
  await page.getByRole('button', { name: '编辑角色', exact: true }).click();
  await editor.getByRole('combobox', { name: '演绎方式', exact: true }).click();
  await page.getByRole('option', { name: '温柔', exact: true }).click();
  await editor.getByRole('button', { name: '演绎操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '删除演绎', exact: true }).click();
  await editor.getByRole('button', { name: '保存角色', exact: true }).click();
  await page.locator('.recent-projects .project-link').first().click();
  await page.getByLabel('第 1 句台词', { exact: true }).click();
  await expect(page.getByRole('combobox', { name: '演绎方式', exact: true })).toContainText('温柔');
  await expect(page.getByLabel('情绪描述', { exact: true })).toHaveValue('温柔，轻声安慰');
});

// 后端省略空可选字段时，演绎快照仍应正确识别已生成音频。
test('演绎音频状态与后端可选字段一致', () => {
  const d = emptyState().drafts[0];
  const p = { id: 'p', name: '愤怒', settings: { ...synthesisSettings(d), emotionText: '愤怒' } };
  const cue = { id: 'c', start: 0, end: 1000, text: '站住', speakerId: 's', performance: p };
  d.subtitles = { speakers: [{ id: 's', sourceName: '悟空', settings: synthesisSettings(d) }], cues: [cue] };
  d.timeline = { tracks: [{ id: 't', name: '音轨', muted: false, clips: [{ id: 'clip', generationId: 'g', start: 0, offset: 0, duration: 1 }] }] };
  const generation = { id: 'g', title: '', fileName: '', duration: 1, createdAt: '', settings: { ...d, ...JSON.parse(JSON.stringify(cueSettings(d, cue))), subtitles: undefined, text: cue.text }, segment: { cueId: 'c', speakerId: 's', speakerName: '', batchId: '', index: 0 } };
  expect(cueAudioStatus(d, [generation], cue)).toBe('ready');
  cue.performance.settings.emotionText = '温柔';
  expect(cueAudioStatus(d, [generation], cue)).toBe('stale');
});

test('语音项目选择独立模型演绎并支持回到默认', async ({ page }) => {
  const state = emptyState();
  const d = state.drafts[0];
  d.modelId = 'index-2.5-q8'; d.speaker = 'Vivian'; d.voiceDescription = '平静'; d.characterId = 'b'.repeat(32);
  state.characters = [{ id: d.characterId, name: '薇薇安', demoText: '', settings: synthesisSettings(d), performances: [{ id: 'c'.repeat(32), name: '开心', settings: synthesisSettings(d) }] }];
  await page.goto('/');
  await seedState(page, state);
  await page.reload();
  await page.getByTestId('nav-characters').click();
  await page.getByRole('button', { name: '编辑角色', exact: true }).click();
  const editor = page.getByTestId('character-editor');
  await editor.getByRole('combobox', { name: '演绎方式', exact: true }).click();
  await page.getByRole('option', { name: '开心', exact: true }).click();
  await editor.getByRole('combobox', { name: '模型', exact: true }).click();
  await page.getByRole('option', { name: /Qwen3-TTS 1.7B CustomVoice · Q8/ }).click();
  await editor.getByRole('combobox', { name: '内置音色', exact: true }).click();
  await page.getByRole('option', { name: /^Ryan/ }).click();
  await editor.getByLabel('声音描述', { exact: true }).fill('开心地说话');
  await editor.getByRole('button', { name: '保存角色', exact: true }).click();
  await page.locator('.recent-projects .project-link').first().click();
  await page.getByRole('combobox', { name: '演绎方式', exact: true }).click();
  await page.getByRole('option', { name: '开心', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toContainText('Qwen');
  await page.getByLabel('声音描述', { exact: true }).fill('兴奋地说话');
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('声音描述', { exact: true })).toHaveValue('兴奋地说话');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1')!));
  expect(saved.drafts[0].speaker).toBe('Ryan');
  expect(saved.drafts[0].modelId).toBe('qwen3-tts-customvoice-q8');
  expect(saved.characters[0].settings.modelId).toBe('index-2.5-q8');
  expect(saved.characters[0].performances[0].settings.voiceDescription).toBe('开心地说话');
  await page.getByRole('combobox', { name: '演绎方式', exact: true }).click();
  await page.getByRole('option', { name: '默认演绎', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toBeVisible();
});
