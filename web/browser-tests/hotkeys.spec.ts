import { readFileSync } from 'node:fs';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { seedState } from './seed';
import { emptyState, type HotkeySettings } from '../src/shared/workbench';
import { createMusicDraft } from '../src/features/music/music-draft';

const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1')!).preferences.hotkeys ?? null);
const settingsHeading = (page: Page) => page.getByRole('heading', { name: '设置', level: 1 });

async function openHotkeys(page: Page, hotkeys?: HotkeySettings) {
  const state = emptyState();
  if (hotkeys) state.preferences.hotkeys = hotkeys;
  await seedState(page, state);
  await page.goto('/');
  await page.getByTestId('nav-settings').click();
  await page.getByRole('tab', { name: '快捷键' }).click();
}

/** 展开一级功能区与其中的二级分类。 */
async function expand(page: Page, area: string, title: string, group: string) {
  const card = page.getByTestId(`hotkey-area-${area}`);
  await card.getByRole('button', { name: new RegExp(`^${title}`) }).click();
  await card.getByRole('button', { name: new RegExp(`^${group}`) }).click();
}

test('改快捷键：系统保留键被拒绝，冲突时可替换对方，新按键立即生效，可恢复默认与清除', async ({ page }) => {
  await openHotkeys(page);
  await expand(page, 'global', '全局', '窗口与面板');
  const row = page.getByTestId('hotkey-global.sidebar');
  await row.getByRole('button', { name: '修改「收起 / 展开侧栏」的快捷键' }).click();
  await expect(row.getByText('请按下新的组合键')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+c');
  await expect(row.getByRole('alert')).toContainText('被系统占用');
  await page.keyboard.press('ControlOrMeta+j');
  await expect(row.getByRole('alert')).toContainText('已用于「打开 / 关闭 Ocho」');
  await row.getByRole('button', { name: '替换' }).click();
  await expect.poll(() => saved(page)).toEqual({ bindings: { 'global.sidebar': 'mod+J', 'global.assistant': '' } });
  await expect(page.getByTestId('hotkey-global.assistant')).toContainText('未设置');

  // 新按键切换侧栏，旧按键不再起作用，Ocho 的快捷键已清除。
  await page.keyboard.press('ControlOrMeta+b');
  await expect(page.getByTestId('sidebar')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+j');
  await expect(page.getByTestId('sidebar')).toHaveCount(0);
  await expect(page.getByTestId('assistant-panel')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+j');
  await expect(page.getByTestId('sidebar')).toBeVisible();

  // 恢复默认；全局命令必须带修饰键；录制时按 ⌫ 清除。
  await row.getByRole('button', { name: '恢复默认' }).click();
  await expect.poll(() => saved(page)).toEqual({ bindings: { 'global.assistant': '' } });
  await row.getByRole('button', { name: '修改「收起 / 展开侧栏」的快捷键' }).click();
  await page.keyboard.press('k');
  await expect(row.getByRole('alert')).toContainText('全局快捷键需要带');
  await page.keyboard.press('Backspace');
  await expect.poll(() => saved(page)).toEqual({ bindings: { 'global.assistant': '', 'global.sidebar': '' } });

  // 筛选“未设置”只剩被清除的两条；全部恢复默认后不再保存任何快捷键设置。
  await page.getByRole('radio', { name: '未设置' }).click();
  await expect(page.locator('[data-testid^="hotkey-global."]')).toHaveCount(2);
  await page.getByRole('button', { name: '全部恢复默认' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '全部恢复默认' }).click();
  await expect.poll(() => saved(page)).toBeNull();
});

test('总开关与功能区开关停用快捷键，设置保留，重新打开后照常生效', async ({ page }) => {
  await openHotkeys(page);
  await page.getByRole('switch', { name: '启用快捷键' }).click();
  await expect.poll(() => saved(page)).toEqual({ disabled: true });
  await expect(page.getByText('快捷键已停用。')).toBeVisible();
  await page.getByTestId('nav-text').click();
  await page.keyboard.press('ControlOrMeta+Comma');
  await expect(settingsHeading(page)).toBeHidden();

  await page.keyboard.press('ControlOrMeta+b');
  await expect(page.getByTestId('sidebar')).toBeVisible();
  await page.getByTestId('nav-settings').click();
  await page.getByRole('switch', { name: '启用快捷键' }).click();
  await page.getByRole('switch', { name: '启用「全局」的快捷键' }).click();
  await expect.poll(() => saved(page)).toEqual({ off: ['global'] });
  await page.getByTestId('nav-text').click();
  await page.keyboard.press('ControlOrMeta+Comma');
  await expect(settingsHeading(page)).toBeHidden();

  await page.getByTestId('nav-settings').click();
  await page.getByRole('switch', { name: '启用「全局」的快捷键' }).click();
  await expect.poll(() => saved(page)).toBeNull();
  await page.getByTestId('nav-text').click();
  await page.keyboard.press('ControlOrMeta+Comma');
  await expect(settingsHeading(page)).toBeVisible();
});

test('导出改过的快捷键，导入时预览变化：冲突的按键被清除、未知命令跳过，合并与替换结果不同', async ({ page }) => {
  await openHotkeys(page, { bindings: { 'global.sidebar': 'mod+shift+B' } });
  await page.getByRole('button', { name: '导出…' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('dialog').getByRole('button', { name: '保存文件' }).click();
  const file = JSON.parse(readFileSync(await (await download).path(), 'utf8'));
  expect(file).toMatchObject({ format: 'yovoice-hotkeys', version: 1, bindings: { 'global.sidebar': 'mod+shift+B' } });
  expect(Object.keys(file.bindings)).toEqual(['global.sidebar']);

  const incoming = { format: 'yovoice-hotkeys', version: 1, platform: 'other', bindings: { 'global.inspector': 'ctrl+J', 'global.cheatsheet': 'mod+/', 'missing.command': 'mod+K' } };
  const choose = () => page.getByLabel('选择快捷键文件').setInputFiles({ name: 'keys.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(incoming)) });
  await choose();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('来自 Windows / Linux · 3 项快捷键');
  const changes = dialog.getByTestId('hotkey-import-changes');
  await expect(changes).toContainText('收起 / 展开右侧检查器');
  await expect(changes).toContainText('与「收起 / 展开右侧检查器」冲突，将清除');
  await expect(dialog).toContainText('跳过 1 项');
  await dialog.getByRole('button', { name: '应用' }).click();
  await expect.poll(() => saved(page)).toEqual({ bindings: { 'global.sidebar': 'mod+shift+B', 'global.inspector': 'mod+J', 'global.assistant': '' } });

  // 替换：文件里没有的命令恢复默认。
  await choose();
  await dialog.getByRole('radio', { name: '替换' }).click();
  await expect(changes).toContainText('收起 / 展开侧栏');
  await dialog.getByRole('button', { name: '应用' }).click();
  await expect.poll(() => saved(page)).toEqual({ bindings: { 'global.inspector': 'mod+J', 'global.assistant': '' } });

  // 不是导出的快捷键文件时提示格式不对。
  await page.getByLabel('选择快捷键文件').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"bindings":{}}') });
  await expect(page.getByText('这不是 yovoice 导出的快捷键文件。')).toBeVisible();
});

test('速查浮层列出当前页面能用的快捷键，可跳到设置自定义', async ({ page }) => {
  await seedState(page, emptyState());
  await page.goto('/');
  await expect(page.getByTestId('nav-text')).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('ControlOrMeta+Slash');
  const sheet = page.getByTestId('hotkey-cheatsheet');
  await expect(sheet).toContainText('打开设置');
  await expect(sheet).toContainText('快捷键速查');
  await page.keyboard.press('ControlOrMeta+Slash');
  await expect(sheet).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+Slash');
  await page.getByRole('button', { name: '自定义快捷键' }).click();
  await expect(page.getByRole('tab', { name: '快捷键' })).toHaveAttribute('aria-selected', 'true');
});

test('录制中点了别处或按 Tab 就结束录制：切到别的页面后打字不会被录成快捷键', async ({ page }) => {
  await openHotkeys(page);
  await expand(page, 'global', '全局', '窗口与面板');
  const row = page.getByTestId('hotkey-global.sidebar');
  const edit = row.getByRole('button', { name: '修改「收起 / 展开侧栏」的快捷键' });
  await edit.click();
  await expect(row.getByText('请按下新的组合键')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(row.getByText('请按下新的组合键')).toHaveCount(0);

  await edit.click();
  await page.getByTestId('nav-text').click();
  const script = page.getByRole('textbox', { name: '正文', exact: true });
  await script.click();
  await page.keyboard.type('kb');
  await page.keyboard.press('Backspace');
  await expect(script).toHaveValue(/k$/);
  expect(await saved(page)).toBeNull();
});

test('改键撞上几条同时生效的命令时一并提示，替换时全部清除', async ({ page }) => {
  await openHotkeys(page);
  await expand(page, 'global', '全局', '底部播放区');
  const row = page.getByTestId('hotkey-player.mute');
  await row.getByRole('button', { name: '修改「静音」的快捷键' }).click();
  // 单轨播放条在语音生成、音乐、编曲、音效页下方，与这几页的“导出”（都是 ⌘E）同时生效。
  await page.keyboard.press('ControlOrMeta+e');
  await expect(row.getByRole('alert')).toContainText('等 4 条命令');
  await row.getByRole('button', { name: '替换' }).click();
  await expect.poll(() => saved(page)).toEqual({ bindings: { 'player.mute': 'mod+E', 'create.export': '', 'music.export': '', 'score.export': '', 'sfx.export': '' } });
  // 恢复“导出”的默认按键时只撞上刚改的“静音”；它与时间线导出的默认按键本来就相同，不算冲突。筛选“已修改”会展开全部分类。
  await page.getByRole('radio', { name: /已修改/ }).click();
  const exportRow = page.getByTestId('hotkey-create.export');
  await exportRow.getByRole('button', { name: '恢复默认' }).click();
  await expect(exportRow.getByRole('alert')).toContainText('已用于「静音」。');
  await exportRow.getByRole('button', { name: '替换' }).click();
  await expect.poll(() => saved(page)).toEqual({ bindings: { 'player.mute': '', 'music.export': '', 'score.export': '', 'sfx.export': '' } });
});

test('导入时整理按键写法：未知键名、数字组合不对应的跳过，另一平台的默认按键按默认处理', async ({ page }) => {
  await openHotkeys(page);
  const incoming = { format: 'yovoice-hotkeys', version: 1, platform: 'other', bindings: {
    'global.sidebar': 'mod+shift+y', 'global.cancel': 'ctrl+shift+.', 'global.inspector': 'mod+f13', 'story.speaker': 'alt+3', 'global.settings': 'mod+#',
  } };
  await page.getByLabel('选择快捷键文件').setInputFiles({ name: 'keys.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(incoming)) });
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('跳过 3 项');
  await expect(dialog.getByTestId('hotkey-import-changes').locator('.hotkey-import-row')).toHaveCount(1);
  await dialog.getByRole('button', { name: '应用' }).click();
  await expect.poll(() => saved(page)).toEqual({ bindings: { 'global.sidebar': 'mod+shift+Y' } });
});

test('macOS 上 ⌥ 加字母在输入框里是打字符，不触发快捷键；快捷键停用时速查仍可从设置页打开', async ({ page }) => {
  test.skip(process.platform !== 'darwin', '⌥ 打字符是 macOS 的行为');
  const state = emptyState();
  state.preferences.hotkeys = { bindings: { 'global.settings': 'alt+K' } };
  await seedState(page, state);
  await page.goto('/');
  const press = (target: Locator) => target.evaluate((element: HTMLElement) => {
    element.focus();
    return element.dispatchEvent(new KeyboardEvent('keydown', { key: '˚', code: 'KeyK', altKey: true, bubbles: true, cancelable: true }));
  });
  // 返回值为 true 表示没被拦下：字符照常输入，设置页没有打开。
  expect(await press(page.getByRole('textbox', { name: '正文', exact: true }))).toBe(true);
  await expect(settingsHeading(page)).toBeHidden();
  expect(await press(page.locator('body'))).toBe(false);
  await expect(settingsHeading(page)).toBeVisible();

  await page.getByRole('tab', { name: '快捷键' }).click();
  await page.getByRole('switch', { name: '启用快捷键' }).click();
  await page.getByRole('button', { name: '快捷键速查' }).click();
  await expect(page.getByRole('dialog')).toContainText('快捷键已停用');
});

// 快捷键之间、快捷键与弹窗 / 菜单 / 输入法之间不互相抢键：同一次按键只做一件事，按键归焦点所在的地方。

const pickerTitle = '选择参考音频';

async function configureAI(page: Page) {
  await page.getByTestId('nav-settings').click();
  await page.getByRole('tab', { name: 'AI 服务' }).click();
  await page.getByRole('button', { name: 'Ollama', exact: true }).click();
  await page.getByRole('textbox', { name: '当前模型' }).fill('qwen3');
  await page.getByRole('button', { name: '添加服务', exact: true }).click();
  await expect(page.locator('.ai-nav').getByLabel('使用中')).toHaveCount(1);
}

test('Ocho 输入框里按 ⌘↩ / Ctrl+Enter 只发送消息，不会同时开始生成；正文里按照常生成', async ({ page }) => {
  await page.goto('/');
  await configureAI(page);
  await page.getByTestId('nav-new').click();
  await page.getByRole('menuitem', { name: '语音生成', exact: true }).click();
  const script = page.getByRole('textbox', { name: '正文', exact: true });
  await script.fill('夜色很深，风停了。');
  // 正文里的快捷键照常生成：还没选参考音频，先打开声音选择。先打开一次也让按需加载的选择框就绪，后面才能确认它没有再出现。
  const picker = page.getByRole('heading', { name: pickerTitle });
  await script.press('ControlOrMeta+Enter');
  await expect(picker).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await page.getByTestId('assistant-toggle').click();
  const panel = page.getByTestId('assistant-panel');
  await panel.getByRole('textbox').fill('帮我润色一下');
  await panel.getByRole('textbox').press('ControlOrMeta+Enter');
  await expect(panel.getByRole('button', { name: /停止|Stop/ })).toBeVisible();
  await expect(picker).toHaveCount(0);
});

test('时间线作品：弹窗里的空格与 ⌘↩ / Ctrl+Enter 不穿透到时间线和生成，空格按下的是聚焦的按钮', async ({ page }) => {
  const state = emptyState();
  const draft = state.drafts[0];
  draft.text = '银行需要核对资料。';
  state.history = [{ id: '1'.repeat(32), title: '片段 A', fileName: 'timeline.wav', createdAt: '2026-09-27T10:00:00Z', duration: 2, settings: draft }];
  draft.timeline = { tracks: [{ id: 'track-1', name: '音轨 1', muted: false, clips: [{ id: 'clip-1', generationId: state.history[0].id, start: 0, offset: 0, duration: 2 }] }] };
  await seedState(page, state);
  await page.goto('/');
  await expect(page.locator('.multitrack-row')).toHaveCount(1);
  const editor = page.getByRole('textbox', { name: '正文', exact: true });
  const dialog = page.getByRole('dialog');
  // 先用生成快捷键打开一次声音选择，让按需加载的选择框就绪，后面才能确认它没有在弹窗背后出现。
  const picker = page.getByRole('heading', { name: pickerTitle });
  await editor.press('ControlOrMeta+Enter');
  await expect(picker).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  const openPronunciation = async () => {
    await editor.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(0, 0));
    await editor.press('Shift+ArrowRight'); await editor.press('Shift+ArrowRight');
    await page.getByRole('button', { name: '调整发音', exact: true }).click();
    await expect(dialog).toContainText('银行');
  };
  // 弹窗里聚焦“取消”按空格：按下的是按钮，弹窗关闭。
  await openPronunciation();
  await dialog.getByRole('button', { name: '取消', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(dialog).toHaveCount(0);
  // 弹窗里按生成快捷键不会在背后开始生成。
  await openPronunciation();
  await dialog.getByRole('button', { name: '取消', exact: true }).focus();
  await page.keyboard.press('ControlOrMeta+Enter');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(picker).toHaveCount(0);
  // 侧栏按钮上按空格进入对应页面，而不是播放时间线。
  await page.getByTestId('nav-settings').focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('tab', { name: 'AI 服务' })).toBeVisible();
});

async function seedTone(page: Page, name: string, seconds: number) {
  await page.evaluate(async ([name, seconds]) => {
    const rate = 8000, bytes = new Uint8Array(44 + rate * seconds * 2); const view = new DataView(bytes.buffer);
    const text = (offset: number, value: string) => bytes.set(new TextEncoder().encode(value), offset);
    text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, rate * seconds * 2, true);
    for (let i = 0; i < rate * seconds; i++) view.setInt16(44 + i * 2, Math.round(Math.sin(i * 220 * Math.PI * 2 / rate) * 4000), true);
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('voice-workbench-audio', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('audio');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { const db = request.result; const tx = db.transaction('audio', 'readwrite'); tx.objectStore('audio').put(new Blob([bytes], { type: 'audio/wav' }), name); tx.oncomplete = () => { db.close(); resolve(); }; };
    });
  }, [name, seconds] as const);
}

test('播放页：菜单打开时方向键只在菜单里移动，不快退快进；菜单关上后方向键照常快进', async ({ page }) => {
  const draft = { ...createMusicDraft('zh-CN'), id: 'f'.repeat(32) };
  const state = emptyState();
  state.drafts = [draft];
  state.history = [{ id: 'song', title: draft.title, fileName: 'song.wav', createdAt: '2026-09-15T12:00:00Z', duration: 30, settings: { ...draft, lyrics: '[verse]\n第一句\n第二句' } }];
  await page.goto('/');
  await seedTone(page, 'song.wav', 30);
  await seedState(page, state); await page.reload();
  await page.locator('.player .transport').getByRole('button', { name: '播放页', exact: true }).click();
  const playing = page.getByRole('dialog', { name: `${draft.title} · 播放页` });
  const progress = async () => Number(await playing.locator('.now-playing-progress').inputValue());
  // 打开即播放，等进度走起来，快退才看得出来。
  await expect.poll(progress).toBeGreaterThan(1);
  await playing.getByRole('button', { name: '歌词工具', exact: true }).click();
  await page.keyboard.press('ArrowDown');
  const before = await progress();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  expect(await progress()).toBeGreaterThanOrEqual(before);
  expect(await progress()).toBeLessThan(before + 5);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  const closed = await progress();
  await page.keyboard.press('ArrowRight');
  await expect.poll(progress).toBeGreaterThan(closed + 5);
});

test('风格标签：输入法组字时按回车是在确认候选，不把还没上屏的拼音加成标签', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('nav-new').click();
  await page.getByRole('menuitem', { name: '音乐生成', exact: true }).click();
  const input = page.getByLabel('添加风格标签');
  await input.fill('liuxing');
  // 组字中的回车：macOS 的 WebKit 报 keyCode 229，isComposing 可能还是 false。
  await input.evaluate((element: HTMLInputElement) => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true, cancelable: true })));
  await expect(input).toHaveValue('liuxing');
  await expect(page.getByText('liuxing', { exact: true })).toHaveCount(0);
  await input.press('Enter');
  await expect(input).toHaveValue('');
  await expect(page.getByText('liuxing', { exact: true })).toHaveCount(1);
});

test('切到别的页面后，撤销快捷键不会改动隐藏在后台的转写', async ({ page }) => {
  const state = emptyState();
  state.models = [{ id: 'qwen3-asr-0.6b-q8', path: 'Qwen3-ASR-GGUF', managed: true }];
  await seedState(page, state);
  await page.goto('/');
  await page.getByTestId('nav-transcribe').click();
  await page.getByTestId('transcribe-page').locator('input[type=file]').setInputFiles({ name: '采访录音.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('mp3') });
  const editor = page.getByTestId('transcript-editor');
  const first = editor.getByRole('textbox', { name: '第 1 行字幕' });
  await first.fill('改过的第一行');
  await expect(editor.getByRole('button', { name: '撤销', exact: true })).toBeEnabled();
  await page.getByTestId('nav-settings').click();
  await page.getByRole('tab', { name: 'AI 服务' }).click();
  await page.keyboard.press('ControlOrMeta+z');
  await page.getByTestId('nav-transcribe').click();
  await expect(first).toHaveValue('改过的第一行');
  // 回到转写页后撤销照常生效。
  await editor.getByRole('heading', { name: '采访录音', exact: true }).click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(first).toHaveValue('浏览器预览不运行识别模型');
});
