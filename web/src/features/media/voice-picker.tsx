import { useEffect, useId, useRef, useState } from 'react';
import { AppDialog } from '../../shared/ui/app-dialog';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useTranslator } from '@astryxdesign/core/i18n';
import { Upload, Mic, Square, Play, Pause, AudioLines, Check, Search } from 'lucide-react';
import { call, decodeVoiceSource, importVoiceFile, mediaUrl, CallError, releaseMediaUrl, suggestVoiceSource } from '../../shared/lib/client';
import { bufferPeaks, decodeAudio, encodeWav, toBase64 } from '../../shared/lib/sound';
import { formatCallError } from '../../shared/i18n/format';
import { Player } from './player';
import { VoiceExcerptEditor, type ExcerptRange } from './voice-excerpt';
import { micError, RecordingMeter, useRecorder } from './recorder';
import { formatTime, type Track, type Voice } from '../../shared/workbench';

// 参考音频的最长时长（秒），与本地服务一致。
const maxReference = 60;

export function VoicePicker({ voices, onClose, onSelect, adding = false }: { adding?: boolean; voices: Voice[]; onClose: () => void; onSelect: (v: Voice) => void }) {
  const t = useTranslator();
  const nameId = useId();
  const input = useRef<HTMLInputElement>(null);
  const recorder = useRecorder(maxReference);
  const { stream, recording } = recorder;
  const [error, setError] = useState(''); const [showRecording, setShowRecording] = useState(false);
  const [preview, setPreview] = useState<Track | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Voice | null>(null);
  const [recorded, setRecorded] = useState<Blob | null>(null);
  const [recordingURL, setRecordingURL] = useState('');
  const [waveform, setWaveform] = useState<number[]>([]);
  useEffect(() => { if (!recorded) { setRecordingURL(''); return; } const url = URL.createObjectURL(recorded); setRecordingURL(url); return () => URL.revokeObjectURL(url); }, [recorded]);
  const choose = (voice: Voice) => { if (adding) onSelect(voice); else { setSelected(voice); setCrop(null); } };
  function cancelRecording() {
    recorder.cancel(); setRecorded(null);
  }

  function audition(voice: Voice) {
    setPreview({ ...voice, kind: 'voices', subtitle: '', playRequest: Date.now() });
  }
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(() => t('@yovoice.voice.defaultName')); const [crop, setCrop] = useState<{ name: string; buffer: AudioBuffer; voice?: Voice; suggestion?: ExcerptRange } | null>(null);
  const [range, setRange] = useState<ExcerptRange>([0, 10]);
  // 60 秒以内的录音直接导入；更长的先选段：预先选中本地服务挑出的最清楚的一段，可调整后保存。
  async function importing(file: File) {
    setBusy(true); setError(''); setPreview(null); setCrop(null);
    try {
      const buffer = await decodeVoiceSource(file);
      if (buffer.duration <= maxReference) { choose(await importVoiceFile(file)); return; }
      const span = await suggestVoiceSource(file).catch(() => ({ start: 0, end: 10 }));
      const suggestion: ExcerptRange = [span.start, Math.min(span.end, buffer.duration)];
      setCrop({ name: file.name.replace(/\.[^.]+$/, ''), buffer, suggestion });
      setRange(suggestion);
    } catch (e) {
      setError((e as Error).name === 'EncodingError' ? t('@yovoice.error.browserDecode') : formatCallError(t, e));
    } finally { setBusy(false); }
  }
  async function editExcerpt(voice: Voice) {
    setBusy(true); setError(''); setPreview(null); setCrop(null);
    let url = '';
    try {
      url = await mediaUrl('voices', voice.fileName);
      const response = await fetch(url);
      if (!response.ok) throw new CallError('@yovoice.error.audioPlayFailed');
      const buffer = await decodeAudio(await response.arrayBuffer(), 24000);
      setCrop({ name: voice.name, buffer, voice });
      setRange([0, Math.min(maxReference, buffer.duration)]);
    } catch (e) { setError(formatCallError(t, e)); }
    finally { releaseMediaUrl(url); setBusy(false); }
  }
  async function record() {
    setError('');
    if (recording) { recorder.stop(); return; }
    setPreview(null); setBusy(true);
    try {
      await recorder.start(async audio => {
        setBusy(true);
        try {
          const buffer = await decodeAudio(audio);
          if (buffer.duration < 1) throw new CallError('@yovoice.error.recordTooShort');
          setWaveform(bufferPeaks(buffer, 96, 60));
          setRecorded(encodeWav(buffer, 0, Math.min(maxReference, buffer.duration)));
        } catch (e) { setError(formatCallError(t, e)); } finally { setBusy(false); }
      });
      setRecorded(null); setPreview(null);
    } catch (e) { setError(micError(t, e)); }
    finally { setBusy(false); }
  }
  async function suggest() {
    if (crop?.suggestion) { setRange(crop.suggestion); return; }
    if (!crop?.voice) return;
    setBusy(true); setError('');
    try {
      const span = await call<{ start: number; end: number }>('voice.suggest', { id: crop.voice.id });
      setRange([span.start, Math.min(span.end, crop.buffer.duration)]);
    } catch (e) { setError(formatCallError(t, e)); } finally { setBusy(false); }
  }
  async function trim() {
    if (!crop) return;
    setBusy(true); setError('');
    try {
      const name = crop.name + (crop.voice ? t('@yovoice.voice.croppedSuffix') : '');
      const voice = await importVoiceFile(new File([encodeWav(crop.buffer, ...range)], name + '.wav', { type: 'audio/wav' }));
      choose(voice);
    } catch (e) { setError(formatCallError(t, e)); } finally { setBusy(false); }
  }
  return <AppDialog title={t(adding ? '@yovoice.voice.addTitle' : '@yovoice.voice.pickTitle')}
    width={adding ? 400 : 560} busy={busy} error={error} onClose={() => { cancelRecording(); onClose(); }} closeLabel={t(adding ? '@yovoice.voice.closeAdd' : '@yovoice.voice.closePick')}
    actions={!adding && !showRecording && !crop ? <Button label={t('@yovoice.voice.confirmSelection')} variant="primary" isDisabled={!selected || busy || recording} onClick={() => { if (selected) onSelect(selected); }} /> : undefined}>
      {!showRecording ? <HStack gap={2} wrap="wrap"><Button label={t('@yovoice.voice.import')} size="sm" icon={<Upload size={16} />} isLoading={busy} isDisabled={recording} onClick={() => input.current?.click()} /><Button label={t('@yovoice.voice.record')} size="sm" variant="secondary" icon={<Mic size={16} />} isDisabled={busy || recording} aria-expanded={showRecording} onClick={() => { setShowRecording(value => !value); setCrop(null); setPreview(null); }} /></HStack> : null}
      <input type="file" hidden ref={input} accept="audio/*,.aac,.m4a,.mp3,.wav,.flac,.ogg,.opus,.aiff,.aif,.wma,.webm" onChange={e => { const file = e.target.files?.[0]; if (file) void importing(file); e.target.value = ''; }} />
      {showRecording ? <VStack className="recording-form" gap={4}>
        <HStack className="recording-name" gap={3} vAlign="center"><label htmlFor={nameId}>{t('@yovoice.voice.recordName')}</label><TextInput id={nameId} label={t('@yovoice.voice.recordName')} isLabelHidden value={name} onChange={setName} /></HStack>
        {stream ? <RecordingMeter stream={stream} limit={maxReference} /> : null}
        {recorded ? <>
          <RecordingPlayback url={recordingURL} levels={waveform} onError={() => setError(t('@yovoice.error.audioPlayFailed'))} />
          <HStack gap={2} hAlign="end"><Button label={t('@yovoice.voice.rerecord')} isDisabled={busy} onClick={() => void record()} /><Button label={t('@yovoice.voice.saveRecording')} variant="primary" isDisabled={!name.trim()} isLoading={busy} onClick={async () => {
            setBusy(true); setError('');
            try { const voice = await call<Voice>('voice.record', { name, base64: await toBase64(recorded) }); setRecorded(null); setShowRecording(false); choose(voice); }
            catch (error) { setError(formatCallError(t, error)); }
            finally { setBusy(false); }
          }} /></HStack>
        </> : <Button label={recording ? t('@yovoice.voice.stopRecord') : t('@yovoice.voice.startRecord')} icon={recording ? <Square size={17} /> : <Mic size={17} />} variant="primary" isDisabled={busy} onClick={() => void record()} />}
      </VStack> : null}
      {!adding && !showRecording && !crop && voices.length ? <TextInput label={t('@yovoice.library.searchVoices')} isLabelHidden placeholder={t('@yovoice.library.searchVoices')} startIcon={<Search />} value={query} onChange={value => { setQuery(value); setPreview(null); }} hasClear /> : null}
      {!adding && !showRecording && !crop ? <VStack className="voice-list" gap={0}>{voices.length ? voices.filter(v => v.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).map(voice => <HStack key={voice.id} className="voice-row" data-selected={selected?.id === voice.id} gap={3} vAlign="center">
        <HStack className="voice-choice-mark" gap={0}>{selected?.id === voice.id ? <Check size={18} /> : <AudioLines className="muted" size={18} strokeWidth={1.5} />}</HStack><Button label={voice.name} variant="ghost" className="grow text-left" isDisabled={busy || recording} aria-pressed={selected?.id === voice.id} onClick={() => setSelected(voice)} /><small>{formatTime(voice.duration)}</small>
        <Player inline={{ label: t('@yovoice.voice.audition', { name: voice.name }), select: () => audition(voice) }} track={preview?.id === voice.id ? preview : null} suspended={recording || busy}
          onError={message => { setPreview(null); setError(formatCallError(t, new Error(message))); }} />
        <Button label={t('@yovoice.voice.crop')} size="sm" variant="secondary" isDisabled={recording || busy} onClick={() => void editExcerpt(voice)} />
      </HStack>) : null}</VStack> : null}
      {crop ? <VStack gap={3}>
        <h3>{t('@yovoice.voice.cropTitle', { name: crop.name })}</h3>
        <VoiceExcerptEditor buffer={crop.buffer} range={range} setRange={setRange} busy={busy}
          onError={() => setError(t('@yovoice.error.audioPlayFailed'))}
          onCancel={() => { setCrop(null); setError(''); }} onSave={() => void trim()}
          onSuggest={() => void suggest()} />
      </VStack> : null}
  </AppDialog>;
}

function RecordingPlayback({ url, levels, onError }: { url: string; levels: number[]; onError: () => void }) {
  const t = useTranslator();
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const progress = duration ? time / duration : 0;
  return <VStack className="recording-playback" gap={3}>
    <audio hidden ref={audio} src={url || undefined} aria-label={t('@yovoice.voice.recordPreview')}
      onLoadedMetadata={() => setDuration(audio.current?.duration || 0)} onTimeUpdate={() => setTime(audio.current?.currentTime || 0)}
      onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={onError} />
    <HStack className="recording-waveform" gap={0}>
      <svg viewBox="0 0 384 64" preserveAspectRatio="none" aria-hidden="true">
        {levels.map((level, index) => <line key={index} className={index / levels.length < progress ? 'played' : ''} x1={index * 4 + 2} x2={index * 4 + 2} y1={32 - Math.max(1, level * 30)} y2={32 + Math.max(1, level * 30)} />)}
        <line className="recording-playhead" x1={progress * 384} x2={progress * 384} y1={0} y2={64} />
      </svg>
      <input type="range" min={0} max={duration || 1} step={0.01} value={time} disabled={!duration}
        aria-label={t('@yovoice.player.progress')} aria-valuetext={`${formatTime(time)} / ${formatTime(duration)}`}
        onChange={event => { const value = Number(event.target.value); if (audio.current) audio.current.currentTime = value; setTime(value); }} />
    </HStack>
    <HStack hAlign="between" vAlign="center" gap={3}>
      <time>{formatTime(time)}</time>
      <Button className="recording-play-button" label={t(playing ? '@yovoice.player.pause' : '@yovoice.player.play')} isIconOnly variant="primary" icon={playing ? <Pause /> : <Play />} isDisabled={!url}
        onClick={() => { const element = audio.current; if (!element) return; if (!element.paused) element.pause(); else { if (element.ended) element.currentTime = 0; void element.play().catch(onError); } }} />
      <time>{formatTime(duration)}</time>
    </HStack>
  </VStack>;
}
