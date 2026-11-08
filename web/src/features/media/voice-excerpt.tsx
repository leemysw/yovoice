import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Slider } from '@astryxdesign/core/Slider';
import { useTranslator } from '@astryxdesign/core/i18n';
import { Pause, Play } from 'lucide-react';
import { bufferPeaks, encodeWav } from '../../shared/lib/sound';

export type ExcerptRange = [number, number];

function ExcerptPlayback({ buffer, range, disabled, onError }: {
  buffer: AudioBuffer; range: ExcerptRange; disabled: boolean; onError: () => void;
}) {
  const t = useTranslator();
  const audio = useRef<HTMLAudioElement>(null);
  const objectURL = useRef('');
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const element = audio.current;
    return () => {
      element?.pause();
      URL.revokeObjectURL(objectURL.current);
    };
  }, []);
  return <>
    <audio hidden ref={audio} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
    {/* 文字固定为“试听选段”，播放时只换图标：暂停与试听的文字宽度不同，换文字会把右边的按钮顶得左右抖动。 */}
    <Button size="sm" variant="secondary" label={t('@yovoice.voice.previewExcerpt')} aria-pressed={playing}
      icon={playing ? <Pause size={16} /> : <Play size={16} />} isDisabled={disabled}
      onClick={() => {
        const element = audio.current;
        if (!element) return;
        if (!element.paused) { element.pause(); return; }
        try {
          if (!objectURL.current) {
            objectURL.current = URL.createObjectURL(encodeWav(buffer, ...range));
            element.src = objectURL.current;
          }
          element.currentTime = 0;
          void element.play().catch(onError);
        } catch { onError(); }
      }} />
  </>;
}

export function VoiceExcerptEditor({ buffer, range, setRange, busy, onError, onCancel, onSave, onSuggest }: {
  buffer: AudioBuffer; range: ExcerptRange; setRange: (range: ExcerptRange) => void; busy: boolean;
  onError: () => void; onCancel: () => void; onSave: () => void; onSuggest?: () => void;
}) {
  const t = useTranslator();
  const peaks = useMemo(() => bufferPeaks(buffer, 192), [buffer]);
  const length = range[1] - range[0];
  const frames = Math.floor(range[1] * buffer.sampleRate) - Math.floor(range[0] * buffer.sampleRate);
  const valid = frames >= buffer.sampleRate && frames <= 60 * buffer.sampleRate;
  function setBoundary(index: 0 | 1, seconds: number) {
    if (!Number.isFinite(seconds)) return;
    if (index === 0) setRange([Math.max(0, Math.min(seconds, range[1])), range[1]]);
    else setRange([range[0], Math.min(buffer.duration, Math.max(seconds, range[0]))]);
  }
  return <VStack gap={3} data-testid="voice-excerpt-editor">
    <HStack className="recording-waveform" gap={0}><svg viewBox="0 0 192 64" preserveAspectRatio="none" aria-hidden="true" height="64" width="100%">
      {peaks.map((peak, i) => <line key={i} className={i * buffer.duration / peaks.length >= range[0] && i * buffer.duration / peaks.length < range[1] ? 'played' : ''}
        x1={i} x2={i} y1={32 - Math.max(1, peak * 30)} y2={32 + Math.max(1, peak * 30)} />)}
    </svg></HStack>
    <Slider label={t('@yovoice.voice.cropRange')} value={range} min={0} max={buffer.duration} step={0.1} onChange={setRange}
      formatValue={seconds => `${seconds.toFixed(1)} s`} valueDisplay="text" />
    <HStack gap={3} wrap="wrap">
      <label className="number-field">{t('@yovoice.timeline.trimStart')}<input type="number" min={0} max={range[1]} step={0.1}
        value={Number(range[0].toFixed(3))} onChange={e => setBoundary(0, e.target.valueAsNumber)} /></label>
      <label className="number-field">{t('@yovoice.timeline.trimEnd')}<input type="number" min={range[0]} max={buffer.duration} step={0.1}
        value={Number(range[1].toFixed(3))} onChange={e => setBoundary(1, e.target.valueAsNumber)} /></label>
    </HStack>
    <small role="status">{t('@yovoice.voice.excerptLength', { selected: length.toFixed(1), total: buffer.duration.toFixed(1) })}</small>
    <HStack gap={2} wrap="wrap">
      <ExcerptPlayback key={range.join(':') + busy} buffer={buffer} range={range} disabled={busy || !valid} onError={onError} />
      {onSuggest ? <Button size="sm" label={t('@yovoice.voice.autoPick')} isDisabled={busy} onClick={onSuggest} /> : null}
      <Button size="sm" label={t('@yovoice.voice.cancelExcerpt')} isDisabled={busy} onClick={onCancel} />
      <Button size="sm" label={t('@yovoice.voice.saveCrop')} variant="primary" isDisabled={!valid} isLoading={busy} onClick={onSave} />
    </HStack>
  </VStack>;
}
