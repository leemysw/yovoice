import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { mediaUrl, releaseMediaUrl } from '../../shared/lib/client';
import { noticeMessage } from '../../shared/lib/call-error';
import type { AudioTimeline, Draft, Generation } from '../../shared/workbench';
import { Timeline, type AudioSource } from './timeline';

// 时间线播放：音频上下文与解码缓存、片段按同一时钟调度、播放头推进与台词高亮上报，卸载时整体释放。
export function useTimelinePlayback({ value, duration, range, history, draft, audioSources, playbackCue, onError }: {
  value: AudioTimeline; duration: number; range?: { start: number; end: number }; history: Generation[]; draft: Draft;
  audioSources: Map<string, AudioSource>; playbackCue?: (index: number) => void; onError: (message: string) => void;
}) {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const context = useRef<AudioContext | null>(null);
  const buffers = useRef(new Map<string, AudioBuffer>());
  const sources = useRef<AudioBufferSourceNode[]>([]);
  const frame = useRef(0);
  const operation = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const stop = () => {
    operation.current++;
    cancelAnimationFrame(frame.current);
    for (const source of sources.current) { source.stop(); source.disconnect(); }
    sources.current = [];
    setPlaying(false); setLoading(false); playbackCue?.(-1);
  };
  // 卸载时释放播放节点、解码缓存与音频上下文。
  const release = useEffectEvent(() => {
    operation.current++; cancelAnimationFrame(frame.current); abort.current?.abort();
    for (const source of sources.current) { source.stop(); source.disconnect(); }
    sources.current = []; buffers.current.clear();
    const current = context.current; context.current = null;
    if (current) void current.close();
  });
  useEffect(() => {
    abort.current = new AbortController();
    return () => release();
  }, []);
  const load = async (id: string, audio: AudioContext): Promise<AudioBuffer> => {
    const cached = buffers.current.get(id);
    if (cached) return cached;
    const generation = audioSources.get(id);
    if (!generation) throw new Error('@yovoice.error.audioMissing');
    const url = await mediaUrl('outputs', generation.fileName);
    try {
      const response = await fetch(url, { signal: abort.current?.signal });
      if (!response.ok) throw new Error('@yovoice.error.audioReadFailed');
      const buffer = await audio.decodeAudioData(await response.arrayBuffer());
      buffers.current.set(id, buffer);
      return buffer;
    } finally { releaseMediaUrl(url); }
  };
  const play = async (audition?: { start: number; end: number }) => {
    if (playing || loading) { stop(); if (!audition) return; }
    const token = ++operation.current;
    setLoading(true);
    try {
      const audio = context.current ??= new AudioContext();
      await audio.resume();
      if (token !== operation.current) return;
      const target = audition ?? range;
      const from = target?.start ?? (time >= duration ? 0 : time);
      const to = target?.end ?? duration;
      const clips = Timeline.audible(value).flatMap(track => track.clips).filter(c => c.start + c.duration > from && c.start < to);
      // 先解码全部源，再共用同一时钟启动，避免音轨随加载速度错位。
      for (const id of new Set(clips.map(c => Timeline.sourceKey(c)))) {
        await load(id, audio);
        if (token !== operation.current) return;
      }
      const start = audio.currentTime + 0.05;
      const nodes = Timeline.schedule(audio, value, buffers.current, from, to, start);
      for (const node of nodes) { const cleanup = node.onended; node.onended = event => { cleanup?.call(node, event); sources.current = sources.current.filter(s => s !== node); }; }
      sources.current.push(...nodes);
      setLoading(false); setPlaying(true);
      const tick = () => {
        const next = Math.min(to, from + Math.max(0, audio.currentTime - start));
        setTime(next);
        const active = clips.find(c => c.start <= next && c.start + c.duration > next);
        const id = history.find(g => g.id === active?.generationId)?.segment?.cueId;
        playbackCue?.(draft.subtitles?.cues.findIndex(c => c.id === id) ?? -1);
        if (next >= to) stop();
        else frame.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (error) { if (token === operation.current) { stop(); onError(noticeMessage(error)); } }
  };
  const seek = (next: number) => { stop(); setTime(next); };
  return { time, setTime, playing, loading, context, buffers, abort, load, stop, play, seek };
}
