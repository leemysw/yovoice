import { useEffect, useRef, useState, type RefObject } from 'react';
import { mediaUrl, releaseMediaUrl } from '../../shared/lib/client';
import { noticeMessage } from '../../shared/lib/call-error';
import type { Generation } from '../../shared/workbench';
import { vocalActivity, type VocalActivity } from './lyric-align';
import { decodeAudio } from '../../shared/lib/sound';

// 包络的时间分辨率（秒）：封面与背景随响度起伏。
const envelopeStep = 0.05;

// 超过这个时长（秒）的音频不再整段解码分析，避免长音频占满内存拖住界面（#92）；封面不起伏、歌词按时长估算。
const analyseLimit = 15 * 60;

// 读取整首音频：算出每 50ms 的响度（0~1）给动效用，并找出有人声的片段给歌词定位；失败时不起伏、歌词按时长估算。
// 人声检测本就在 16 kHz 上进行，直接按 16 kHz 解码，解码后的数据只有 48 kHz 的三分之一。
async function analyse(url: string, duration: number): Promise<{ envelope: number[]; activity?: VocalActivity; duration?: number }> {
  if (duration > analyseLimit) return { envelope: [] };
  try {
    const response = await fetch(url); if (!response.ok) return { envelope: [] };
    const buffer = await decodeAudio(await response.arrayBuffer(), 16000);
    const data = buffer.getChannelData(0), size = Math.max(1, Math.round(buffer.sampleRate * envelopeStep));
    const values = Array.from({ length: Math.ceil(data.length / size) }, (_, i) => {
      let sum = 0, count = 0;
      for (let j = i * size; j < Math.min(data.length, (i + 1) * size); j += 16) { sum += data[j] * data[j]; count++; }
      return Math.sqrt(sum / Math.max(1, count));
    });
    const peak = Math.max(...values, 1e-6);
    const activity = vocalActivity(data, buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : data, buffer.sampleRate);
    return { envelope: values.map(value => value / peak), activity, duration: buffer.duration };
  } catch { return { envelope: [] }; }
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// 音频分析得到的人声片段，用来自动定位歌词。
export interface SongVoice { activity: VocalActivity; duration: number }

// 当前版本的音频：取得媒体地址后整段分析，响度包络在播放中逐帧写进样式变量（--now-playing-level）驱动封面与背景起伏，
// 人声片段交给歌词自动定位。setNotice 须是 useState 的 setter，它是读取 effect 的依赖，换成每次渲染新建的函数会反复重新读取。
export function useSongAnalysis({ item, audio, stage, playing, setNotice }: {
  item: Generation; audio: RefObject<HTMLAudioElement | null>; stage: RefObject<HTMLElement | null>; playing: boolean; setNotice: (value: string) => void;
}) {
  const [url, setUrl] = useState('');
  const envelope = useRef<number[]>([]);
  const [voice, setVoice] = useState<SongVoice | null>(null);
  // 打开即开始播放；浏览器拦截自动播放时停在开头，由用户点播放。
  useEffect(() => {
    let disposed = false, resource = '';
    mediaUrl('outputs', item.fileName).then(value => {
      resource = value;
      if (disposed) { releaseMediaUrl(value); return; }
      setUrl(value);
      void analyse(value, item.duration).then(result => {
        if (disposed) return;
        envelope.current = result.envelope;
        if (result.activity && result.duration) setVoice({ activity: result.activity, duration: result.duration });
      });
    }, (error: unknown) => { if (!disposed) setNotice(noticeMessage(error)); });
    return () => { disposed = true; releaseMediaUrl(resource); };
  }, [item.fileName, item.duration, setNotice]);
  // 播放中逐帧把当前响度写进样式变量，不经过 React 渲染。
  useEffect(() => {
    const element = audio.current, root = stage.current;
    if (!playing || !element || !root || reducedMotion()) return;
    let frame = 0, level = 0;
    const tick = () => {
      const target = envelope.current[Math.floor(element.currentTime / envelopeStep)] ?? 0;
      level += (target - level) * 0.25;
      root.style.setProperty('--now-playing-level', level.toFixed(3));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); root.style.setProperty('--now-playing-level', '0'); };
  }, [playing, audio, stage]);
  // 切换版本时清掉上一版的分析结果，新音频加载后重新分析。
  const reset = () => { envelope.current = []; setVoice(null); };
  return { url, voice, reset };
}
