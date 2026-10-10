import { test, expect, type Page, type Locator } from '@playwright/test';
import { seedState } from './seed';
import { emptyState, type AudioTimeline } from '../src/shared/workbench';
import { Timeline, TimelineHistory } from '../src/features/media/timeline';

async function expectPlaybackHitArea(page: Page) {
  const play = page.locator('.audio-panel .play-main');
  // 播放按钮的上半部也应命中按钮，不能被调高面板的透明区域拦截。
  expect(await play.evaluate(button => {
    const rect = button.getBoundingClientRect();
    return [0.2, 0.5, 0.8].every(y => button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height * y)));
  })).toBe(true);
  const handle = await page.getByRole('separator', { name: '调整音轨区高度', exact: true }).boundingBox();
  expect(handle!.width).toBeLessThanOrEqual(48);
  const panel = (await page.locator('.audio-panel').boundingBox())!;
  const pill = (await page.locator('.audio-panel .astryx-resize-handle-pill').boundingBox())!;
  expect(panel.y - pill.y - pill.height).toBeGreaterThanOrEqual(0);
  expect(panel.y - pill.y - pill.height).toBeLessThanOrEqual(3);
}

async function dragEdge(page: Page, clip: Locator, edge: 'start' | 'end', delta: number, duration: number) {
  await clip.click();
  const region = clip.locator('..');
  const handle = region.locator(`.multitrack-trim[data-edge="${edge}"]`);
  await handle.scrollIntoViewIfNeeded();
  const bounds = (await clip.boundingBox())!;
  const grip = (await handle.boundingBox())!;
  // 两端整条边缘都可裁剪，分别从上半部和下半部验证命中区域。
  expect(grip.y).toBeCloseTo(bounds.y, 1);
  expect(grip.height).toBeCloseTo(bounds.height, 1);
  const x = edge === 'start' ? grip.x + 1 : grip.x + grip.width - 1;
  const y = grip.y + grip.height * (edge === 'start' ? .25 : .75);
  await page.keyboard.down('Alt');
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + delta * bounds.width / duration, y, { steps: 5 }); await page.mouse.up(); await page.keyboard.up('Alt');
}

test('分割和移动保留源范围，播放从正确偏移开始', () => {
  const value: AudioTimeline = { tracks: [{ id: 'a', name: 'A', muted: false, clips: [{ id: 'clip', generationId: 'source', start: 2, offset: 1, duration: 4 }] }, { id: 'b', name: 'B', muted: false, clips: [] }] };
  const split = Timeline.split(value, 'clip', 3.5);
  expect(split.tracks[0].clips.map(c => [c.start, c.offset, c.duration])).toEqual([[2, 1, 1.5], [3.5, 2.5, 2.5]]);
  expect(value.tracks[0].clips).toHaveLength(1);
  expect(Timeline.split(value, 'clip', 2).tracks[0].clips).toHaveLength(1);
  expect(Timeline.split(value, 'clip', 6).tracks[0].clips).toHaveLength(1);
  const moved = Timeline.move(split, split.tracks[0].clips[1].id, 'b', 5);
  expect(moved.tracks[1].clips[0]).toMatchObject({ start: 5, offset: 2.5, duration: 2.5 });
  expect(Timeline.duration(moved)).toBe(7.5);
  expect(Timeline.playback(moved.tracks[1].clips[0], 6)).toEqual({ delay: 0, offset: 3.5, duration: 1.5 });
  expect(Timeline.move(value, 'clip', 'missing', 1)).toBe(value);
});

test('边缘裁剪固定另一端、可恢复源音频并限制在有效范围', () => {
  const value: AudioTimeline = { tracks: [{ id: 'a', name: 'A', muted: false, clips: [{ id: 'c', generationId: 's', start: 2, offset: 1, duration: 4 }] }] };
  const cropped = Timeline.trimEdge(value, 'c', 'start', 1, 8);
  expect(cropped.tracks[0].clips[0]).toMatchObject({ start: 3, offset: 2, duration: 3 });
  expect(Timeline.trimEdge(cropped, 'c', 'start', -1, 8)).toEqual(value);
  expect(Timeline.trimEdge(value, 'c', 'start', -100, 8).tracks[0].clips[0]).toMatchObject({ start: 1, offset: 0, duration: 5 });
  expect(Timeline.trimEdge(value, 'c', 'end', 100, 8).tracks[0].clips[0]).toMatchObject({ start: 2, offset: 1, duration: 7 });
  expect(Timeline.trimEdge(value, 'c', 'end', -100, 8).tracks[0].clips[0].duration).toBeCloseTo(0.01);
  expect(Timeline.trimEdge(value, 'c', 'start', NaN, 8)).toBe(value);
});

test('撤销栈忽略无变化、分支清除重做且不重复接收已撤销的生成结果', () => {
  const initial: AudioTimeline = { tracks: [{ id: 'a', name: 'A', muted: false, clips: [] }] };
  const edits = new TimelineHistory(initial);
  expect(edits.record(structuredClone(initial), '')).toBe(false);
  expect(edits.canUndo).toBe(false);
  const generated = { ...initial, acceptedGenerations: ['g'], tracks: [{ ...initial.tracks[0], clips: [{ id: 'c', generationId: 'g', start: 0, offset: 0, duration: 2 }] }] };
  edits.record(generated, '');
  edits.record(Timeline.trimEdge(generated, 'c', 'end', -1, 2), 'c');
  expect(edits.restore('undo', 'c')?.value.tracks[0].clips[0].duration).toBe(2);
  const undone = edits.restore('undo', 'c')!;
  expect(undone.value.tracks[0].clips).toEqual([]);
  expect(undone.value.acceptedGenerations).toEqual(['g']);
  expect(edits.record(structuredClone(undone.value), '')).toBe(false);
  expect(edits.restore('redo', '')?.value.tracks[0].clips[0].duration).toBe(2);
  edits.record({ ...generated, tracks: [{ ...generated.tracks[0], muted: true }] }, 'c');
  expect(edits.canRedo).toBe(false);
});

test('多轨分割、移动、静音播放、调整高度和重载', async ({ page }, testInfo) => {
  const state = emptyState();
  const draft = state.drafts[0];
  state.history = ['片段 A', '片段 B'].map((title, index) => ({ id: String(index + 1).repeat(32), title, fileName: 'timeline.wav', createdAt: '2026-09-27T10:00:00Z', duration: 2, settings: draft }));
  await page.goto('/');
  await page.evaluate(async () => {
    const data = new ArrayBuffer(64044); const view = new DataView(data);
    const text = (at: number, text: string) => [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
    text(0, 'RIFF'); view.setUint32(4, 64036, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, 64000, true);
    for (let i = 0; i < 32000; i++) view.setInt16(44 + i * 2, Math.sin(i * 0.17) * 6000, true);
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('voice-workbench-audio', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('audio');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => { const db = req.result; const tx = db.transaction('audio', 'readwrite'); tx.objectStore('audio').put(new Blob([data], { type: 'audio/wav' }), 'timeline.wav'); tx.oncomplete = () => { db.close(); resolve(); }; };
    });
  });
  await seedState(page, state); await page.reload();
  const playerBefore = await page.locator('.player').boundingBox();
  expect(playerBefore!.height).toBe(148);
  const settingsBox = (await page.getByTestId('nav-settings').boundingBox())!;
  expect(Math.abs(settingsBox.y + settingsBox.height - playerBefore!.y - playerBefore!.height)).toBeLessThan(1);
  expect((await page.locator('.player > .transport').boundingBox())!.height).toBeLessThanOrEqual(37);
  await expectPlaybackHitArea(page);
  const playerHandle = await page.getByRole('separator', { name: '调整音轨区高度', exact: true }).boundingBox();
  await page.mouse.move(playerHandle!.x + playerHandle!.width / 2, playerHandle!.y + playerHandle!.height / 2);
  await page.mouse.down(); await page.mouse.move(playerHandle!.x + playerHandle!.width / 2, playerHandle!.y - 60, { steps: 5 }); await page.mouse.up();
  expect((await page.locator('.player').boundingBox())!.height).toBeGreaterThan(playerBefore!.height + 40);
  await expect(page.locator('.player-lane-actions').getByRole('button', { name: '新增音轨', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '新增音轨', exact: true }).click();
  await expect(page.locator('.multitrack-row')).toHaveCount(2);
  await expectPlaybackHitArea(page);
  const addTrackBox = (await page.getByRole('button', { name: '新增音轨', exact: true }).boundingBox())!;
  const laneBox = (await page.locator('.multitrack-lane').first().boundingBox())!;
  expect(addTrackBox.x + addTrackBox.width).toBeLessThanOrEqual(laneBox.x);
  await expect(page.locator('.multitrack-row input:visible')).toHaveCount(0);
  expect((await page.locator('.multitrack > .transport').boundingBox())!.height).toBeLessThanOrEqual(41);
  expect((await page.locator('.multitrack-ruler-row').boundingBox())!.height).toBeLessThanOrEqual(25);
  expect(laneBox.height).toBeLessThanOrEqual(48);
  expect((await page.getByRole('button', { name: '新增音轨', exact: true }).locator('..').boundingBox())!.height).toBeLessThanOrEqual(36);
  await page.locator('.multitrack-clip').click();
  const ruler = page.getByRole('slider', { name: '播放进度', exact: true });
  await ruler.focus();
  await ruler.press('ArrowRight');
  await expect(ruler).toHaveValue('1.01');
  await page.getByRole('slider', { name: '播放进度', exact: true }).fill('0.75');
  await page.getByRole('button', { name: '分割片段', exact: true }).click();
  await expect(page.locator('.multitrack-clip')).toHaveCount(2);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.locator('.multitrack-clip')).toHaveCount(1);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(page.locator('.multitrack-clip')).toHaveCount(2);
  await page.keyboard.press('Meta+z');
  await expect(page.locator('.multitrack-clip')).toHaveCount(1);
  await page.keyboard.press('Meta+Shift+z');
  await expect(page.locator('.multitrack-clip')).toHaveCount(2);
  await page.locator('.multitrack-clip').nth(1).click();
  const moving = (await page.locator('.multitrack-clip').nth(1).boundingBox())!;
  const destination = (await page.locator('.multitrack-lane').nth(1).boundingBox())!;
  await page.locator('.multitrack-clip').nth(1).dragTo(page.locator('.multitrack-lane').nth(1), { targetPosition: { x: destination.width / 10 + moving.width / 2, y: destination.height / 2 } });
  await expect(page.locator('.multitrack-lane').nth(1).locator('.multitrack-clip')).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.multitrack-lane').first().locator('.multitrack-clip')).toHaveCount(2);
  await page.keyboard.press('Control+y');
  await expect(page.locator('.multitrack-lane').nth(1).locator('.multitrack-clip')).toHaveCount(1);
  await page.getByRole('button', { name: '添加音频到音轨 2', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('timeline-audio-menu.png'), animations: 'disabled' });
  await page.getByRole('menuitem', { name: '从历史版本添加', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '片段 B', exact: true }).click();
  await expect(page.locator('.multitrack-clip')).toHaveCount(3);
  await page.getByRole('button', { name: '静音音轨 1', exact: true }).click();
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('button', { name: '静音音轨 1', exact: true })).toBeVisible();
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByRole('button', { name: '取消静音音轨 1', exact: true })).toBeVisible();
  await page.getByRole('slider', { name: '播放进度', exact: true }).fill('0');
  await page.evaluate(() => {
    const calls: number[][] = [];
    Object.assign(window, { timelineStarts: calls });
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function(when = 0, offset = 0, duration?: number) { calls.push([when, offset, duration ?? 0]); start.call(this, when, offset, duration); };
  });
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { timelineStarts: number[][] }).timelineStarts.map(c => c.slice(1).map(v => Number(v.toFixed(6)))))).toEqual([[0.75, 1.25], [0, 2]]);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  const handle = page.getByRole('separator', { name: '调整音轨区高度', exact: true });
  const before = await page.locator('.multitrack').boundingBox();
  const box = await handle.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down(); await page.mouse.move(box!.x + box!.width / 2, box!.y - 90, { steps: 5 }); await page.mouse.up();
  expect((await page.locator('.multitrack').boundingBox())!.height).toBeGreaterThan(before!.height + 50);
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('.multitrack-clip')).toHaveCount(3);
  await expect(page.getByRole('button', { name: '取消静音音轨 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.multitrack-clip svg').first()).toBeVisible();
  await expect(page.getByRole('button', { name: '历史版本', exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('multitrack.png') });
  await expect(page.getByRole('button', { name: '收起音轨', exact: true })).toHaveCount(0);
  await expect(page.locator('.multitrack-clip')).toHaveCount(3);
  await page.setViewportSize({ width: 600, height: 820 });
  await expect(page.getByRole('button', { name: '新增音轨', exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('multitrack-narrow.png') });
});

test('分段接收幂等、删除不复活、重生成只替换指定片段并顺延', () => {
  const draft = emptyState().drafts[0];
  const make = (id: string, index: number, duration: number, targetClipId?: string) => ({ id, title: `台词 ${index}`, fileName: `${id}.wav`, createdAt: '2026-09-27T10:00:00Z', duration, settings: draft, segment: { cueId: `cue-${index}`, speakerId: `speaker-${index}`, speakerName: '', batchId: 'batch', index, targetClipId } });
  const a = make('a', 0, 2), b = make('b', 1, 3);
  const first = Timeline.accept(draft, [b, a]);
  expect(first.timeline!.tracks[0].clips.map(c => [c.start, c.duration])).toEqual([[0, 2], [2, 3]]);
  expect(Timeline.accept(first, [b, a])).toBe(first);
  const trimmed = { ...first, timeline: Timeline.trimEdge(Timeline.trimEdge(first.timeline!, 'a', 'end', -0.5, 2), 'a', 'start', 0.25, 2) };
  expect(trimmed.timeline!.tracks[0].clips[0]).toMatchObject({ offset: 0.25, duration: 1.25 });
  const retry = make('retry', 0, 4, 'a');
  const replaced = Timeline.accept(trimmed, [retry, b, a]);
  expect(replaced.timeline!.tracks[0].clips).toEqual([
    { id: 'a', generationId: 'retry', start: 0.25, offset: 0, duration: 4 },
    { id: 'b', generationId: 'b', start: 4.75, offset: 0, duration: 3 },
  ]);
  replaced.timeline!.tracks[0].clips = [];
  expect(Timeline.accept(replaced, [retry, b, a])).toBe(replaced);
  const late = Timeline.accept(replaced, [make('late', 0, 1, 'a'), retry, b, a]);
  expect(late.timeline!.tracks[0].clips).toHaveLength(0);
});

test('分段音轨自动呈现、裁剪和删除持久化、按编辑结果导出 WAV', async ({ page }, testInfo) => {
  const state = emptyState(); const draft = state.drafts[0];
  draft.text = '第一句\n第二句'; draft.kind = 'story';
  draft.subtitles = { speakers: [{ id: 'speaker-1', sourceName: '旁白' }, { id: 'speaker-2', sourceName: '人物' }], cues: [{ id: 'cue-1', speakerId: 'speaker-1', start: 0, end: 2000, text: '第一句' }, { id: 'cue-2', speakerId: 'speaker-2', start: 2000, end: 4000, text: '第二句' }] };
  state.history = [2, 1].map(index => ({ id: String(index).repeat(32), title: index === 1 ? '第一句' : '第二句', fileName: 'segments.wav', createdAt: `2026-09-27T10:00:0${index}Z`, duration: 2, settings: { ...draft, subtitles: undefined, text: index === 1 ? '第一句' : '第二句' }, segment: { batchId: '3'.repeat(32), index: index - 1, cueId: `cue-${index}`, speakerId: `speaker-${index}`, speakerName: index === 1 ? '旁白' : '人物' } }));
  await page.goto('/');
  await page.evaluate(async () => {
    const modulePath = '/src/shared/lib/sound.ts'; const { encodeWav } = await import(/* @vite-ignore */ modulePath);
    const audio = new AudioBuffer({ length: 48000, sampleRate: 24000, numberOfChannels: 1 }); audio.getChannelData(0).fill(0.25);
    const blob = encodeWav(audio);
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('voice-workbench-audio', 1); req.onupgradeneeded = () => req.result.createObjectStore('audio'); req.onerror = () => reject(req.error);
      req.onsuccess = () => { const db = req.result; const tx = db.transaction('audio', 'readwrite'); tx.objectStore('audio').put(blob, 'segments.wav'); tx.oncomplete = () => { db.close(); resolve(); }; };
    });
  });
  await seedState(page, state); await page.reload();
  await expect(page.locator('.multitrack-clip')).toHaveCount(2);
  await page.locator('.multitrack-clip').first().click();
  await expect(page.getByRole('button', { name: '重新生成片段', exact: true })).toBeEnabled();
  const laneBefore = (await page.locator('.multitrack-lane').first().boundingBox())!;
  await expect(page.locator('.multitrack-selection')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.multitrack-clip[aria-pressed="true"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '删除片段', exact: true })).toBeDisabled();
  await page.locator('.multitrack-clip').first().click();
  await page.locator('.multitrack-lane').first().click({ position: { x: laneBefore.width - 10, y: laneBefore.height - 2 } });
  await expect(page.locator('.multitrack-clip[aria-pressed="true"]')).toHaveCount(0);
  expect(await page.locator('.multitrack-lane').first().boundingBox()).toEqual(laneBefore);
  await dragEdge(page, page.locator('.multitrack-clip').first(), 'start', 0.5, 2);
  await dragEdge(page, page.locator('.multitrack-clip').first(), 'start', -0.5, 1.5);
  await expect(page.locator('.multitrack-region').first().getByRole('slider').first()).toHaveAttribute('aria-valuenow', '0');
  const grip = (await page.locator('.multitrack-trim[data-edge="end"]').first().boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2); await page.mouse.down();
  await page.mouse.move(grip.x - 20, grip.y + grip.height / 2);
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(page.locator('.multitrack-region').first().getByRole('slider').last()).toHaveAttribute('aria-valuenow', '2');
  for (let i = 0; i < 3; i++) await page.locator('.track-zoom button').last().click();
  await dragEdge(page, page.locator('.multitrack-clip').nth(1), 'start', 0.25, 2);
  await expect(page.locator('.multitrack-region').nth(1).getByRole('slider').first()).toHaveAttribute('aria-valuenow', '0.25');
  await dragEdge(page, page.locator('.multitrack-clip').nth(1), 'start', -0.25, 1.75);
  await page.locator('.track-zoom button').nth(1).click();
  await dragEdge(page, page.locator('.multitrack-clip').first(), 'end', -0.5, 2);
  await dragEdge(page, page.locator('.multitrack-clip').first(), 'start', 0.5, 1.5);
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '导出音轨', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 WAV', exact: true }).click();
  const file = await download; await file.saveAs(testInfo.outputPath('edited.wav'));
  const { readFile } = await import('node:fs/promises'); const bytes = await readFile(testInfo.outputPath('edited.wav'));
  expect(bytes.toString('ascii', 0, 4)).toBe('RIFF'); expect(bytes.readUInt32LE(24)).toBe(24000);
  expect(bytes.readUInt32LE(40) / 2 / 24000).toBe(4);
  expect(bytes.readInt16LE(44 + 12000 * 2)).toBeGreaterThan(8000);
  // 鼠标拖拽有像素取整误差，在静音区中间取样，避免正好落在 1.5 秒裁剪边界。
  expect(bytes.readInt16LE(44 + 42000 * 2)).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('segmented-timeline.png') });
  await page.getByRole('button', { name: '删除片段', exact: true }).click();
  await expect(page.locator('.multitrack-clip')).toHaveCount(1);
  await expect(page.getByText('已保存', { exact: true })).toBeVisible(); await page.reload();
  await expect(page.locator('.multitrack-clip')).toHaveCount(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1')!).history.length)).toBe(2);
});

test('离线合成保留空隙、裁剪、重叠且忽略静音音轨', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const modulePath = '/src/features/media/timeline.ts'; const { Timeline } = await import(/* @vite-ignore */ modulePath);
    const source = new AudioBuffer({ length: 48000, numberOfChannels: 1, sampleRate: 24000 });
    source.getChannelData(0).fill(0.2, 0, 24000); source.getChannelData(0).fill(0.3, 24000);
    const result = await Timeline.render({ tracks: [
      { id: 'a', name: 'a', muted: false, clips: [{ id: 'a', generationId: 'source', start: 1, offset: 1, duration: 1 }, { id: 'b', generationId: 'source', start: 1.5, offset: 0, duration: 1 }] },
      { id: 'muted', name: 'muted', muted: true, clips: [{ id: 'c', generationId: 'missing', start: 0, offset: 0, duration: 10 }] },
    ] }, async (id: string) => { if (id !== 'source') throw new Error('读取了静音音源'); return source; });
    return { duration: result.duration, samples: [0.5, 1.25, 1.75, 2.25].map(t => result.getChannelData(0)[Math.floor(t * result.sampleRate)]) };
  });
  expect(result.duration).toBe(2.5);
  result.samples.forEach((value, i) => expect(value).toBeCloseTo([0, 0.3, 0.5, 0.2][i], 4));
});


test('音轨末尾上传独立素材，裁剪后保存重载与导出', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新增音轨', exact: true }).click();
  const add = page.getByRole('button', { name: '添加音频到音轨 1', exact: true });
  await add.click();
  await page.getByRole('menuitem', { name: '从历史版本添加', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('暂无匹配的生成音频')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.multitrack-clip')).toHaveCount(0);
  await add.click();
  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: '上传音频', exact: true }).click();
  const wav = Buffer.alloc(44 + 16000 * 2 * 65);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  await (await choosing).setFiles({ name: '环境音.wav', mimeType: 'audio/wav', buffer: wav });
  const clip = page.locator('.multitrack-clip');
  await expect(clip).toHaveText('环境音');
  const end = (await clip.boundingBox())!;
  const trigger = (await add.boundingBox())!;
  expect(trigger.x).toBeGreaterThanOrEqual(end.x + end.width);
  expect(Math.abs(trigger.y + trigger.height / 2 - end.y - end.height / 2)).toBeLessThan(2);
  await clip.click();
  await expect(page.getByRole('button', { name: '重新生成片段', exact: true })).toBeDisabled();
  // 跨越一分钟的裁剪先主动缩放到完整音轨。
  await page.getByRole('button', { name: '适应完整音轨', exact: true }).click();
  await dragEdge(page, clip, 'end', -63.5, 65);
  await page.getByRole('button', { name: '适应完整音轨', exact: true }).click();
  await dragEdge(page, clip, 'start', 0.5, 1.5);
  const undo = page.getByRole('button', { name: '撤销', exact: true });
  const redo = page.getByRole('button', { name: '重做', exact: true });
  await undo.click();
  await expect(page.locator('.multitrack-trim[data-edge="start"]')).toHaveAttribute('aria-valuenow', '0');
  await undo.click();
  await expect(page.locator('.multitrack-trim[data-edge="end"]')).toHaveAttribute('aria-valuenow', '65');
  await redo.click(); await redo.click();
  await expect(page.locator('.multitrack-trim[data-edge="start"]')).toHaveAttribute('aria-valuenow', '0.5');
  await expect(redo).toBeDisabled();
  // 正文的原生撤销不能回退音轨。
  await page.locator('.script-editor').fill('测试撤销');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.multitrack-trim[data-edge="start"]')).toHaveAttribute('aria-valuenow', '0.5');
  await clip.click();
  await page.getByRole('button', { name: '删除片段', exact: true }).click();
  await expect(clip).toHaveCount(0);
  await undo.click(); await expect(clip).toHaveCount(1);
  await expect(redo).toBeEnabled();
  // 新编辑清除重做分支，静音与取消静音各为一步。
  await page.getByRole('button', { name: '静音音轨 1', exact: true }).click();
  await expect(redo).toBeDisabled();
  await undo.click();
  // 弹窗内快捷键不改变音轨。
  await page.getByRole('button', { name: '导出音轨', exact: true }).click();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.multitrack-trim[data-edge="start"]')).toHaveAttribute('aria-valuenow', '0.5');
  await page.keyboard.press('Escape');
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('.multitrack-clip')).toHaveText('环境音');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1')!));
  expect(stored.history).toHaveLength(0); expect(stored.voices).toHaveLength(0);
  expect(stored.drafts[0].timeline.tracks[0].clips[0]).toMatchObject({ start: 0.5, duration: 1, offset: 0.5 });
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.getByRole('button', { name: '导出音轨', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 WAV', exact: true }).click();
  await (await downloading).saveAs(testInfo.outputPath('imported.wav'));
  const { readFile } = await import('node:fs/promises');
  const bytes = await readFile(testInfo.outputPath('imported.wav'));
  expect(bytes.readUInt32LE(40) / 2 / 24000).toBe(1.5);
});

test('旧字幕故事保留最后一版整篇音频为片段，删除后不复活', () => {
  const draft = { ...emptyState().drafts[0], kind: 'subtitle' as const };
  const audio = { id: 'legacy', title: draft.title, fileName: 'legacy.wav', duration: 3, createdAt: '2026-09-27T10:00:00Z', settings: draft };
  const migrated = Timeline.accept(draft, [audio]);
  expect(migrated.timeline!.tracks[0].clips[0]).toMatchObject({ generationId: audio.id, duration: 3 });
  expect(migrated.timeline!.tracks[0].id).not.toBe(migrated.timeline!.tracks[0].clips[0].id);
  expect(Timeline.accept(migrated, [audio])).toBe(migrated);
  migrated.timeline!.tracks = [];
  expect(Timeline.accept(migrated, [audio])).toBe(migrated);
});


test('新建作品不预留空版本行，最后一条空音轨可删除并持久化', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.player-version-row')).toHaveCount(0);
  const add = page.getByRole('button', { name: '新增音轨', exact: true });
  await expect(page.locator('.audio-panel')).toHaveCSS('height', '100px');
  const ruler = (await page.locator('.time-ruler').boundingBox())!;
  const button = (await add.boundingBox())!;
  expect(Math.abs(button.y - ruler.y - ruler.height)).toBeLessThan(2);
  await add.click();
  await expect(page.locator('.multitrack-row')).toHaveCount(1);
  const remove = page.getByRole('button', { name: '删除音轨 1（仅空轨）', exact: true });
  await expect(remove).toBeEnabled();
  await expect(page.locator('.audio-panel')).toHaveCSS('height', '148px');
  await remove.click();
  await expect(page.locator('.audio-panel')).toHaveCSS('height', '100px');
  await expect(page.locator('.multitrack-row')).toHaveCount(0);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.locator('.multitrack-row')).toHaveCount(1);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(page.locator('.multitrack-row')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1')!)?.drafts[0].timeline?.tracks)).toEqual([]);
  await page.reload();
  await expect(page.locator('.multitrack')).toBeVisible();
  await expect(page.locator('.multitrack-row')).toHaveCount(0);
  await add.click();
  await expect(page.locator('.multitrack-row')).toHaveCount(1);
  await expect(remove).toBeEnabled();
});
