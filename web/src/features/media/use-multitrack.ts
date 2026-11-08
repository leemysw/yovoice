import { useEffect, useRef, useState } from 'react';
import { CallError, mediaUrl, releaseMediaUrl } from '../../shared/lib/client';
import { parseWavHeader, wavFrames, type WavFormat } from './waveform';
import mixerUrl from './stem-mixer.worklet.ts?worker&url';

export type MixTrack = { id: string; fileName: string };
export type TrackMix = { mute: boolean; solo: boolean; volume: number };

// 每次读取的块长（秒）与预读距离（秒）：播放头前面始终备好几秒，本机读取一块只要几毫秒。
const blockSeconds = 2;
const aheadSeconds = 6;

// 一条音轨的数据源：WAV 头信息和按帧读取。桌面端用 HTTP Range 只取需要的一段；
// 浏览器预览的音频是 blob 地址，文件很小，整段取一次再切片。
type Source = { id: string; format: WavFormat; frames: number; read: (start: number, frames: number) => Promise<Float32Array[]> };

async function openSource(id: string, url: string): Promise<Source> {
  const invalid = () => new CallError('@yovoice.error.audioReadFailed');
  if (url.startsWith('blob:')) {
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
    const format = parseWavHeader(bytes);
    if (!format || format === 'more') throw invalid();
    const frames = Math.floor(Math.min(format.dataSize || Infinity, bytes.length - format.dataOffset) / format.align);
    return { id, format, frames, read: async (start, count) => wavFrames(bytes.subarray(format.dataOffset + start * format.align, format.dataOffset + (start + count) * format.align), format) };
  }
  const range = async (from: number, to: number) => {
    const response = await fetch(url, { headers: { Range: `bytes=${from}-${to}` } });
    if (!response.ok) throw invalid();
    return { bytes: new Uint8Array(await response.arrayBuffer()), total: Number(response.headers.get('content-range')?.split('/')[1]) || 0 };
  };
  let head = await range(0, 65535);
  let format = parseWavHeader(head.bytes);
  if (format === 'more') { head = await range(0, (1 << 20) - 1); format = parseWavHeader(head.bytes); }
  if (!format || format === 'more') throw invalid();
  const available = (head.total || head.bytes.length) - format.dataOffset;
  const frames = Math.floor((format.dataSize ? Math.min(format.dataSize, available) : available) / format.align);
  const known = format;
  return {
    id, format, frames,
    read: async (start, count) => wavFrames((await range(known.dataOffset + start * known.align, known.dataOffset + (start + count) * known.align - 1)).bytes, known),
  };
}

const gainOf = (mix: Record<string, TrackMix>, id: string) => {
  const soloing = Object.values(mix).some(item => item.solo);
  const item = mix[id];
  const audible = item ? (soloing ? item.solo : !item.mute) : !soloing;
  return audible ? Math.max(0, Math.min(1, item?.volume ?? 1)) : 0;
};

/**
 * 多轨同步播放，做法同 DAW：一个音频引擎、一个时钟。各轨的 WAV 按块从磁盘（本机服务的 Range 请求）流式读取，
 * 送进音频线程里的混音器（stem-mixer.worklet.ts）逐采样相加，所以各轨始终对齐，不需要事后纠偏；
 * 内存只占播放头前后几秒。静音、独奏、音量是混音器里的增益，切换不影响播放。
 * onFrame 在播放中逐帧、在定位和暂停时回调当前时间，调用方据此直接更新播放头，不必每帧重渲染。
 */
export function useMultitrack(tracks: MixTrack[], mix: Record<string, TrackMix>, onFrame: (time: number) => void, onError: (error: unknown) => void) {
  const context = useRef<AudioContext | null>(null);
  const node = useRef<AudioWorkletNode | null>(null);
  const sources = useRef<Source[]>([]);
  // 每轨下一块要读的位置（该轨自己的帧）与是否有读取在途；generation 在定位时递增，旧的读取结果作废。
  const loading = useRef(new Map<string, { next: number; busy: boolean }>());
  const generation = useRef(0);
  // 混音器最近一次报告的位置（输出帧）与收到时刻，播放头在两次报告之间按时间推算。
  const clock = useRef({ frame: 0, at: 0, playing: false });
  const frameRequest = useRef(0);
  const report = useRef(onFrame);
  report.current = onFrame;
  const fail = useRef(onError);
  fail.current = onError;
  const mixRef = useRef(mix);
  mixRef.current = mix;
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = tracks.map(track => `${track.id}:${track.fileName}`).join('|');

  const rate = () => context.current?.sampleRate ?? 44100;
  const now = () => {
    const { frame, at, playing: running } = clock.current;
    return (frame + (running ? (performance.now() - at) / 1000 * rate() : 0)) / rate();
  };

  // 预读：每轨把播放头之后 aheadSeconds 内的块读好送进混音器，一轨只同时读一块。
  const pump = (fromTime = now()) => {
    const mixer = node.current, ctx = context.current;
    if (!mixer || !ctx) return;
    const ticket = generation.current;
    for (const source of sources.current) {
      const state = loading.current.get(source.id);
      if (!state || state.busy) continue;
      const until = Math.min(source.frames, Math.ceil((fromTime + aheadSeconds) * source.format.sampleRate));
      if (state.next >= until) continue;
      const start = state.next, count = Math.min(Math.round(blockSeconds * source.format.sampleRate), source.frames - start);
      state.busy = true;
      void source.read(start, count).then(channels => {
        if (ticket !== generation.current) return;
        mixer.port.postMessage({ type: 'block', id: source.id, start, channels }, channels.map(channel => channel.buffer));
        state.next = start + count;
        state.busy = false;
        pump();
      }, error => { if (ticket === generation.current) { state.busy = false; fail.current(error); } });
    }
  };

  // 定位：作废在途读取，清空混音器里的块，从新位置先把第一块读好再继续（播放中定位不会先出一段静音）。
  const relocate = async (time: number) => {
    const mixer = node.current;
    if (!mixer) return;
    generation.current++;
    const ticket = generation.current;
    const frame = Math.round(time * rate());
    mixer.port.postMessage({ type: 'seek', frame });
    clock.current = { ...clock.current, frame, at: performance.now() };
    report.current(time);
    await Promise.all(sources.current.map(async source => {
      const start = Math.min(source.frames, Math.floor(time * source.format.sampleRate));
      const count = Math.min(Math.round(blockSeconds * source.format.sampleRate), source.frames - start);
      loading.current.set(source.id, { next: start + Math.max(0, count), busy: false });
      if (count <= 0) return;
      const channels = await source.read(start, count);
      if (ticket === generation.current) mixer.port.postMessage({ type: 'block', id: source.id, start, channels }, channels.map(channel => channel.buffer));
    }));
    if (ticket === generation.current) pump(time);
  };

  useEffect(() => {
    let cancelled = false;
    const got: Record<string, string> = {};
    let ctx: AudioContext | null = null;
    // 卸载时让在途读取作废（generation 是计数器，不是 DOM 引用）。
    const tickets = generation;
    void (async () => {
      for (const track of tracks) got[track.id] = await mediaUrl('outputs', track.fileName);
      const opened = await Promise.all(tracks.map(track => openSource(track.id, got[track.id])));
      if (cancelled || !opened.length) return;
      // 输出采样率取第一轨的，多数分轨都相同，混音器里无需重采样。
      try { ctx = new AudioContext({ sampleRate: opened[0].format.sampleRate, latencyHint: 'playback' }); } catch { ctx = new AudioContext({ latencyHint: 'playback' }); }
      await ctx.audioWorklet.addModule(mixerUrl);
      if (cancelled) return;
      const mixer = new AudioWorkletNode(ctx, 'stem-mixer', { numberOfInputs: 0, outputChannelCount: [2] });
      mixer.connect(ctx.destination);
      mixer.port.onmessage = (event: MessageEvent<{ type: string; frame: number; playing?: boolean }>) => {
        const message = event.data;
        clock.current = { frame: message.frame, at: performance.now(), playing: message.type === 'time' ? !!message.playing : false };
        if (message.type === 'ended') { cancelAnimationFrame(frameRequest.current); setPlaying(false); report.current(message.frame / (ctx?.sampleRate ?? 44100)); }
        else pump();
      };
      context.current = ctx; node.current = mixer; sources.current = opened;
      for (const source of opened) mixer.port.postMessage({ type: 'track', id: source.id, rate: source.format.sampleRate, frames: source.frames, gain: gainOf(mixRef.current, source.id) });
      setDuration(Math.max(...opened.map(source => source.frames / source.format.sampleRate)));
      setUrls(got);
      await relocate(0);
      if (!cancelled) setReady(true);
    })().catch(error => { if (!cancelled) fail.current(error); });
    return () => {
      cancelled = true;
      tickets.current++;
      cancelAnimationFrame(frameRequest.current);
      node.current?.disconnect();
      void ctx?.close().catch(() => undefined);
      Object.values(got).forEach(releaseMediaUrl);
      context.current = null; node.current = null; sources.current = []; loading.current = new Map();
      clock.current = { frame: 0, at: 0, playing: false };
      setReady(false);
      setPlaying(false);
    };
    // 轨道列表按内容（key）比较，同一组轨道重新渲染时不重建引擎。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // 静音、独奏、音量只改混音器里的增益。
  useEffect(() => {
    const mixer = node.current;
    if (!mixer) return;
    for (const source of sources.current) mixer.port.postMessage({ type: 'gain', id: source.id, value: gainOf(mix, source.id) });
  }, [mix, ready]);

  const tick = () => {
    report.current(Math.min(duration, now()));
    frameRequest.current = requestAnimationFrame(tick);
  };

  const play = async () => {
    const ctx = context.current, mixer = node.current;
    if (!ready || !ctx || !mixer) return;
    try { await ctx.resume(); } catch (error) { fail.current(error); return; }
    if (now() >= duration - 0.05) await relocate(0);
    mixer.port.postMessage({ type: 'play' });
    clock.current = { ...clock.current, at: performance.now(), playing: true };
    setPlaying(true);
    cancelAnimationFrame(frameRequest.current);
    frameRequest.current = requestAnimationFrame(tick);
  };

  const pause = () => {
    node.current?.port.postMessage({ type: 'pause' });
    const time = now();
    clock.current = { frame: Math.round(time * rate()), at: performance.now(), playing: false };
    cancelAnimationFrame(frameRequest.current);
    setPlaying(false);
    report.current(time);
  };

  const seek = (time: number) => { void relocate(Math.max(0, Math.min(duration, time))).catch(error => fail.current(error)); };

  return { ready, playing, duration, urls, play, pause, seek, toggle: () => (playing ? pause() : void play()) };
}
