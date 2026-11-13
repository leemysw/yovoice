import { test, expect, type Page } from '@playwright/test';
import { seedState } from './seed';
import { emptyState, type State } from '../src/shared/workbench';

// 故事配音台词与时间线片段的快捷键：只作用于看得见、焦点所在的那一处。

/** 一个故事作品：texts 是各句台词，speakers 是各句的说话人（默认都是旁白）。 */
function storyState(texts: string[], speakers: string[] = []): State {
  const state = emptyState();
  const draft = state.drafts[0];
  draft.kind = 'story';
  draft.text = texts.join('\n');
  draft.subtitles = {
    speakers: [{ id: 'narrator', sourceName: '旁白' }, { id: 'hero', sourceName: '人物' }],
    cues: texts.map((text, index) => ({ id: `cue-${index + 1}`, speakerId: speakers[index] ?? 'narrator', start: index * 1000, end: (index + 1) * 1000, text })),
  };
  return state;
}

const cue = (page: Page, n: number) => page.getByLabel(`第 ${n} 句台词`, { exact: true });
const cueTexts = (page: Page) => page.locator('.subtitle-cue textarea').evaluateAll(fields => fields.map(field => (field as HTMLTextAreaElement).value));

test('翻页后按删除台词的快捷键，删掉的是当前页焦点所在的那句，不是上一页选中的', async ({ page }) => {
  await seedState(page, storyState(Array.from({ length: 60 }, (_, index) => `第${index + 1}句`)));
  await page.goto('/');
  await cue(page, 1).click();
  // 翻页按钮与快捷键一样：翻到下一页并把焦点放到这一页的第一句。
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(cue(page, 51)).toBeFocused();
  await page.keyboard.press('ControlOrMeta+Shift+K');
  await expect(cue(page, 51)).toHaveValue('第52句');
  // 焦点不在任何一句台词上（翻页按钮）时不删除。
  await page.getByRole('button', { name: '上一页', exact: true }).focus();
  await page.keyboard.press('ControlOrMeta+Shift+K');
  await expect(cue(page, 51)).toHaveValue('第52句');
  await expect(page.locator('.subtitle-cue')).toHaveCount(9);
  await page.getByRole('button', { name: '上一页', exact: true }).click();
  await expect(cue(page, 1)).toHaveValue('第1句');
  await expect(page.locator('.subtitle-cue')).toHaveCount(50);
});

test('按住退格只删字，不会越过行首连续合并台词；说话人不同的两句不合并', async ({ page }) => {
  await seedState(page, storyState(['甲', '乙', '丙', '丁'], ['narrator', 'narrator', 'narrator', 'hero']));
  await page.goto('/');
  await cue(page, 3).click();
  await cue(page, 3).evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(0, 0));
  // 第一下在行首合并到上一句；之后按住不放（keydown 带 repeat）只删掉“乙”，到行首停下。
  await page.keyboard.down('Backspace');
  await page.keyboard.down('Backspace');
  await page.keyboard.down('Backspace');
  await page.keyboard.up('Backspace');
  await expect.poll(() => cueTexts(page)).toEqual(['甲', '丙', '丁']);
  await expect(cue(page, 2)).toBeFocused();
  // 松开再按一次照常合并。
  await page.keyboard.press('Backspace');
  await expect.poll(() => cueTexts(page)).toEqual(['甲丙', '丁']);
  // “丁”是另一个说话人：行首退格、上一句行尾删除都不合并。
  await cue(page, 2).click();
  await cue(page, 2).evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(0, 0));
  await page.keyboard.press('Backspace');
  await cue(page, 1).click();
  await cue(page, 1).evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(2, 2));
  await page.keyboard.press('Delete');
  await expect.poll(() => cueTexts(page)).toEqual(['甲丙', '丁']);
});

test('故事配音在设置里隐藏后，仍停留在故事编辑页时台词快捷键不响应', async ({ page }) => {
  const state = storyState(['第一句', '第二句']);
  state.preferences.hiddenFeatures = ['story'];
  await seedState(page, state);
  await page.goto('/');
  await cue(page, 1).click();
  await page.keyboard.press('ControlOrMeta+Shift+K');
  expect(await cueTexts(page)).toEqual(['第一句', '第二句']);
  // 生成快捷键也不响应：没有模型时生成会跳到设置页。
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(cue(page, 1)).toBeVisible();
  expect(await cueTexts(page)).toEqual(['第一句', '第二句']);
});

test('选中片段后 ⌥→ / Alt+→ 跳到片段边界而不是移动片段，方向键照常微调', async ({ page }) => {
  const state = emptyState();
  const draft = state.drafts[0];
  state.history = [{ id: '1'.repeat(32), title: '片段 A', fileName: 'clip.wav', createdAt: '2026-09-27T10:00:00Z', duration: 2, settings: draft }];
  draft.timeline = { tracks: [{ id: 'track-1', name: '音轨 1', muted: false, clips: [{ id: 'clip-1', generationId: state.history[0].id, start: 0, offset: 0, duration: 2 }] }] };
  await page.goto('/');
  await page.evaluate(async () => {
    const rate = 8000, bytes = new Uint8Array(44 + rate * 2 * 2); const view = new DataView(bytes.buffer);
    const text = (offset: number, value: string) => bytes.set(new TextEncoder().encode(value), offset);
    text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, rate * 2 * 2, true);
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('voice-workbench-audio', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('audio');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { const db = request.result; const tx = db.transaction('audio', 'readwrite'); tx.objectStore('audio').put(new Blob([bytes], { type: 'audio/wav' }), 'clip.wav'); tx.oncomplete = () => { db.close(); resolve(); }; };
    });
  });
  await seedState(page, state); await page.reload();
  const clip = page.locator('.multitrack-clip');
  const ruler = page.getByRole('slider', { name: '播放进度', exact: true });
  const region = page.locator('.multitrack-region');
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1')!).drafts[0].timeline.tracks[0].clips[0].start as number);
  await clip.click();
  await expect(clip).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Alt+ArrowRight');
  await expect(ruler).toHaveValue('2');
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(ruler).toHaveValue('0');
  await expect(clip).toBeFocused();
  // 片段没有被 ⌥ 方向键挪动；不带修饰键的方向键照常微调 0.01 秒。
  await expect(region).toHaveAttribute('style', /left: 0%/);
  await page.keyboard.press('ArrowRight');
  await expect(region).not.toHaveAttribute('style', /left: 0%/);
  await expect.poll(stored).toBeCloseTo(0.01, 5);
});
