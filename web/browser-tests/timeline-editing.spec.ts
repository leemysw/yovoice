import { test, expect, type Page } from '@playwright/test';
import { seedState } from './seed';
import { Timeline } from '../src/features/media/timeline';
import { emptyState, cueAudioStatus, type AudioTimeline, type State } from '../src/shared/workbench';

async function seedTimeline(page: Page, state: State) {
  await page.evaluate(async () => {
    const path = '/src/shared/lib/sound.ts'; const { encodeWav } = await import(/* @vite-ignore */ path);
    const audio = new AudioBuffer({ length: 48000, sampleRate: 24000, numberOfChannels: 1 }); const samples = audio.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i / 35) * (.12 + .5 * Math.sin(i / 2600) ** 2) * Math.sin(Math.PI * i / samples.length);
    await new Promise<void>((resolve, reject) => { const req = indexedDB.open('voice-workbench-audio', 1); req.onupgradeneeded = () => req.result.createObjectStore('audio'); req.onerror = () => reject(req.error); req.onsuccess = () => { const db = req.result; const tx = db.transaction('audio', 'readwrite'); tx.objectStore('audio').put(encodeWav(audio), 'g.wav'); tx.oncomplete = () => { db.close(); resolve(); }; }; });
  }); await seedState(page, state); await page.reload();
}

test('多选保持相对位置，锁轨保护，波纹删除不影响其他轨', () => {
  const value: AudioTimeline = { tracks: [
    { id: 'a', name: '对白', muted: false, clips: [{ id: 'a', start: 1, offset: 0, duration: 2, generationId: 'g' }, { id: 'b', start: 2, offset: 0, duration: 2, generationId: 'g' }, { id: 'c', start: 5, offset: 0, duration: 1, generationId: 'g' }] },
    { id: 'b', name: '音乐', muted: false, clips: [{ id: 'music', start: 0, offset: 0, duration: 10, assetId: 'm' }] },
  ] };
  expect(Timeline.moveGroup(value, ['a', 'b'], -100).tracks[0].clips.map(c => c.start)).toEqual([0, 1, 5]);
  expect(Timeline.remove(value, ['a', 'b'], true).tracks.map(t => t.clips.map(c => c.start))).toEqual([[2], [0]]);
  expect(Timeline.remove(value, ['a']).tracks[0].clips.map(c => c.start)).toEqual([2, 5]);
  expect(Timeline.snap(value, ['a'], [4.96], 0.1, 9)).toEqual({ delta: 5 - 4.96, guide: 5 });
  const locked = { ...value, tracks: value.tracks.map(t => ({ ...t, locked: true })) };
  expect(Timeline.moveGroup(locked, ['a'], 1)).toBe(locked);
  expect(Timeline.remove(locked, ['a'], true)).toEqual(locked);
  expect(Timeline.split(locked, 'a', 2)).toEqual(locked);
  expect(Timeline.paste(value, [{ clip: value.tracks[0].clips[0], lane: 0 }, { clip: value.tracks[0].clips[1], lane: 0 }], 10, 0).tracks[0].clips.slice(-2).map(c => c.start)).toEqual([10, 11]);
  expect(Timeline.gap(value, 'c', .5).tracks[0].clips.at(-1)?.start).toBe(4.5);
});

test('对白状态比较文本及角色参数，旧保位设置下重生成仍自动顺延', () => {
  const draft = emptyState().drafts[0];
  const cue = { id: 'cue', speakerId: 's', text: '台词', start: 0, end: 1000 };
  draft.subtitles = { cues: [cue], speakers: [{ id: 's', sourceName: '旁白' }] };
  draft.timeline = { regenerateMode: 'preserve', tracks: [{ id: 't', name: 't', muted: false, clips: [{ id: 'c', generationId: 'g', start: 0, offset: 0, duration: 1 }, { id: 'b', generationId: 'b', start: 1, offset: 0, duration: 1 }] }] };
  const g = { id: 'g', title: '台词', fileName: 'g.wav', duration: 1, createdAt: '', settings: { ...draft, text: '台词' }, segment: { cueId: 'cue', speakerId: 's', speakerName: '', index: 0, batchId: 'batch' } };
  expect(cueAudioStatus(draft, [g], cue)).toBe('ready');
  expect(cueAudioStatus(draft, [g], { ...cue, text: '已改' })).toBe('stale');
  expect(cueAudioStatus({ ...draft, timeline: { tracks: [] } }, [g], cue)).toBe('missing');
  const updated = Timeline.accept(draft, [{ ...g, id: 'new', duration: 3, segment: { ...g.segment, targetClipId: 'c', placement: 'preserve' } }]);
  expect(updated.timeline!.tracks[0].clips.map(c => c.start)).toEqual([0, 3]);
});

test('共同渲染保留音轨音量、独听、压低及范围导出，忽略旧淡化', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/src/features/media/timeline.ts'; const { Timeline } = await import(/* @vite-ignore */ path);
    const buffer = new AudioBuffer({ length: 96000, sampleRate: 24000, numberOfChannels: 1 }); buffer.getChannelData(0).fill(.5);
    const base = { tracks: [{ id: 'v', name: 'v', muted: false, gainDb: -6, clips: [{ id: 'v', generationId: 'v', start: 1, offset: 0, duration: 2, fadeIn: .5, fadeOut: .5 }] }, { id: 'm', name: 'm', muted: false, duckDb: 12, clips: [{ id: 'm', assetId: 'm', start: 0, offset: 0, duration: 4 }] }] };
    const mixed = await Timeline.render(base, async () => buffer);
    const selected = await Timeline.render({ ...base, tracks: [{ ...base.tracks[0], solo: true }, base.tracks[1]] }, async () => buffer, { start: 1, end: 3 });
    return { samples: [.5, 1, 1.25, 2, 2.75, 3.5].map(t => mixed.getChannelData(0)[Math.floor(t * 24000)]), duration: selected.duration, selected: [.001, .25, 1, 1.75].map(t => selected.getChannelData(0)[Math.floor(t * 24000)]), peak: Timeline.peak(mixed) };
  });
  const voice = .5 * 10 ** (-6 / 20), music = .5 * 10 ** (-12 / 20);
  [.5, music + voice, music + voice, music + voice, music + voice, .5].forEach((x, i) => expect(result.samples[i]).toBeCloseTo(x, 3));
  expect(result.duration).toBe(2); result.selected.forEach(sample => expect(sample).toBeCloseTo(voice, 3)); expect(result.peak).toBeCloseTo(.5, 3);
});

test('菜单、多选快捷键、锁轨与标尺选区单次试听', async ({ page }, testInfo) => {
  await page.goto('/'); const state = emptyState(), d = state.drafts[0];
  d.kind = 'story'; d.subtitles = { speakers: [{ id: 's', sourceName: '旁白' }], cues: [{ id: 'c1', speakerId: 's', text: '第一句', start: 0, end: 2000 }, { id: 'c2', speakerId: 's', text: '第二句', start: 3000, end: 5000 }] };
  d.text = '第一句\n第二句';
  d.timeline = { tracks: [{ id: 't', name: '对白', muted: false, clips: [{ id: 'a', generationId: 'g', start: 0, offset: 0, duration: 2 }, { id: 'b', generationId: 'g2', start: 3, offset: 0, duration: 2 }] }] };
  state.history = ['g', 'g2'].map((id, index) => ({ id, title: `台词 ${index + 1}`, fileName: 'g.wav', duration: 2, createdAt: '', settings: d, segment: { batchId: 't', cueId: `c${index + 1}`, speakerId: 's', speakerName: '旁白', index } }));
  d.timeline.acceptedGenerations = ['g', 'g2'];
  await seedTimeline(page, state);
  await page.locator('.multitrack-clip').first().click();
  await expect(page.locator('.clip-fade, .clip-fade-curve, .clip-gain')).toHaveCount(0);
  await expect(page.locator('.multitrack-region').first().getByRole('slider')).toHaveCount(2);
  await page.locator('.multitrack-clip').first().click(); await page.keyboard.press('Escape');
  await expect(page.locator('.multitrack-region[data-selected="true"]')).toHaveCount(0);
  await page.locator('[data-cue-index="0"] textarea').click();
  await expect(page.locator('.multitrack-region[data-selected="true"]')).toHaveAttribute('data-clip-id', 'a');
  await page.locator('.multitrack-clip').first().click({ button: 'right' });
  const context = page.getByRole('menu', { name: '剪辑菜单' });
  await expect(context).toBeVisible(); await expect(context.getByRole('menuitem', { name: /复制一份/ })).toBeEnabled();
  // macOS 上右键菜单打开后焦点可能仍在剪辑上，Esc 也要能关闭菜单。
  await page.locator('.multitrack-clip').first().focus();
  await page.keyboard.press('Escape'); await expect(context).toHaveCount(0);
  await page.locator('.multitrack-clip').nth(1).click({ modifiers: ['Meta'] });
  await expect(page.locator('.multitrack-region[data-selected="true"]')).toHaveCount(2);
  await page.keyboard.press('Meta+d'); await expect(page.locator('.multitrack-clip')).toHaveCount(4);
  await page.keyboard.press('Meta+z'); await expect(page.locator('.multitrack-clip')).toHaveCount(2);
  await page.getByRole('button', { name: '对白 设置', exact: true }).click();
  await page.getByRole('button', { name: '锁定音轨', exact: true }).click(); await page.keyboard.press('Escape');
  await page.locator('.multitrack-clip').first().click(); await page.keyboard.press('Delete'); await expect(page.locator('.multitrack-clip')).toHaveCount(2);
  await page.getByRole('button', { name: '对白 设置', exact: true }).click(); await page.getByRole('button', { name: '解锁音轨', exact: true }).click(); await page.keyboard.press('Escape');
  const ruler = (await page.locator('.multitrack-ruler').boundingBox())!;
  await page.mouse.move(ruler.x + ruler.width * .05, ruler.y + ruler.height / 2); await page.mouse.down(); await page.mouse.move(ruler.x + ruler.width * .15, ruler.y + ruler.height / 2, { steps: 5 }); await page.mouse.up();
  await expect(page.locator('.multitrack-ruler .timeline-range')).toBeVisible();
  await expect(page.getByRole('button', { name: '循环试听', exact: true })).toHaveCount(0);
  await page.locator('.multitrack-clip').first().focus(); await page.keyboard.press('Shift+l');
  await page.getByRole('button', { name: '播放', exact: true }).click(); await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeVisible({ timeout: 2500 });
  await expect(page.getByRole('button', { name: '音轨选项', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '场景标记', exact: true })).toHaveCount(0);
  await page.locator('.multitrack-clip').first().focus(); await page.keyboard.press('m');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('editing.png') });
  await page.getByRole('button', { name: '放大音轨', exact: true }).click();
  const scroll = page.locator('.multitrack-scroll');
  const viewport = (await scroll.boundingBox())!, x = viewport.x + viewport.width * .6;
  const beforeZoom = (await page.locator('.multitrack-ruler').boundingBox())!;
  await page.mouse.move(x, viewport.y + 15); await page.keyboard.down('Control'); await page.mouse.wheel(0, -100); await page.keyboard.up('Control');
  await expect(page.getByRole('button', { name: '适应完整音轨', exact: true })).toHaveText('250%');
  const afterZoom = (await page.locator('.multitrack-ruler').boundingBox())!;
  expect((x - beforeZoom.x) / beforeZoom.width).toBeCloseTo((x - afterZoom.x) / afterZoom.width, 2);
  await scroll.evaluate(e => { e.scrollLeft = 0; });
  const body = (await page.locator('.multitrack-clip').first().boundingBox())!;
  await page.keyboard.down('Alt'); await page.mouse.move(body.x + body.width / 2, body.y + body.height / 2); await page.mouse.down();
  await page.mouse.move(viewport.x + viewport.width - 5, body.y + body.height / 2, { steps: 8 });
  await expect.poll(() => scroll.evaluate(e => e.scrollLeft)).toBeGreaterThan(60);
  await page.mouse.up(); await page.keyboard.up('Alt');
  await page.keyboard.press('Meta+z');
  await expect.poll(async () => page.locator('[data-clip-id="a"]').evaluate(e => e.style.left)).toBe('0%');
});

test('长故事默认展开并横向滚动，显示全部仅由用户主动触发', async ({ page }, testInfo) => {
  await page.goto('/'); const state = emptyState(), draft = state.drafts[0];
  draft.timeline = { tracks: [{ id: 't', name: '对白', muted: false, clips: Array.from({ length: 83 }, (_, i) => ({ id: `clip-${i}`, generationId: 'g', start: i * 2, offset: 0, duration: 2 })) }] };
  state.history = [{ id: 'g', title: '悟空，一棒打下，妖精脱了躯壳逃走。', fileName: 'g.wav', duration: 2, createdAt: '', settings: draft }];
  await seedTimeline(page, state);
  const scroll = page.locator('.multitrack-scroll'), first = page.locator('.multitrack-clip').first();
  const initial = (await first.boundingBox())!;
  expect(initial.width).toBeGreaterThan(150);
  await expect.poll(() => scroll.evaluate(e => e.scrollWidth / e.clientWidth)).toBeGreaterThan(10);
  await expect(page.getByRole('button', { name: '适应完整音轨', exact: true })).toHaveText('100%');
  await page.screenshot({ path: testInfo.outputPath('long-story.png') });
  await scroll.evaluate(e => { e.scrollLeft = e.scrollWidth - e.clientWidth; });
  await expect.poll(async () => Number((await page.locator('.timeline-tick').first().textContent())!.replace('s', ''))).toBeGreaterThan(140);
  await expect(page.locator('.timeline-tick')).not.toHaveCount(0);
  expect(await page.locator('.timeline-tick').count()).toBeLessThan(30);
  expect((await first.boundingBox())!.width).toBeCloseTo(initial.width, 1);
  await page.getByRole('button', { name: '适应完整音轨', exact: true }).click();
  await expect.poll(() => scroll.evaluate(e => e.scrollWidth - e.clientWidth)).toBeLessThan(2);
  expect((await first.boundingBox())!.width).toBeLessThan(30);
});

test('磁吸裁剪按实际时长带动同轨后续片段，保留间隙及其他轨道', () => {
  const value: AudioTimeline = { tracks: [
    { id: 't', name: '对白', muted: false, clips: [
      { id: 'a', generationId: 'g', start: 0, offset: 1, duration: 2 },
      { id: 'b', generationId: 'g', start: 2, offset: 0, duration: 2 },
      { id: 'c', generationId: 'g', start: 5, offset: 0, duration: 2 },
    ] },
    { id: 'm', name: '音乐', muted: false, clips: [{ id: 'm', generationId: 'g', start: 0, offset: 0, duration: 8 }] },
  ] };
  const cropped = Timeline.trimEdge(value, 'a', 'end', -1, 4, true);
  expect(cropped.tracks[0].clips.map(c => [c.start, c.duration])).toEqual([[0, 1], [1, 2], [4, 2]]);
  expect(cropped.tracks[1]).toEqual(value.tracks[1]);
  expect(Timeline.trimEdge(cropped, 'a', 'end', 1, 4, true)).toEqual(value);
  expect(Timeline.trimEdge(value, 'a', 'end', 100, 4, true).tracks[0].clips.map(c => c.start)).toEqual([0, 3, 6]);
  const head = Timeline.trimEdge(value, 'a', 'start', 1, 4, true);
  expect(head.tracks[0].clips[0]).toMatchObject({ start: 0, offset: 2, duration: 1 });
  expect(head.tracks[0].clips.map(c => c.start)).toEqual([0, 1, 4]);
  expect(Timeline.trimEdge(head, 'a', 'start', -1, 4, true)).toEqual(value);
  expect(Timeline.trimEdge(value, 'a', 'start', -100, 4, true).tracks[0].clips[0]).toMatchObject({ start: 0, offset: 0, duration: 3 });
  expect(Timeline.trimEdge(value, 'a', 'end', -1, 4, false).tracks[0].clips.map(c => c.start)).toEqual([0, 2, 5]);
  const limit = { ...value, tracks: [{ ...value.tracks[0], clips: [...value.tracks[0].clips, { id: 'limit', generationId: 'g', start: 86398, offset: 0, duration: 2 }] }] };
  expect(Timeline.trimEdge(limit, 'a', 'end', 1, 4, true)).toBe(limit);
  expect(Timeline.trimEdge(limit, 'a', 'start', -1, 4, true)).toBe(limit);
  const locked = { ...value, tracks: value.tracks.map(t => ({ ...t, locked: true })) };
  expect(Timeline.trimEdge(locked, 'a', 'end', -1, 4, true)).toBe(locked);
});

test('点击定位，按压边缘不缩放，默认磁吸裁剪支持撤销及 Alt 自由裁剪', async ({ page }, testInfo) => {
  await page.goto('/'); const state = emptyState(), draft = state.drafts[0];
  draft.kind = 'story'; draft.text = '第一句\n第二句';
  draft.subtitles = { speakers: [{ id: 's', sourceName: '旁白' }], cues: [
    { id: 'c1', speakerId: 's', text: '第一句', start: 0, end: 2000 },
    { id: 'c2', speakerId: 's', text: '第二句', start: 2000, end: 4000 },
  ] };
  draft.timeline = { acceptedGenerations: ['g', 'g2'], tracks: [{ id: 't', name: '对白', muted: false, clips: [
    { id: 'a', generationId: 'g', start: 0, offset: 0, duration: 2 },
    { id: 'b', generationId: 'g2', start: 2, offset: 0, duration: 2 },
  ] }] };
  state.history = ['g', 'g2'].map((id, i) => ({ id, title: `台词 ${i + 1}`, fileName: 'g.wav', duration: 2, createdAt: '', settings: draft, segment: { batchId: 't', cueId: `c${i + 1}`, speakerId: 's', speakerName: '旁白', index: i } }));
  await seedTimeline(page, state);
  const first = page.locator('[data-clip-id="a"]'), second = page.locator('[data-clip-id="b"]');
  const progress = page.getByRole('slider', { name: '播放进度', exact: true });
  const original = (await first.boundingBox())!;
  await page.mouse.move(original.x + original.width / 2, original.y + original.height / 2); await page.mouse.down();
  await expect.poll(() => first.locator('.multitrack-clip').evaluate(e => getComputedStyle(e).transform)).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
  expect((await first.locator('.multitrack-clip').boundingBox())!.width).toBeCloseTo(original.width, 1);
  await page.mouse.up();
  await expect.poll(async () => Number(await progress.inputValue())).toBeCloseTo(1, 1);
  await page.locator('[data-cue-index="1"] textarea').click(); await expect(progress).toHaveValue('2');
  const trim = first.locator('.multitrack-trim[data-edge="end"]');
  const edge = (await trim.boundingBox())!;
  const x = edge.x + edge.width - 1, y = edge.y + edge.height / 2;
  expect(edge.x + edge.width).toBeCloseTo(original.x + original.width, 1);
  await page.mouse.move(x, y); await page.mouse.down();
  await expect.poll(() => trim.evaluate(e => getComputedStyle(e).transform)).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
  await page.mouse.move(x - original.width / 2, y, { steps: 5 });
  await expect(trim).toHaveAttribute('aria-valuenow', '1');
  expect((await second.boundingBox())!.x).toBeCloseTo(original.x + original.width / 2, 0);
  await page.screenshot({ path: testInfo.outputPath('magnetic-trim.png') });
  await page.mouse.up();
  await page.keyboard.press('Meta+z'); await expect(trim).toHaveAttribute('aria-valuenow', '2');
  expect((await second.boundingBox())!.x).toBeCloseTo(original.x + original.width, 0);
  await page.keyboard.press('Meta+Shift+z'); await expect(trim).toHaveAttribute('aria-valuenow', '1');
  await page.keyboard.press('Meta+z');
  await page.keyboard.down('Alt'); await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x - original.width / 2, y, { steps: 5 }); await page.mouse.up(); await page.keyboard.up('Alt');
  await expect(trim).toHaveAttribute('aria-valuenow', '1');
  expect((await second.boundingBox())!.x).toBeCloseTo(original.x + original.width, 0);
  await page.keyboard.press('Meta+z');
  await trim.focus(); await trim.press('Shift+ArrowLeft');
  await expect(trim).toHaveAttribute('aria-valuenow', '1.9');
  expect((await second.boundingBox())!.x).toBeCloseTo(original.x + original.width * .95, 0);
  await page.keyboard.press('Meta+z');
  const lane = (await page.locator('.multitrack-lane').boundingBox())!;
  await page.mouse.click(lane.x + lane.width * .6, lane.y + lane.height / 2);
  await expect.poll(async () => Number(await progress.inputValue())).toBeCloseTo(6, 1);
  await expect(page.locator('.multitrack-region[data-selected="true"]')).toHaveCount(0);
});

test('磁吸移动把后续片段视为整体，前后移动不传递间隙', () => {
  const value: AudioTimeline = { tracks: [{ id: 't', name: '对白', muted: false, clips: [
    { id: 'a', start: 0, offset: 0, duration: 2 },
    { id: 'b', start: 3, offset: 0, duration: 2 },
    { id: 'c', start: 6, offset: 0, duration: 2 },
  ] }, { id: 'm', name: '背景', muted: false, clips: [{ id: 'm', start: 0, offset: 0, duration: 10 }] }] };
  const forward = Timeline.moveGroup(value, ['b'], 1, 0, true);
  expect(forward.tracks[0].clips.map(c => c.start)).toEqual([0, 4, 7]);
  expect(forward.tracks[1]).toEqual(value.tracks[1]);
  expect(Timeline.moveGroup(forward, ['b'], -1, 0, true)).toEqual(value);
  expect(Timeline.moveGroup(value, ['b'], -100, 0, true).tracks[0].clips.map(c => c.start)).toEqual([0, 2, 5]);
  expect(Timeline.moveGroup(value, ['b'], 1).tracks[0].clips.map(c => c.start)).toEqual([0, 4, 6]);
  expect(Timeline.following(value, ['b'])).toEqual(['b', 'c']);
});

test('磁吸按钮状态清晰，拖动主体时后续片段同步前后移动', async ({ page }) => {
  await page.goto('/'); const state = emptyState(), draft = state.drafts[0];
  draft.timeline = { tracks: [{ id: 't', name: '对白', muted: false, clips: [
    { id: 'a', generationId: 'g', start: 0, offset: 0, duration: 2 },
    { id: 'b', generationId: 'g', start: 3, offset: 0, duration: 2 },
    { id: 'c', generationId: 'g', start: 6, offset: 0, duration: 2 },
  ] }] };
  state.history = [{ id: 'g', title: '台词', fileName: 'g.wav', duration: 2, createdAt: '', settings: draft }];
  await seedTimeline(page, state);
  const magnet = page.getByRole('button', { name: '吸附', exact: true });
  await expect(magnet).toHaveAttribute('aria-pressed', 'true');
  const selectedColor = await magnet.evaluate(e => getComputedStyle(e).backgroundColor);
  await magnet.click(); await expect(magnet).toHaveAttribute('aria-pressed', 'false');
  expect(await magnet.evaluate(e => getComputedStyle(e).backgroundColor)).not.toBe(selectedColor);
  await magnet.click();
  const b = page.locator('[data-clip-id="b"]'), c = page.locator('[data-clip-id="c"]');
  const before = (await b.boundingBox())!, tail = (await c.boundingBox())!, pps = before.width / 2;
  const x = before.x + before.width / 2, y = before.y + before.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + pps, y, { steps: 5 });
  expect((await b.boundingBox())!.x).toBeCloseTo(before.x + pps, 0);
  expect((await c.boundingBox())!.x).toBeCloseTo(tail.x + pps, 0);
  await page.mouse.move(x - pps, y, { steps: 5 });
  expect((await b.boundingBox())!.x).toBeCloseTo(before.x - pps, 0);
  expect((await c.boundingBox())!.x).toBeCloseTo(tail.x - pps, 0);
  await page.mouse.up();
  await page.keyboard.press('Meta+z');
  expect((await c.boundingBox())!.x).toBeCloseTo(tail.x, 0);
  const trim = b.locator('.multitrack-trim[data-edge="end"]');
  await trim.focus();
  const grip = (await trim.boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2); await page.mouse.down();
  await expect(trim).toHaveCSS('outline-style', 'none');
  await expect(trim).toHaveCSS('box-shadow', 'none');
  await page.mouse.up();
});

test('移除待处理生成和跟随开关，滚动后播放仍自动跟随台词', async ({ page }) => {
  await page.goto('/'); const state = emptyState(), draft = state.drafts[0];
  draft.kind = 'story'; draft.text = '第一句\n第二句';
  draft.subtitles = { speakers: [{ id: 's', sourceName: '旁白' }], cues: [
    { id: 'c0', speakerId: 's', text: '第一句', start: 0, end: 1000 },
    { id: 'c1', speakerId: 's', text: '第二句', start: 1000, end: 2000 },
  ] };
  draft.timeline = { acceptedGenerations: ['g0', 'g1'], tracks: [{ id: 't', name: '对白', muted: false, clips: [0, 1].map(i => ({ id: `a${i}`, generationId: `g${i}`, start: i, offset: 0, duration: 1 })) }] };
  state.history = [0, 1].map(i => ({ id: `g${i}`, title: `台词 ${i}`, fileName: 'g.wav', duration: 2, createdAt: '', settings: draft, segment: { batchId: 't', cueId: `c${i}`, speakerId: 's', speakerName: '旁白', index: i } }));
  await seedTimeline(page, state);
  await expect(page.getByRole('button', { name: '生成待处理台词', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '跟随播放', exact: true })).toHaveCount(0);
  await page.evaluate(() => {
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function(options) {
      if (this.dataset.cueIndex) this.dataset.followed = 'true';
      original.call(this, options);
    };
  });
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(page.locator('[data-cue-index="0"]')).toHaveAttribute('data-followed', 'true');
  await page.locator('.subtitle-editor').dispatchEvent('wheel', { deltaY: -100 });
  await expect(page.locator('[data-cue-index="1"]')).toHaveAttribute('data-followed', 'true');
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeVisible();
});
