import { test, expect } from '@playwright/test';
import { Timeline, TimelineHistory } from '../src/features/media/timeline';
import { emptyState, cueAudioStatus, type AudioTimeline } from '../src/shared/workbench';

// 不打开页面，直接校验时间线（Timeline）编辑、裁剪、磁吸与历史撤销的核心纯算法。

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

test('背景压低在说话前让位、句间短停顿保持压低、说完后平滑回来', () => {
  const voice = (id: string, start: number, duration: number) => ({ id, generationId: id, start, offset: 0, duration });
  const tracks = [
    { id: 'v', name: '旁白', muted: false, clips: [voice('a', 2, 2), voice('b', 4.8, 2), voice('c', 10, 1)] },
    { id: 'm', name: '配乐', muted: false, duckDb: 12, clips: [{ id: 'bgm', assetId: 'bgm', start: 0, offset: 0, duration: 12 }] },
  ];
  const duck = Timeline.ducking(tracks);
  expect(duck(1)).toBe(0);
  expect(duck(1.8)).toBeGreaterThan(0);
  expect(duck(1.8)).toBeLessThan(1);
  expect(duck(2)).toBe(1);
  // 两句之间 0.8 秒的停顿不让音乐回升。
  expect(duck(4.4)).toBe(1);
  // 说完后 0.6 秒内平滑回到原音量。
  expect(duck(7.1)).toBeGreaterThan(0);
  expect(duck(7.1)).toBeLessThan(1);
  expect(duck(7.5)).toBe(0);
  // 相隔较远的下一句重新压低。
  expect(duck(9)).toBe(0);
  expect(duck(10.5)).toBe(1);
  // 压低轨自己的片段不算说话。
  expect(Timeline.ducking([tracks[1]])(5)).toBe(0);
});

test('均衡角色音量：各角色调到同一水平，保留同角色片段之间的手动差别，重复执行不再变化', () => {
  const tone = (level: number) => ({ sampleRate: 100, numberOfChannels: 1, length: 100, getChannelData: () => new Float32Array(100).fill(level) }) as unknown as AudioBuffer;
  const buffers = new Map([['loud', tone(0.5)], ['quiet', tone(0.05)], ['bgm', tone(0.3)]]);
  const draft = emptyState().drafts[0];
  const line = (id: string, speakerId: string) => ({ id, title: id, fileName: `${id}.wav`, createdAt: '2026-11-14T00:00:00Z', duration: 1, settings: draft, segment: { batchId: 'b', index: 0, cueId: id, speakerId, speakerName: speakerId } });
  const history = [line('loud', 'a'), line('quiet', 'b')];
  const value: AudioTimeline = { tracks: [
    { id: 'voice', name: '对白', muted: false, clips: [
      { id: 'a1', generationId: 'loud', start: 0, offset: 0, duration: 1 },
      { id: 'a2', generationId: 'loud', start: 1, offset: 0, duration: 1, gainDb: -6 },
      { id: 'b1', generationId: 'quiet', start: 2, offset: 0, duration: 1 },
    ] },
    { id: 'music', name: '配乐', muted: false, clips: [{ id: 'm', assetId: 'bgm', start: 0, offset: 0, duration: 3 }] },
  ] };
  const balanced = Timeline.balance(value, history, buffers);
  const gain = (id: string) => balanced.tracks.flatMap(t => t.clips).find(c => c.id === id)!.gainDb ?? 0;
  const level = (id: string, source: number) => 20 * Math.log10(source) + gain(id);
  // 两个角色的音量拉到相近：原来差 20 dB，现在 1 dB 以内。
  expect(Math.abs(level('b1', 0.05) - (level('a1', 0.5) + level('a2', 0.5)) / 2)).toBeLessThan(1);
  // 同一角色里手动压低的那句仍比另一句低 6 dB；没有角色的素材不动。
  expect(gain('a1') - gain('a2')).toBeCloseTo(6, 1);
  expect(gain('m')).toBe(0);
  const again = Timeline.balance(balanced, history, buffers).tracks.flatMap(t => t.clips).map(c => c.gainDb ?? 0);
  balanced.tracks.flatMap(t => t.clips).forEach((c, i) => expect(again[i]).toBeCloseTo(c.gainDb ?? 0, 1));
});
