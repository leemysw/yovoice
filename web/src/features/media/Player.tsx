import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Play, Pause, FolderOpen, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';
import { call, mediaUrl } from '../../shared/lib/client';
import { formatTime } from '../../shared/workbench';
import type { Track } from '../../shared/workbench';
export function Player({ track, onError, suspended, compact = false, historyControl }: { historyControl?: ReactNode; compact?: boolean; suspended: boolean; track: Track | null; onError: (message: string) => void }) {
  const audio = useRef<HTMLAudioElement>(null);
  const autoplay = useRef(false);
  const [volume, setVolume] = useState(1);
  const [url, setUrl] = useState(''); const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0); const [duration, setDuration] = useState(0); const [peaks, setPeaks] = useState<number[]>([]);
  useEffect(() => {
    let disposed = false; let resource = '';
    autoplay.current = !!track?.playRequest;
    setUrl(''); setTime(0); setDuration(0); setPeaks([]); setPlaying(false);
    if (track) void (async () => {
      try {
        resource = await mediaUrl(track.kind, track.fileName); if (disposed) return;
        setUrl(resource);
        if (compact) return;
        const context = new AudioContext();
        try {
          const response = await fetch(resource); if (!response.ok) throw new Error('无法读取音频。');
          const buffer = await context.decodeAudioData(await response.arrayBuffer());
          const data = buffer.getChannelData(0); const stride = Math.ceil(data.length / 400);
          const next = Array.from({ length: 400 }, (_, i) => {
            let peak = 0; for (let j = i * stride; j < Math.min(data.length, (i + 1) * stride); j += 8) peak = Math.max(peak, Math.abs(data[j]));
            return peak;
          });
          if (!disposed) { setPeaks(next); setDuration(buffer.duration); }
        } finally { await context.close(); }
      } catch (error) { if (!disposed) onError((error as Error).message); }
    })();
    const element = audio.current;
    return () => { element?.pause(); disposed = true; if (resource.startsWith('blob:')) URL.revokeObjectURL(resource); };
  }, [track?.id, track?.playRequest, compact]);
  useEffect(() => { if (suspended) { autoplay.current = false; audio.current?.pause(); } }, [suspended]);
  const toggle = async () => {
    if (!audio.current) return;
    if (playing) audio.current.pause(); else try { await audio.current.play(); } catch { onError('音频无法播放，请检查文件。'); }
  };
  const seek = (value: number) => {
    if (audio.current) audio.current.currentTime = value;
    setTime(value);
  };
  const scale = duration || 10;
  const tickBase = 10 ** Math.floor(Math.log10(scale / 10));
  const tickStep = [1, 2, 5, 10].map(n => n * tickBase).find(n => n >= scale / 10)!;
  const ticks = Array.from({ length: Math.ceil(scale / tickStep) }, (_, i) => i * tickStep);
  if (compact) return <audio className="library-preview" aria-label={`试听${track?.name ?? ''}`} ref={audio} src={url || undefined} controls onCanPlay={() => { if (autoplay.current && !suspended) { autoplay.current = false; void audio.current?.play().catch(() => onError('请点击播放按钮开始试听。')); } }} onError={() => { if (url) onError('音频无法播放，请检查文件。'); }} />;
  return <VStack as="footer" className="player" gap={0}>
    <audio onCanPlay={() => { if (autoplay.current) { autoplay.current = false; void audio.current?.play().catch(() => onError('请点击播放按钮开始试听。')); } }} ref={audio} src={url || undefined} onTimeUpdate={() => setTime(audio.current?.currentTime ?? 0)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
    <HStack className="transport" vAlign="center" gap={4}>
      <small className="transport-time">{formatTime(time)} <em>/ {formatTime(duration)}</em></small>
      <HStack className="transport-controls" gap={2} vAlign="center">
        <Button label="回到开头" isIconOnly icon={<SkipBack size={16} />} size="sm" variant="ghost" isDisabled={!url} onClick={() => seek(0)} />
        <Button label={playing ? '暂停' : '播放'} isIconOnly icon={playing ? <Pause size={16} /> : <Play size={16} fill="currentColor" />} size="sm" variant={track ? 'primary' : 'secondary'} className="play-main" isDisabled={!url} onClick={() => void toggle()} />
        <Button label="跳到结尾" isIconOnly icon={<SkipForward size={16} />} size="sm" variant="ghost" isDisabled={!duration} onClick={() => seek(duration)} />
      </HStack>
      <HStack className="transport-end" gap={3} vAlign="center">
        <HStack className="volume-control" gap={2} vAlign="center">
          <Button label={volume === 0 ? '取消静音' : '静音'} isIconOnly icon={volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />} size="sm" variant="ghost" onClick={() => { const next = volume === 0 ? 1 : 0; setVolume(next); if (audio.current) audio.current.volume = next; }} />
          <input aria-label="音量" type="range" min={0} max={1} step={0.01} value={volume} onChange={e => { const next = Number(e.target.value); setVolume(next); if (audio.current) audio.current.volume = next; }} />
        </HStack>
        {track?.kind === 'outputs' ? <Button label="打开音频位置" isIconOnly icon={<FolderOpen size={17} />} size="sm" variant="ghost" onClick={() => { void call('media.reveal', { kind: track.kind, id: track.id }).catch(e => onError(e.message)); }} /> : null}
      </HStack>
    </HStack>
    <HStack className="timeline" gap={0}>
      <VStack className="track-name" gap={1} hAlign="start" vAlign="center"><strong>{track?.name ?? '暂无音频'}</strong>{historyControl ?? <small>{track?.subtitle ?? '生成或选择音频后试听'}</small>}</VStack>
      <VStack className="timeline-lane" gap={0}>
        <HStack className="time-ruler" aria-hidden="true">{ticks.map(tick => <small key={tick} style={{ left: `${tick / scale * 100}%` }}>{Number(tick.toFixed(2))}s</small>)}</HStack>
        {peaks.length ? <VStack className="waveform" gap={0}>
          <svg viewBox="0 0 1000 40" preserveAspectRatio="none" aria-hidden="true">{peaks.map((p, i) => <line key={i} x1={i * 2.5 + 1.25} x2={i * 2.5 + 1.25} y1={20 - Math.max(1, p * 19)} y2={20 + Math.max(1, p * 19)} className={i / peaks.length < time / duration ? 'played' : ''} />)}</svg>
          <i className="playhead" style={{ left: `${duration ? time / duration * 100 : 0}%` }} aria-hidden="true" />
          <input aria-label="播放进度" aria-valuetext={`${formatTime(time)}，共 ${formatTime(duration)}`} type="range" min={0} max={duration || 1} step={0.01} value={time} onChange={e => seek(Number(e.target.value))} />
        </VStack> : <HStack className="timeline-empty" aria-hidden="true" />}
      </VStack>
    </HStack>
  </VStack>;
}
