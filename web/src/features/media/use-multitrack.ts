import { useEffect, useRef, useState } from 'react';
import { mediaUrl, releaseMediaUrl } from '../../shared/lib/client';

export type MixTrack = { id: string; fileName: string };
export type TrackMix = { mute: boolean; solo: boolean; volume: number };

// 对齐策略：各轨和主时钟的偏差在 tolerance 内不管；稍大时微调这一轨的播放速度慢慢追上（最多快慢 5%，听不出来）；
// 只有偏差超过 seekLimit（如某轨缓冲卡住）才跳转，且同一轨两次跳转至少间隔 seekGap 毫秒。
// 不能一有偏差就跳转：跳转会让这一轨重新缓冲、出声断断续续，越跳越乱。
const tolerance = 0.02;
const seekLimit = 0.5;
const seekGap = 2000;
// 每秒检查几次偏差就够了，不必逐帧。
const checkEvery = 250;

/**
 * 多轨同步播放：每轨一个不挂在页面上的 <audio> 流式读取（不整段解码，长歌六轨也只占少量内存），
 * 以最长的一轨为主时钟，其余轨道定期对齐。音量、静音与独奏直接作用在各自的播放元素上。
 * onFrame 在播放中逐帧、在定位和暂停时各回调一次当前时间，调用方据此直接更新播放头，不必每帧重渲染。
 */
export function useMultitrack(tracks: MixTrack[], mix: Record<string, TrackMix>, onFrame: (time: number) => void, onError: (error: unknown) => void) {
  const elements = useRef(new Map<string, HTMLAudioElement>());
  const master = useRef<HTMLAudioElement | null>(null);
  const position = useRef(0);
  const frame = useRef(0);
  const report = useRef(onFrame);
  report.current = onFrame;
  const fail = useRef(onError);
  fail.current = onError;
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = tracks.map(track => `${track.id}:${track.fileName}`).join('|');

  useEffect(() => {
    let cancelled = false;
    const created = new Map<string, HTMLAudioElement>();
    const got: Record<string, string> = {};
    void (async () => {
      for (const track of tracks) {
        const url = await mediaUrl('outputs', track.fileName);
        if (cancelled) { releaseMediaUrl(url); return; }
        got[track.id] = url;
        const element = new Audio();
        element.preload = 'auto';
        element.src = url;
        created.set(track.id, element);
      }
      await Promise.all([...created.values()].map(element => element.readyState >= 1 ? undefined
        : new Promise(resolve => { element.addEventListener('loadedmetadata', resolve, { once: true }); element.addEventListener('error', resolve, { once: true }); })));
      if (cancelled) return;
      elements.current = created;
      let longest: HTMLAudioElement | null = null;
      for (const element of created.values()) if (!longest || (element.duration || 0) > (longest.duration || 0)) longest = element;
      master.current = longest;
      setDuration(longest && Number.isFinite(longest.duration) ? longest.duration : 0);
      setUrls(got);
      setReady(true);
    })().catch(error => { if (!cancelled) fail.current(error); });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame.current);
      created.forEach(element => { element.pause(); element.removeAttribute('src'); element.load(); });
      Object.values(got).forEach(releaseMediaUrl);
      elements.current = new Map();
      master.current = null;
      position.current = 0;
      setReady(false);
      setPlaying(false);
    };
    // 轨道列表按内容（key）比较，同一组轨道重新渲染时不重建播放元素。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // 独奏优先：有轨道独奏时只放独奏的轨道，否则放没有静音的轨道。
  useEffect(() => {
    const soloing = Object.values(mix).some(item => item.solo);
    elements.current.forEach((element, id) => {
      const item = mix[id];
      const audible = item ? (soloing ? item.solo : !item.mute) : !soloing;
      element.volume = audible ? Math.max(0, Math.min(1, item?.volume ?? 1)) : 0;
    });
  }, [mix, ready]);

  const each = (action: (element: HTMLAudioElement) => void) => elements.current.forEach(action);
  const place = (time: number) => each(element => { element.currentTime = Math.min(time, Number.isFinite(element.duration) ? element.duration : time); });

  const lastCheck = useRef(0);
  const lastSeek = useRef(new Map<HTMLAudioElement, number>());
  const align = (time: number) => {
    const now = performance.now();
    each(element => {
      if (element === master.current || element.paused || element.ended) return;
      const drift = element.currentTime - time;
      if (Math.abs(drift) > seekLimit) {
        if (now - (lastSeek.current.get(element) ?? 0) < seekGap) return;
        lastSeek.current.set(element, now);
        element.playbackRate = 1;
        element.currentTime = time;
      } else if (Math.abs(drift) > tolerance) {
        // 超前就放慢、落后就加快，偏差越大调得越多。
        element.playbackRate = 1 - Math.max(-0.05, Math.min(0.05, drift * 0.5));
      } else if (element.playbackRate !== 1) element.playbackRate = 1;
    });
  };

  const tick = () => {
    const clock = master.current;
    if (!clock) return;
    const time = clock.currentTime;
    position.current = time;
    report.current(time);
    if (clock.ended) { stop(); return; }
    if (performance.now() - lastCheck.current > checkEvery) { lastCheck.current = performance.now(); align(time); }
    frame.current = requestAnimationFrame(tick);
  };

  function stop() {
    cancelAnimationFrame(frame.current);
    each(element => { element.pause(); element.playbackRate = 1; });
    setPlaying(false);
  }

  const play = async () => {
    if (!ready) return;
    const start = position.current >= duration - 0.05 ? 0 : position.current;
    position.current = start;
    place(start);
    lastSeek.current = new Map();
    try {
      await Promise.all([...elements.current.values()].filter(element => !Number.isFinite(element.duration) || start < element.duration).map(element => element.play()));
    } catch (error) { stop(); fail.current(error); return; }
    // 各轨依次开始，起点会差几十毫秒：全部真正出声后按主时钟一次对齐。
    const clock = master.current;
    if (clock) each(element => { if (element !== clock && !element.paused && Math.abs(element.currentTime - clock.currentTime) > tolerance) element.currentTime = clock.currentTime; });
    setPlaying(true);
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(tick);
  };

  const pause = () => {
    stop();
    position.current = master.current?.currentTime ?? position.current;
    report.current(position.current);
  };

  const seek = (time: number) => {
    const target = Math.max(0, Math.min(duration, time));
    position.current = target;
    place(target);
    // 播放中定位到某条较短的轨道已经结束的位置之前时，让它重新跟上。
    if (playing) each(element => { if (element.paused && Number.isFinite(element.duration) && target < element.duration) void element.play().catch(() => undefined); });
    report.current(target);
  };

  return { ready, playing, duration, urls, play, pause, seek, toggle: () => (playing ? pause() : void play()) };
}
