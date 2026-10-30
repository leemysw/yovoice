import { useEffect, useRef, useState } from 'react';
import { call, mediaUrl, releaseMediaUrl } from '../../shared/lib/client';

export type PreviewStatus = 'idle' | 'rendering' | 'playing' | 'paused';

// 旋律谱试听：用音色库把谱渲染成音频，在谱面里自己播放，不占用底部的歌曲播放器。
// 同一份谱只渲染一次；谱改了就停止并丢掉旧的试听。播放时暂停页面上其他正在播放的音频。
// 渲染是异步的：谱改了或组件卸载后才回来的结果直接丢弃，不会冒出一段停不下来的声音；音频地址用完释放。
export function useMelodyPreview(abc: string, onError: (e: unknown) => void) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const rendered = useRef<string | null>(null);
  const url = useRef('');
  // 每次渲染请求的序号：停止后序号前进，之前还没回来的请求作废。
  const seq = useRef(0);
  const [status, setStatus] = useState<PreviewStatus>('idle');
  const [time, setTime] = useState(0);

  const stop = () => {
    seq.current++;
    audio.current?.pause();
    audio.current = null; rendered.current = null;
    if (url.current) { releaseMediaUrl(url.current); url.current = ''; }
    setStatus('idle'); setTime(0);
  };
  useEffect(() => stop, [abc]);

  const start = (element: HTMLAudioElement) => {
    document.querySelectorAll('audio').forEach(other => { if (other !== element) other.pause(); });
    void element.play().catch(onError);
  };
  const toggle = async () => {
    const element = audio.current;
    if (element && rendered.current === abc) {
      if (element.paused) start(element); else element.pause();
      return;
    }
    const token = ++seq.current;
    setStatus('rendering');
    try {
      const { fileName } = await call<{ fileName: string }>('melody.listen', { abc });
      if (token !== seq.current) return;
      const source = await mediaUrl('outputs', fileName);
      if (token !== seq.current) { releaseMediaUrl(source); return; }
      const next = new Audio(source);
      // 播放时逐帧读取进度，音符高亮比 timeupdate 更跟手；变化不足 50ms 不重绘。
      let last = -1;
      const tick = () => {
        if (Math.abs(next.currentTime - last) >= 0.05) { last = next.currentTime; setTime(last); }
        if (!next.paused) requestAnimationFrame(tick);
      };
      next.onplay = () => { setStatus('playing'); requestAnimationFrame(tick); };
      next.onpause = () => setStatus(next.ended ? 'idle' : 'paused');
      next.onended = () => { setStatus('idle'); setTime(0); next.currentTime = 0; };
      audio.current = next; rendered.current = abc; url.current = source;
      start(next);
    } catch (e) {
      if (token !== seq.current) return;
      setStatus('idle'); onError(e);
    }
  };
  const seek = (seconds: number) => {
    const element = audio.current;
    if (!element) return;
    element.currentTime = seconds; setTime(seconds);
  };
  return { status, time, audio, toggle, seek };
}
