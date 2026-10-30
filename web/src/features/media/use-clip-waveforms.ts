import { useEffect, useEffectEvent, useRef, useState, type RefObject } from 'react';
import { mediaUrl, releaseMediaUrl } from '../../shared/lib/client';
import type { AudioTimeline } from '../../shared/workbench';
import { Timeline, type AudioSource } from './timeline';
import { resamplePeaks, waveform as readWaveform, type Waveform } from './waveform';

// 片段波形：按音频源读取峰值并缓存，随缩放重采样；音频源列表变化时顺带淘汰播放用的解码缓存。
export function useClipWaveforms({ value, zoom, suspended, audioSources, buffers }: {
  value: AudioTimeline; zoom: number; suspended: boolean; audioSources: Map<string, AudioSource>; buffers: RefObject<Map<string, AudioBuffer>>;
}) {
  const waves = useRef(new Map<string, Waveform>());
  const [peaks, setPeaks] = useState<Record<string, number[]>>({});
  // 读不到的音频源：片段上直接标出，不主动弹出提示；播放时仍会读取并说明原因。
  const [unavailable, setUnavailable] = useState<Record<string, boolean>>({});
  const sourceIds = [...new Set(value.tracks.flatMap(track => track.clips.map(c => Timeline.sourceKey(c))))].sort().join(',');
  // 片段不再引用的音频源，解码缓存随之丢弃，长时间编辑不会越积越多；波形峰值很小，保留以便撤销时复用。
  useEffect(() => {
    const used = new Set(sourceIds.split(',').filter(Boolean));
    for (const id of [...buffers.current.keys()]) if (!used.has(id)) buffers.current.delete(id);
  }, [sourceIds, buffers]);
  // 读取音频源的波形（最高缩放级别的峰值），结果缓存，加载使用最新的音频源列表。
  const loadWave = useEffectEvent(async (id: string, signal: AbortSignal): Promise<Waveform> => {
    const cached = waves.current.get(id);
    if (cached) return cached;
    const generation = audioSources.get(id);
    if (!generation) throw new Error('@yovoice.error.audioMissing');
    const url = await mediaUrl('outputs', generation.fileName);
    try {
      const wave = await readWaveform(url, 400 * 32, signal);
      waves.current.set(id, wave);
      return wave;
    } finally { releaseMediaUrl(url); }
  });
  // 波形边读取边取峰值，不整段解码，长音频也不会拖住界面；每个音频源只读一次，缩放时按已有峰值合并。
  // 各页面常驻挂载，时间线不可见（suspended）时不读取，显示后再补齐。
  useEffect(() => {
    if (suspended) return;
    const controller = new AbortController();
    void (async () => {
      for (const id of sourceIds.split(',').filter(Boolean)) {
        try {
          const wave = await loadWave(id, controller.signal);
          if (controller.signal.aborted) return;
          const peaks = resamplePeaks(wave.peaks, Math.round(400 * zoom));
          setPeaks(previous => ({ ...previous, [id]: peaks }));
          setUnavailable(previous => previous[id] ? { ...previous, [id]: false } : previous);
        } catch { if (controller.signal.aborted) return; setUnavailable(previous => ({ ...previous, [id]: true })); }
      }
    })();
    return () => controller.abort();
  }, [sourceIds, zoom, suspended]);
  return { peaks, unavailable, waves };
}
