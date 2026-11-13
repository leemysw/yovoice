import { test, expect, type Page } from '@playwright/test';
import { seedState } from './seed';
import { emptyState, type Generation } from '../src/shared/workbench';
import { createMusicDraft } from '../src/features/music/music-draft';
import { createScoreDraft } from '../src/features/score/score-draft';

// 音乐相关的全屏页面（分轨工作台、播放页）与编曲轨道区的按键归属：按键只作用于焦点所在的地方，不穿透到背后或底部播放器。

// 往预览的音频库写入几段指定秒数的 220 Hz 正弦波。
async function seedTones(page: Page, files: Record<string, number>) {
  await page.evaluate(async (files: Record<string, number>) => {
    const wav = (seconds: number) => {
      const rate = 8000, bytes = new Uint8Array(44 + rate * seconds * 2); const view = new DataView(bytes.buffer);
      const text = (offset: number, value: string) => bytes.set(new TextEncoder().encode(value), offset);
      text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
      view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, rate * seconds * 2, true);
      for (let i = 0; i < rate * seconds; i++) view.setInt16(44 + i * 2, Math.round(Math.sin(i * 220 * Math.PI * 2 / rate) * 4000), true);
      return bytes;
    };
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('voice-workbench-audio', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('audio');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result; const tx = db.transaction('audio', 'readwrite');
        for (const [name, seconds] of Object.entries(files)) tx.objectStore('audio').put(new Blob([wav(seconds)], { type: 'audio/wav' }), name);
        tx.oncomplete = () => { db.close(); resolve(); };
      };
    });
  }, files);
}

const lyrics = '[intro]\n\n[verse]\n第一句\n第二句\n\n[chorus]\n第三句';

async function openNowPlaying(page: Page, song: Partial<Generation> = {}, models: { id: string; path: string; managed: boolean }[] = []) {
  const draft = { ...createMusicDraft('zh-CN'), id: 'f'.repeat(32) };
  const state = emptyState();
  state.drafts = [draft];
  state.models = models;
  state.history = [{ id: 'song', title: draft.title, fileName: 'song.wav', createdAt: '2026-09-15T12:00:00Z', duration: 30, settings: { ...draft, lyrics }, ...song }];
  await page.goto('/');
  await seedTones(page, { 'song.wav': 30 });
  await seedState(page, state); await page.reload();
  await page.locator('.player .transport').getByRole('button', { name: '播放页', exact: true }).click();
  return page.getByRole('dialog', { name: `${draft.title} · 播放页` });
}

test('分轨工作台：用键盘打开后按空格是播放，不会按下“重新分离”', async ({ page }) => {
  const draft = { ...createMusicDraft('zh-CN'), id: 'e'.repeat(32) };
  const state = emptyState();
  state.drafts = [draft];
  const take = (id: string, extra: object = {}) => ({ id, title: draft.title, fileName: `${id}.wav`, createdAt: '2026-09-15T12:00:00Z', duration: 4, settings: draft, ...extra });
  state.history = [take('song'), take('vocals', { stemOf: 'song', stem: 'vocals' }), take('drums', { stemOf: 'song', stem: 'drums' })];
  await page.goto('/');
  await seedTones(page, { 'song.wav': 4, 'vocals.wav': 4, 'drums.wav': 4 });
  await seedState(page, state); await page.reload();
  // 全用键盘打开：键盘操作之后，弹窗里第一个按钮拿到焦点时会显示焦点框，空格会按下它。
  await page.locator('.player .transport').getByRole('button', { name: '音频操作', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: '打开分轨' }).focus();
  await page.keyboard.press('Enter');
  const studio = page.getByRole('dialog', { name: `分轨 · ${draft.title}` });
  // 各轨音频解码完才能播放；机器忙时较慢。
  await expect(studio.getByRole('button', { name: '播放', exact: true })).toBeEnabled({ timeout: 15_000 });
  await expect(studio.getByRole('button', { name: '重新分离' })).not.toBeFocused();
  await page.keyboard.press('Space');
  await expect(studio.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await expect(studio.locator('.stem-track-name')).toHaveText(['原曲', '人声', '鼓']);
  // ⌘⇧Space / Ctrl+Shift+Space 在工作台里同样是播放暂停。
  await page.keyboard.press('ControlOrMeta+Shift+Space');
  await expect(studio.getByRole('button', { name: '播放', exact: true })).toBeVisible();
});

test('播放页：速查浮层盖在上面时，A 与方向键不作用到背后的播放页；没装对齐模型时按 A 只在页内提示', async ({ page }) => {
  const playing = await openNowPlaying(page);
  const progress = async () => Number(await playing.locator('.now-playing-progress').inputValue());
  await expect.poll(progress).toBeGreaterThan(1);
  await page.keyboard.press('ControlOrMeta+Slash');
  const sheet = page.getByTestId('hotkey-cheatsheet');
  await expect(sheet).toBeVisible();
  const before = await progress();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('a');
  expect(await progress()).toBeLessThan(before + 5);
  await expect(playing).toBeVisible();
  await expect(playing.getByTestId('now-playing-notice')).toHaveCount(0);
  // 关上浮层后快捷键回到播放页：A 没装模型时只提示，不离开播放页。
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await page.keyboard.press('a');
  await expect(playing.getByTestId('now-playing-notice')).toContainText('还没有下载歌词对齐模型');
  await expect(playing).toBeVisible();
  const closed = await progress();
  await page.keyboard.press('ArrowRight');
  await expect.poll(progress).toBeGreaterThan(closed + 5);
});

test('播放页：已有校准时按 A 先确认再覆盖，取消后校准保留', async ({ page }) => {
  const playing = await openNowPlaying(page, { lyricTimes: [0, 1, 3, 4.5] }, [{ id: 'lyric-align-q8', path: 'Lyric-Align-GGUF', managed: true }]);
  await expect(playing.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await page.keyboard.press('a');
  const confirm = page.getByRole('dialog', { name: '重新对齐歌词？' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: '取消', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1')!).history[0].lyricTimes)).toEqual([0, 1, 3, 4.5]);
  await page.keyboard.press('a');
  await confirm.getByRole('button', { name: '智能对齐', exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1')!).history[0].lyricWords?.length ?? 0)).toBeGreaterThan(0);
});

test('播放页校准歌词：菜单里按 ↓ 只在菜单里移动，不标记；按住 ↓ 只标记一行', async ({ page }) => {
  const playing = await openNowPlaying(page);
  await playing.getByRole('button', { name: '歌词工具', exact: true }).click();
  await page.getByRole('menuitem', { name: /^校准歌词/ }).click();
  const sync = playing.getByRole('group', { name: '校准歌词' });
  await expect(sync).toContainText('1 / 4 行');
  // 按住不放：重复的按键不连续标记。
  await page.keyboard.down('ArrowDown');
  await page.keyboard.down('ArrowDown');
  await page.keyboard.down('ArrowDown');
  await page.keyboard.up('ArrowDown');
  await expect(sync).toContainText('2 / 4 行');
  // 校准时歌词样式菜单还在：在菜单里按 ↓ 是移动选项，不标记。
  await playing.getByRole('button', { name: '滚动歌词', exact: true }).click();
  await expect(page.getByRole('menu')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(sync).toContainText('2 / 4 行');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(sync).toContainText('2 / 4 行');
  // 校准时 L 不切换歌词样式。
  await page.keyboard.press('l');
  await expect(playing.getByRole('button', { name: '滚动歌词', exact: true })).toBeVisible();
});

test('编曲轨道区：获得焦点时没选中轨道，M 切换第一轨发声，不会静音底部播放器', async ({ page }) => {
  const draft = { ...createScoreDraft('zh-CN'), id: 'a'.repeat(32) };
  const state = emptyState();
  state.drafts = [draft];
  state.history = [{ id: 'render', title: draft.title, fileName: 'render.wav', createdAt: '2026-09-15T12:00:00Z', duration: 4, settings: draft }];
  await page.goto('/');
  await seedTones(page, { 'render.wav': 4 });
  await seedState(page, state); await page.reload();
  const player = page.locator('.player');
  await expect(player.getByRole('button', { name: '静音', exact: true })).toBeVisible();
  const first = page.locator('.score-track').first();
  await expect(first.locator('.score-mute')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('group', { name: /7 个声部/ }).focus();
  await page.keyboard.press('m');
  await expect(first.locator('.score-mute')).toHaveAttribute('aria-pressed', 'false');
  await expect(player.getByRole('button', { name: '静音', exact: true })).toBeVisible();
});
