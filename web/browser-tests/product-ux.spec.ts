import { openProjectHistory } from './project-actions';
import { test, expect } from '@playwright/test';
import { emptyState, synthesisSettings } from '../src/shared/workbench';

test('新建四种作品、取消导入、卡片菜单与重命名独立保存', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByTestId('nav-new').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('menuitem')).toHaveCount(4);
  await page.screenshot({ path: testInfo.outputPath('new-project-menu.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.getByTestId('nav-new')).toBeFocused();
  await page.getByTestId('nav-new').press('Enter');
  await page.getByRole('menuitem', { name: '故事配音', exact: true }).click();
  await page.getByLabel('作品名称').fill('雨夜故事');
  await page.getByRole('button', { name: '新增台词', exact: true }).click();
  await page.getByLabel('第 1 句台词').fill('第一句。第二句。');
  await page.getByLabel('第 1 句台词').evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(4, 4));
  await page.getByLabel('第 1 句台词').press('Enter');
  await expect(page.getByLabel('第 2 句台词')).toHaveValue('第二句。');
  await expect(page.getByLabel('第 2 句台词')).toBeFocused();
  await page.getByTestId('nav-story').click();
  const row = page.locator('.project-library-row').filter({ hasText: '雨夜故事' });
  await expect(row.getByRole('button', { name: '雨夜故事', exact: true })).toBeVisible();
  await expect(row).not.toContainText('故事配音');
  await expect(row.locator('time')).toContainText('创建于');
  await row.getByRole('button', { name: '更多操作' }).click();
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
  await page.getByRole('dialog').getByLabel('作品名称').fill('雨夜');
  await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click();
  const renamed = page.locator('.project-library-row').filter({ hasText: '雨夜' });
  await expect(page.getByRole('combobox', { name: '进行中' })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('projects.png') });
  await renamed.getByRole('button', { name: '雨夜', exact: true }).click();
  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入字幕', exact: true }).click();
  await (await choosing).setFiles([]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1')!).drafts.length)).toBe(2);
  const importing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入字幕', exact: true }).click();
  await (await importing).setFiles({ name: '多人.vtt', mimeType: 'text/vtt', buffer: Buffer.from('WEBVTT\n\n00:00.000 --> 00:02.000\n<v Alice>你好\n') });
  await expect(page.getByLabel('作品名称')).toHaveValue('多人');
  await expect(page.getByLabel('第 1 句台词')).toHaveValue('你好');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1')!).drafts.length)).toBe(3);
  await page.reload();
  await page.getByTestId('nav-story').click();
  await page.getByRole('button', { name: '雨夜', exact: true }).last().click();
  await expect(page.getByLabel('第 1 句台词')).toHaveValue('第一句。');
});

test('角色保存与放弃、模型页往返和指定角色应用', async ({ page }, testInfo) => {
  const state = emptyState();
  state.drafts[0] = { ...state.drafts[0], kind: 'story', text: '你好\n再见', subtitles: { speakers: [{ id: 'alice', sourceName: '小林' }, { id: 'bob', sourceName: '旁白' }], cues: [{ start: 0, end: 1000, text: '你好', speakerId: 'alice' }, { start: 1000, end: 2000, text: '再见', speakerId: 'bob' }] } };
  await page.addInitScript(state => { if (!localStorage.getItem('voice-workbench-v1')) localStorage.setItem('voice-workbench-v1', JSON.stringify(state)); }, state);
  await page.goto('/');
  await page.getByTestId('nav-characters').click();
  await page.getByRole('button', { name: '创建角色', exact: true }).click();
  await expect(page.getByTestId('character-editor')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const editor = page.getByTestId('character-editor');
  await expect(editor.getByRole('radio', { name: '声音设计', exact: true })).toBeChecked();
  await editor.getByRole('radio', { name: '音色克隆', exact: true }).click();
  await expect(editor.getByRole('button', { name: '添加参考音频', exact: true })).toBeVisible();
  await editor.getByRole('combobox', { name: '模型', exact: true }).click();
  await page.getByRole('option', { name: /IndexTTS 2.5 · Q8/ }).click();
  await expect(editor.getByRole('radio', { name: '音色克隆', exact: true })).toHaveCount(0);
  await expect(editor.getByRole('radio', { name: '跟随音色', exact: true })).toBeVisible();
  await editor.getByRole('combobox', { name: '模型', exact: true }).click();
  await page.getByRole('option', { name: /OmniVoice · Q8/ }).click();
  await editor.getByRole('radio', { name: '声音设计', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('create-voice-direct.png'), animations: 'disabled' });
  await editor.getByLabel('角色名称').fill('温柔女声');
  await editor.getByRole('button', { name: '管理模型…', exact: true }).click();
  await expect(page.getByRole('tab', { name: '模型', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('nav-characters').click();
  await expect(editor.getByLabel('角色名称')).toHaveValue('温柔女声');
  await editor.getByRole('button', { name: '保存角色', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await page.getByRole('button', { name: '编辑角色', exact: true }).click();
  await editor.getByLabel('角色名称').fill('');
  await editor.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect(page.getByRole('heading', { name: '温柔女声' })).toBeVisible();
  await page.getByRole('button', { name: '使用角色', exact: true }).click();
  const target = page.getByRole('dialog');
  await target.getByRole('combobox', { name: '应用到作品' }).click();
  await page.getByRole('option', { name: '清晨旁白', exact: true }).click();
  await target.getByRole('combobox', { name: '应用到角色' }).click();
  await page.getByRole('option', { name: '旁白', exact: true }).click();
  await target.getByRole('button', { name: '应用角色', exact: true }).click();
  await expect(page.getByLabel('第 1 句台词')).toHaveValue('你好');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1')!).drafts[0].subtitles.speakers[1].settings.modelId)).toBe('omnivoice-q8');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1')!).drafts[0].subtitles.speakers[0].settings)).toBeUndefined();
  await page.screenshot({ path: testInfo.outputPath('story.png') });
  await page.getByTestId('nav-characters').click();
  await page.getByRole('textbox', { name: '搜索角色' }).fill('温柔');
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('nav-characters').click();
  await expect(page.getByRole('textbox', { name: '搜索角色' })).toHaveValue('温柔');
});

test('参考素材删除列出作品引用并保留素材', async ({ page }) => {
  const state = emptyState();
  state.voices = [{ id: 'voice', name: '参考素材', fileName: 'ref.wav', duration: 2 }];
  state.drafts[0].subtitles = { speakers: [{ id: 's', sourceName: '旁白', settings: { ...synthesisSettings(state.drafts[0]), voiceId: 'voice' } }], cues: [] };
  state.drafts[0].text = '';
  await page.addInitScript(state => localStorage.setItem('voice-workbench-v1', JSON.stringify(state)), state);
  await page.goto('/');
  await page.getByTestId('nav-characters').click();
  await page.getByRole('tab', { name: '参考音频', exact: true }).click();
  await page.getByRole('button', { name: '删除声音参考素材', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '删除声音', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('清晨旁白');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1')!).voices.length)).toBe(1);
});

test('录音先试听再保存，取消录音不产生素材', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const destination = context.createMediaStreamDestination();
      oscillator.connect(destination); oscillator.start();
      return destination.stream;
    };
    class Recorder {
      state = 'inactive';
      stream: MediaStream;
      onstop: (() => void) | null = null;
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      constructor(stream: MediaStream) { this.stream = stream; }
      start() { this.state = 'recording'; }
      stop() {
        this.state = 'inactive';
        const bytes = new Uint8Array(64044); const view = new DataView(bytes.buffer);
        const text = (i: number, s: string) => bytes.set(new TextEncoder().encode(s), i);
        text(0, 'RIFF'); view.setUint32(4, 64036, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true);
        view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true);
        view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, 64000, true);
        this.ondataavailable?.({ data: new Blob([bytes], { type: 'audio/wav' }) }); this.onstop?.();
      }
    }
    Object.assign(window, { MediaRecorder: Recorder });
  });
  await page.goto('/');
  await page.getByTestId('nav-characters').click();
  await page.getByRole('tab', { name: '参考音频', exact: true }).click();
  await page.getByRole('button', { name: '添加参考音频', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '录制声音', exact: true }).click();
  await dialog.getByRole('button', { name: '开始录音', exact: true }).click();
  await expect(dialog.getByRole('timer')).toHaveText('00:01');
  expect(await dialog.locator('.recording-meter line').first().getAttribute('x1').then(Number)).toBeGreaterThan(0);
  await expect.poll(() => dialog.locator('.recording-meter line').evaluateAll(lines => lines.some(line => Number(line.getAttribute('y2')) - Number(line.getAttribute('y1')) > 2))).toBeTruthy();
  await expect(dialog.getByRole('button', { name: '取消', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: '关闭添加声音', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1')!).voices.length)).toBe(0);
  await page.getByRole('button', { name: '添加参考音频', exact: true }).click();
  await dialog.getByRole('button', { name: '录制声音', exact: true }).click();
  await dialog.getByRole('button', { name: '开始录音', exact: true }).click();
  await dialog.getByRole('button', { name: '停止录音', exact: true }).click();
  await expect(dialog.getByLabel('录音试听')).toHaveAttribute('src', /^blob:/);
  await expect(dialog.getByLabel('录音试听')).not.toHaveAttribute('controls');
  await dialog.getByRole('button', { name: '播放', exact: true }).click();
  await expect.poll(() => dialog.getByLabel('录音试听').evaluate((audio: HTMLAudioElement) => !audio.paused)).toBeTruthy();
  await dialog.getByRole('button', { name: '暂停', exact: true }).click();
  await dialog.getByRole('slider', { name: '播放进度', exact: true }).fill('1');
  await expect.poll(() => dialog.getByLabel('录音试听').evaluate((audio: HTMLAudioElement) => audio.paused && Math.abs(audio.currentTime - 1) < 0.1)).toBeTruthy();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1')!).voices.length)).toBe(0);
  await dialog.getByRole('button', { name: '保存录音', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1')!).voices.length)).toBe(1);
});


test('角色下拉的新建入口支持空库、返回和保存应用', async ({ page }, testInfo) => {
  await page.goto('/');
  const choose = page.getByRole('combobox', { name: '选择角色', exact: true });
  const editor = page.getByTestId('character-editor');
  await choose.click();
  await page.getByRole('option', { name: '新建角色', exact: true }).click();
  await expect(editor).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await editor.getByRole('button', { name: '返回', exact: true }).click();
  await expect(choose).toContainText('选择角色');
  await choose.click();
  await page.getByRole('option', { name: '新建角色', exact: true }).click();
  await editor.getByLabel('角色名称').fill('快捷新声音');
  await editor.getByRole('button', { name: '保存并应用', exact: true }).click();
  await expect(choose).toContainText('快捷新声音');
  await choose.click();
  await expect(page.getByRole('option', { name: '快捷新声音', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: '新建角色', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('voice-create-shortcut.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(choose).toContainText('快捷新声音');
});


test('故事与语音分类，旧字幕归入故事，历史版本只属于单个语音项目', async ({ page }, testInfo) => {
  const state = emptyState();
  const speech = { ...state.drafts[0], kind: 'text' as const, title: '开场白' };
  const story = { ...speech, id: 'legacy-story', kind: 'subtitle' as const, title: '旧字幕故事', subtitles: { speakers: [{ id: 'alice', sourceName: 'Alice' }], cues: [{ id: 'cue', start: 0, end: 1000, speakerId: 'alice', text: '你好' }] } };
  const other = { ...speech, id: 'other-speech', title: '另一段语音' };
  state.drafts = [speech, story, other];
  state.history = [
    { id: 'audio-new', title: speech.title, fileName: 'a.wav', duration: 3, createdAt: '2026-09-27T09:00:00Z', settings: { ...speech, text: '新版开场白' } },
    { id: 'audio-old', title: speech.title, fileName: 'b.wav', duration: 2, createdAt: '2026-09-27T08:00:00Z', settings: { ...speech, text: '旧版开场白' } },
    { id: 'audio-other', title: other.title, fileName: 'c.wav', duration: 2, createdAt: '2026-09-26T09:00:00Z', settings: other },
    { id: 'audio-story', title: story.title, fileName: 'd.wav', duration: 2, createdAt: '2026-09-25T09:00:00Z', settings: story },
  ];
  await page.addInitScript(state => { if (!localStorage.getItem('voice-workbench-v1')) localStorage.setItem('voice-workbench-v1', JSON.stringify(state)); }, state);
  await page.goto('/');
  await expect(page.getByTestId('nav-text')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('button', { name: '全部生成音频', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '导入字幕', exact: true })).toHaveCount(0);
  await page.locator('.recent-projects summary').focus();
  await page.keyboard.press('Enter');
  await page.reload();
  await expect(page.locator('.recent-projects')).not.toHaveAttribute('open', '');
  await page.locator('.recent-projects summary').click();
  await openProjectHistory(page);
  await expect(page.getByRole('heading', { name: '开场白 · 历史版本', exact: true })).toBeVisible();
  await expect(page.locator('.history-item:visible')).toHaveCount(2);
  await page.getByRole('button', { name: '音频操作', exact: true }).first().click();
  await page.getByRole('menuitem', { name: '保存为参考音频', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('参考原文')).toHaveValue('新版开场白');
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  const search = page.getByRole('textbox', { name: '搜索历史版本', exact: true });
  await search.fill('旧版');
  await expect(page.locator('.history-item:visible')).toHaveCount(1);
  await search.fill('');
  const notice = page.getByRole('button', { name: '关闭提示', exact: true });
  if (await notice.isVisible()) await notice.click();
  await page.screenshot({ path: testInfo.outputPath('speech-versions.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '音频操作', exact: true }).first().click();
  await expect(page.getByRole('menuitem', { name: '保存为参考音频', exact: true })).toBeInViewport();
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 920 });
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page.getByLabel('作品名称')).toHaveValue(speech.title);
  await page.getByTestId('nav-text').click();
  await expect(page.locator('.project-library-row:visible')).toHaveCount(2);
  await page.getByTestId('nav-story').click();
  await expect(page.locator('.project-library-row:visible')).toHaveCount(1);
  await page.locator('.project-library-row:visible').getByRole('button', { name: story.title, exact: true }).click();
  await expect(page.getByTestId('nav-story')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByLabel('第 1 句台词')).toHaveValue('你好');
  await expect(page.getByRole('button', { name: '历史版本', exact: true })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: '当前作品历史', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '导入字幕', exact: true })).toBeVisible();
  if (await notice.isVisible()) await notice.click();
  await page.screenshot({ path: testInfo.outputPath('story-editor.png') });
  await page.getByTestId('nav-text').click();
  await page.locator('.project-library-row:visible').getByRole('button', { name: other.title, exact: true }).click();
  await openProjectHistory(page);
  await expect(page.locator('.history-item:visible')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: '另一段语音 · 历史版本', exact: true })).toBeVisible();
});
