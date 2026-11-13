import { liveAudioPlayer } from './live-audio-player';
import { PlaybackToolbar, TrackZoom } from './playback-toolbar';
import { lazy, Suspense, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { useTranslator } from '@astryxdesign/core/i18n';
import { Play, Pause, Square, FolderOpen, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';
import { call, mediaUrl, releaseMediaUrl } from '../../shared/lib/client';
import { noticeMessage } from '../../shared/lib/call-error';
import { formatTime } from '../../shared/workbench';
import { waveform as readWaveform } from './waveform';
import type { Track } from '../../shared/workbench';
import { useHotkey, useHotkeyAria, useHotkeyText, withHotkey } from '../../shared/hotkeys/hotkeys';

// 头像素材仅在展示库列表时加载，避免进入创作首屏主包。
const SeededAvatar = lazy(() => import('../../shared/ui/seeded-avatar').then(module => ({ default: module.SeededAvatar })));

// reveal=false 时由调用方在自己的工具栏或菜单里提供“打开位置”，工具栏不再单独放文件夹按钮。
export function Player({ track, onError, suspended, compact = false, actions, avatar, inline, onProgress, seekRequest, reveal = true }: { reveal?: boolean; onProgress?: (time: number, playing: boolean) => void; seekRequest?: { time: number; nonce: number }; inline?: { label: string; select: () => void }; avatar?: { seed: string; label: string; disabled?: boolean; select: () => void }; actions?: ReactNode; compact?: boolean; suspended: boolean; track: Track | null; onError: (message: string) => void }) {
  const t = useTranslator();
  const audio = useRef<HTMLAudioElement>(null);
  const lane = useRef<HTMLElement>(null);
  const [zoom, setZoom] = useState(1);
  const [volume, setVolume] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0); const [duration, setDuration] = useState(0); const [peaks, setPeaks] = useState<number[]>([]);
  const kind = track?.kind, fileName = track?.fileName, playRequest = track?.playRequest;
  const key = track && kind && fileName ? `${kind}/${track.id}/${fileName}` : '';
  const waveform = !(avatar || compact || inline);
  // 音频地址与读取失败原因只认当前音频的结果，切换音频时不会沿用上一份的状态。
  // 读不到文件是播放器自身的状态（正文播放器直接显示不可用），不主动弹出提示；只有用户请求播放时才说明原因。
  const [source, setSource] = useState({ key: '', url: '', failure: '' });
  const { url, failure } = source.key === key ? source : { url: '', failure: '' };
  const markFailed = (message: string) => setSource(current => current.key === key ? { ...current, failure: message } : current);
  // 用户请求了播放（试听、选择版本），音频还没准备好时先记下，地址就绪后再开始。
  const pending = useRef(false);
  // 已画出波形的音频地址。
  const drawn = useRef('');

  useEffect(() => {
    const stop = () => { audio.current?.pause(); pending.current = false; };
    window.addEventListener('yovoice-live-playback', stop);
    return () => window.removeEventListener('yovoice-live-playback', stop);
  }, []);
  // 1. 加载只跟随音频本身变化：再次请求播放或切换页面都不会重新读取。
  useEffect(() => {
    setTime(0); setDuration(0); setPeaks([]); setPlaying(false); setZoom(1); drawn.current = '';
    if (lane.current) lane.current.scrollLeft = 0;
    if (!key || !kind || !fileName) return;
    let disposed = false; let resource = '';
    mediaUrl(kind, fileName).then(value => {
      resource = value;
      if (disposed) releaseMediaUrl(value); else setSource({ key, url: value, failure: '' });
    }, (error: Error) => { if (!disposed) setSource({ key, url: '', failure: error.message }); });
    const element = audio.current;
    // 地址可能是随即释放的 blob，结果随清理一并作废，避免同一音频再次出现时用到已失效的地址。
    return () => { disposed = true; element?.pause(); releaseMediaUrl(resource); setSource(current => current.key === key ? { key: '', url: '', failure: '' } : current); };
  }, [key, kind, fileName]);
  // 2. 正文播放器边读取边取峰值绘制波形，不整段解码，超长音频也不会拖住界面。波形只是辅助显示，读取失败时不画；能否播放以 <audio> 为准。
  // 各页面常驻挂载，播放器不可见（suspended）时不读取，等真正显示时再画；同一音频只读一次。
  const drawWaveform = !!url && waveform && !suspended;
  useEffect(() => {
    if (!drawWaveform || drawn.current === url) return;
    const controller = new AbortController();
    readWaveform(url, 3200, controller.signal).then(value => { drawn.current = url; setPeaks(value.peaks); setDuration(value.duration); }, () => { /* 见上，不画波形即可 */ });
    return () => controller.abort();
  }, [drawWaveform, url]);
  // 播放失败时：音频读不到则记为不可用并说明；浏览器拦截自动播放时请用户点击播放；被暂停打断等情况忽略。
  const play = async (element: HTMLAudioElement) => {
    try { await element.play(); } catch (error) {
      if (element.error) { markFailed('@yovoice.error.audioPlayFailed'); onError('@yovoice.error.audioPlayFailed'); }
      else if ((error as DOMException).name === 'NotAllowedError') onError('@yovoice.error.audioPlayClick');
    }
  };
  // 3. 播放请求：同一音频再次请求时从头播放；音频已确认读不到时直接说明原因。
  const startPending = useEffectEvent(() => {
    const element = audio.current;
    if (!pending.current || !element || !(url || failure)) return;
    pending.current = false;
    if (suspended) return;
    if (failure) { onError(failure); return; }
    element.currentTime = 0;
    void play(element);
  });
  useEffect(() => { pending.current = !!playRequest; }, [playRequest, key]);
  useEffect(() => startPending(), [playRequest, key, url, failure]);
  useEffect(() => { if (suspended) { pending.current = false; audio.current?.pause(); } }, [suspended]);
  // 缩放后让播放位置保持在视口中央，播放进度变化本身不触发滚动。
  const centerPlayhead = useEffectEvent(() => {
    const viewport = lane.current;
    if (!viewport || !duration) return;
    const position = time / duration * viewport.scrollWidth;
    viewport.scrollLeft = Math.max(0, position - viewport.clientWidth / 2);
  });
  useLayoutEffect(() => centerPlayhead(), [zoom]);
  useEffect(() => {
    const viewport = lane.current;
    if (!viewport || !playing || !duration) return;
    const position = time / duration * viewport.scrollWidth;
    if (position < viewport.scrollLeft || position > viewport.scrollLeft + viewport.clientWidth) viewport.scrollLeft = position;
  }, [time, playing, duration]);
  // 放大时使用更密的峰值，缩小时取每组最大值，保留短促声音的轮廓。
  const visiblePeaks = useMemo(() => {
    const group = 8 / zoom;
    return Array.from({ length: Math.ceil(peaks.length / group) }, (_, i) => Math.max(...peaks.slice(i * group, (i + 1) * group)));
  }, [peaks, zoom]);
  // 编曲视图跟随播放位置显示指针，也可以点标尺跳转。
  const reportProgress = useEffectEvent(() => onProgress?.(time, playing));
  useEffect(() => reportProgress(), [time, playing]);
  useEffect(() => { if (seekRequest && audio.current) { audio.current.currentTime = seekRequest.time; setTime(seekRequest.time); } }, [seekRequest]);
  const toggle = () => {
    const element = audio.current;
    if (!element) return;
    if (playing) {
      element.pause();
      if (avatar) { element.currentTime = 0; setTime(0); }
      return;
    }
    if (failure) { onError(failure); return; }
    if (avatar) { element.currentTime = 0; setTime(0); }
    void play(element);
  };
  const seek = (value: number) => {
    if (audio.current) audio.current.currentTime = value;
    setTime(value);
  };
  const setLevel = (next: number) => { setVolume(next); liveAudioPlayer.setVolume(next); if (audio.current) audio.current.volume = next; };
  // 快捷键只给带波形的底部播放器，且只在它可见、有音频时响应；同时挂着的其他播放器（隐藏的页面、库里的试听）不抢按键。
  // 快退快进按音频元素的实时位置算，按住不放时不受进度刷新频率影响。
  const keyboard = waveform && !suspended && !!track;
  const skip = (delta: number) => { const element = audio.current; if (element) seek(Math.max(0, Math.min(element.duration || duration, element.currentTime + delta))); };
  useHotkey('player.play', toggle, { enabled: keyboard });
  useHotkey('global.playPause', toggle, { enabled: keyboard, inInput: true });
  useHotkey('player.back', () => skip(-5), { enabled: keyboard && !!url, repeat: true });
  useHotkey('player.forward', () => skip(5), { enabled: keyboard && !!url, repeat: true });
  useHotkey('player.start', () => seek(0), { enabled: keyboard && !!url });
  useHotkey('player.end', () => seek(duration), { enabled: keyboard && !!duration });
  useHotkey('player.mute', () => setLevel(volume === 0 ? 1 : 0), { enabled: keyboard });
  const keys = { play: useHotkeyText('player.play'), start: useHotkeyText('player.start'), end: useHotkeyText('player.end'), mute: useHotkeyText('player.mute') };
  const tip = (label: string, key: string) => withHotkey(label, key, undefined);
  const playAria = useHotkeyAria('player.play'), muteAria = useHotkeyAria('player.mute');
  const scale = duration || 10;
  const tickBase = 10 ** Math.floor(Math.log10(scale / zoom / 10));
  const tickStep = [1, 2, 5, 10].map(n => n * tickBase).find(n => n >= scale / zoom / 10)!;
  const ticks = Array.from({ length: Math.ceil(scale / tickStep) }, (_, i) => i * tickStep);
  // 只预读时长等元数据，整段音频在播放时再读取。
  const media = <audio hidden ref={audio} src={url || undefined} preload="metadata"
    onLoadedMetadata={() => { const value = audio.current?.duration; if (value && Number.isFinite(value)) setDuration(value); }}
    onTimeUpdate={() => setTime(audio.current?.currentTime ?? 0)}
    onPlay={() => { liveAudioPlayer.stop(); setPlaying(true); }} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
    onError={() => { if (url) markFailed('@yovoice.error.audioPlayFailed'); }} />;
  if (inline) return <>
    {media}
    <Button label={playing ? t('@yovoice.player.pause') : inline.label} size="sm" variant="ghost" isIconOnly
      icon={playing ? <Pause size={16} /> : <Play size={16} />} isDisabled={suspended}
      onClick={() => { if (track && (url || failure)) toggle(); else inline.select(); }} />
  </>;
  if (avatar) return <HStack className="avatar-player" data-playing={playing} gap={0}>
    {media}
    <Button className="avatar-toggle" label={playing ? t('@yovoice.player.stop') : avatar.label} isIconOnly variant="ghost" isDisabled={avatar.disabled || suspended}
      icon={<HStack className="avatar-art" gap={0}><Suspense fallback={null}><SeededAvatar seed={avatar.seed} /></Suspense>{playing ? <Square className="avatar-symbol" size={20} fill="currentColor" /> : <Play className="avatar-symbol" size={20} fill="currentColor" />}</HStack>}
      onClick={() => { if (track && (url || failure)) toggle(); else avatar.select(); }} />
  </HStack>;
  if (compact) return <HStack className="library-preview" role="group" aria-label={t('@yovoice.player.audition', { name: track?.name ?? '' })} gap={3} vAlign="center">
    {media}
    <Button label={playing ? t('@yovoice.player.pause') : t('@yovoice.player.play')} isIconOnly icon={playing ? <Pause size={16} /> : <Play size={16} fill="currentColor" />} size="sm" variant="ghost" className="preview-play" isDisabled={(!url && !failure) || suspended} onClick={toggle} />
    <small className="preview-time">{formatTime(time)}</small>
    <input className="preview-progress" aria-label={t('@yovoice.player.progress')} aria-valuetext={t('@yovoice.player.progressValue', { current: formatTime(time), total: formatTime(duration) })} type="range" min={0} max={duration || 1} step={0.01} value={time} disabled={!duration} onChange={e => seek(Number(e.target.value))} style={{ background: `linear-gradient(to right, var(--app-wave) ${duration ? time / duration * 100 : 0}%, var(--app-line) 0%)` }} />
    <small className="preview-time">{formatTime(duration)}</small>
    <Button label={volume === 0 ? t('@yovoice.player.unmute') : t('@yovoice.player.mute')} isIconOnly icon={volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />} size="sm" variant="ghost" onClick={() => setLevel(volume === 0 ? 1 : 0)} />
  </HStack>;
  return <VStack as="footer" className="player audio-panel player-single" gap={0}>
    {media}
    <PlaybackToolbar time={time} duration={duration} playing={playing} disabled={!url || !!failure || suspended} toggle={toggle} keys={keys.play} aria={playAria}
      beforePlay={<Button label={t('@yovoice.player.skipStart')} tooltip={tip(t('@yovoice.player.skipStart'), keys.start)} isIconOnly icon={<SkipBack size={16} />} size="sm" variant="ghost" isDisabled={!url || !!failure} onClick={() => seek(0)} />}
      afterPlay={<Button label={t('@yovoice.player.skipEnd')} tooltip={tip(t('@yovoice.player.skipEnd'), keys.end)} isIconOnly icon={<SkipForward size={16} />} size="sm" variant="ghost" isDisabled={!duration} onClick={() => seek(duration)} />}>
        <HStack className="volume-control" gap={2} vAlign="center">
          <Button label={volume === 0 ? t('@yovoice.player.unmute') : t('@yovoice.player.mute')} tooltip={tip(volume === 0 ? t('@yovoice.player.unmute') : t('@yovoice.player.mute'), keys.mute)} aria-keyshortcuts={muteAria} isIconOnly icon={volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />} size="sm" variant="ghost" onClick={() => setLevel(volume === 0 ? 1 : 0)} />
          <input aria-label={t('@yovoice.player.volume')} type="range" min={0} max={1} step={0.01} value={volume} onChange={e => setLevel(Number(e.target.value))} />
        </HStack>
        <TrackZoom value={zoom} change={setZoom} disabled={!duration} />
        {actions}
        {reveal && track?.kind === 'outputs' ? <Button label={t('@yovoice.player.reveal')} isIconOnly icon={<FolderOpen size={17} />} size="sm" variant="ghost" onClick={() => { void call('media.reveal', { kind: track.kind, id: track.id }).catch(e => onError(noticeMessage(e))); }} /> : null}

    </PlaybackToolbar>
    <HStack className="timeline" gap={0}>
      <VStack className="timeline-lane" ref={lane} gap={0}>
        <VStack className="timeline-content" gap={0} style={{ width: `${zoom * 100}%` }}>
        <HStack className="time-ruler" aria-hidden="true">{ticks.map(tick => <small key={tick} style={{ left: `${tick / scale * 100}%` }}>{Number(tick.toFixed(2))}s</small>)}</HStack>
        {failure ? <p className="waveform waveform-unavailable" role="status">{t('@yovoice.player.unavailable')}</p> : peaks.length ? <VStack className="waveform" gap={0}>
          <svg viewBox={`0 0 ${visiblePeaks.length * 2.5} 40`} preserveAspectRatio="none" aria-hidden="true">{visiblePeaks.map((p, i) => <line key={i} x1={i * 2.5 + 1.25} x2={i * 2.5 + 1.25} y1={20 - Math.max(1, p * 19)} y2={20 + Math.max(1, p * 19)} className={i / visiblePeaks.length < time / duration ? 'played' : ''} />)}</svg>
          <i className="playhead" style={{ left: `${duration ? time / duration * 100 : 0}%` }} aria-hidden="true" />
          <input aria-label={t('@yovoice.player.progress')} aria-valuetext={t('@yovoice.player.progressValue', { current: formatTime(time), total: formatTime(duration) })} type="range" min={0} max={duration || 1} step={0.01} value={time} onChange={e => seek(Number(e.target.value))} />
        </VStack> : null}
        </VStack>
      </VStack>
    </HStack>
  </VStack>;
}

