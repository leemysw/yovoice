import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { NumberInput } from '@astryxdesign/core/NumberInput';
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
    <Button size="sm" variant="secondary" label={t(playing ? '@yovoice.player.pause' : '@yovoice.voice.previewExcerpt')}
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

// 选段编辑：波形上标出选中的范围，用区间滑块调整，可先试听再保存（选段需 1–60 秒）。
export function VoiceExcerptEditor({ buffer, range, setRange, busy, onError, onCancel, onSave, onSuggest }: {
  buffer: AudioBuffer; range: ExcerptRange; setRange: (range: ExcerptRange) => void; busy: boolean;
  onError: () => void; onCancel: () => void; onSave: () => void; onSuggest?: () => void;
}) {
  const t = useTranslator();
  const peaks = useMemo(() => bufferPeaks(buffer, 192), [buffer]);
  const length = range[1] - range[0];
  const frames = Math.floor(range[1] * buffer.sampleRate) - Math.floor(range[0] * buffer.sampleRate);
  const valid = frames >= buffer.sampleRate && frames <= 60 * buffer.sampleRate;
  // 长录音拖动滑块难以精确到秒，入点、出点也可直接输入（失焦或回车时生效）。
  const setBoundary = (index: 0 | 1, seconds: number) => {
    if (index === 0) setRange([Math.max(0, Math.min(seconds, range[1])), range[1]]);
    else setRange([range[0], Math.min(buffer.duration, Math.max(seconds, range[0]))]);
  };
  return <VStack gap={3} data-testid="voice-excerpt-editor">
    <HStack className="recording-waveform" gap={0}><svg viewBox="0 0 192 64" preserveAspectRatio="none" aria-hidden="true" height="64" width="100%">
      {peaks.map((peak, i) => <line key={i} className={i * buffer.duration / peaks.length >= range[0] && i * buffer.duration / peaks.length < range[1] ? 'played' : ''}
        x1={i} x2={i} y1={32 - Math.max(1, peak * 30)} y2={32 + Math.max(1, peak * 30)} />)}
    </svg></HStack>
    <Slider label={t('@yovoice.voice.cropRange')} value={range} min={0} max={buffer.duration} step={0.1} onChange={setRange}
      formatValue={seconds => `${seconds.toFixed(1)} s`} valueDisplay="text" />
    <HStack gap={3}>
      <NumberInput size="sm" label={t('@yovoice.timeline.trimStart')} min={0} max={range[1]} step={0.1} value={Number(range[0].toFixed(1))} onChange={value => setBoundary(0, value)} width="calc(var(--spacing-10) * 3)" />
      <NumberInput size="sm" label={t('@yovoice.timeline.trimEnd')} min={range[0]} max={buffer.duration} step={0.1} value={Number(range[1].toFixed(1))} onChange={value => setBoundary(1, value)} width="calc(var(--spacing-10) * 3)" />
    </HStack>
    <small role="status">{t('@yovoice.voice.excerptLength', { selected: length.toFixed(1), total: buffer.duration.toFixed(1) })}</small>
    <HStack gap={2} wrap="wrap">
      <ExcerptPlayback key={range.join(':') + busy} buffer={buffer} range={range} disabled={busy || !valid} onError={onError} />
      {onSuggest ? <Button size="sm" label={t('@yovoice.voice.autoPick')} tooltip={t('@yovoice.voice.autoPickHint')} isDisabled={busy} onClick={onSuggest} /> : null}
      <Button size="sm" label={t('@yovoice.voice.cancelExcerpt')} isDisabled={busy} onClick={onCancel} />
      <Button size="sm" label={t('@yovoice.voice.saveCrop')} variant="primary" isDisabled={!valid} isLoading={busy} onClick={onSave} />
    </HStack>
  </VStack>;
}
