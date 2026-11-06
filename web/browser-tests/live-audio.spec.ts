import { expect, test } from '@playwright/test';
import { LiveAudioPlayer } from '../src/features/media/live-audio-player';

function harness() {
  const starts: number[] = [];
  const stops: number[] = [];
  const decoders: ((buffer: {duration: number}) => void)[] = [];
  const sources: { onended: (() => void) | null }[] = [];
  const context = {
    state: 'running',
    currentTime: 1,
    createGain: () => ({ gain: { value: 1 }, connect() {} }),
    resume: async () => {},
    close: async () => {},
    decodeAudioData: () => new Promise(resolve => decoders.push(resolve)),
    createBufferSource: () => {
      const source = { onended: null, connect() {}, disconnect() {}, start: (time: number) => starts.push(time), stop: () => stops.push(1) };
      sources.push(source);
      return source;
    },
  };
  const player = new LiveAudioPlayer(() => context as unknown as AudioContext);
  let state = { active: false, error: '' };
  player.subscribe(value => { state = value; });
  player.prepare('project');
  player.receive({ event: 'audio', id: 'part', projectId: 'project', sequence: 0, start: true });
  const send = (sequence: number) => player.receive({ event: 'audio', id: 'part', projectId: 'project', sequence, audio: 'AA==' });
  return { player, starts, stops, decoders, send, sources, state: () => state };
}

test('流式片段顺序解码，结束事件不截断已排队的音频', async () => {
  const h = harness();
  h.send(1); h.send(2);
  h.player.receive({ event: 'audio-request-end', projectId: 'project' });
  await expect.poll(() => h.decoders.length).toBe(1);
  h.decoders[0]({duration: 1});
  await expect.poll(() => h.decoders.length).toBe(2);
  expect(h.state().active).toBe(true);
  h.decoders[1]({duration: 1});
  await expect.poll(() => h.starts.length).toBe(2);
  expect(h.starts[0]).toBeCloseTo(1.03);
  expect(h.starts[1]).toBeCloseTo(2.03);
  h.sources[0].onended?.();
  expect(h.state().active).toBe(true);
  h.sources[1].onended?.();
  await expect.poll(() => h.state().active).toBe(false);
  expect(h.stops).toEqual([]);
});

for (const reason of ['cancel', 'disconnect', 'project'] as const) {
  test(`异步解码后不恢复已停止的流式试听：${reason}`, async () => {
    const h = harness();
    h.send(1);
    await expect.poll(() => h.decoders.length).toBe(1);
    if (reason === 'cancel') h.player.receive({ event: 'audio-request-end', projectId: 'project', cancelled: true });
    if (reason === 'disconnect') h.player.receive({ event: 'audio-disconnected' });
    if (reason === 'project') h.player.setProject('another');
    h.decoders[0]({duration: 1});
    await new Promise(resolve => setImmediate(resolve));
    expect(h.starts).toEqual([]);
    expect(h.state().active).toBe(false);
  });
}
