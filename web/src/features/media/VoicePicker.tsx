import { useEffect, useRef, useState } from 'react';
import { Dialog } from '@astryxdesign/core/Dialog';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Slider } from '@astryxdesign/core/Slider';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useTranslator } from '@astryxdesign/core/i18n';
import { Upload, Mic, Square, Play, X, AudioLines } from 'lucide-react';
import { call, importVoiceFile, mediaUrl, isMac, CallError } from '../../shared/lib/client';
import { encodeWav, toBase64 } from '../../shared/lib/sound';
import { formatCallError } from '../../shared/i18n/format';
import { Player } from './Player';
import { formatTime, type Track, type Voice } from '../../shared/workbench';

export function VoicePicker({ voices, onClose, onSelect, adding = false }: { adding?: boolean; voices: Voice[]; onClose: () => void; onSelect: (v: Voice) => void }) {
  const t = useTranslator();
  const input = useRef<HTMLInputElement>(null); const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [error, setError] = useState(''); const [showRecording, setShowRecording] = useState(false);
  const [preview, setPreview] = useState<Track | null>(null);
  function audition(voice: Voice) {
    setPreview({ ...voice, kind: 'voices', subtitle: '', playRequest: Date.now() });
  }
  const [recording, setRecording] = useState(false); const [busy, setBusy] = useState(false);
  const [name, setName] = useState(() => t('@yovoice.voice.defaultName')); const [crop, setCrop] = useState<Voice | null>(null); const [range, setRange] = useState<[number, number]>([0, 10]);
  useEffect(() => () => { clearTimeout(timer.current); if (recorder.current?.state === 'recording') { recorder.current.onstop = null; recorder.current.stop(); } recorder.current?.stream.getTracks().forEach(t => t.stop()); }, []);
  async function importing(file?: File) {
    setBusy(true); setError('');
    try { const voice = file ? await importVoiceFile(file) : null; if (voice) onSelect(voice); }
    catch (e) { setError((e as Error).name === 'EncodingError' ? t('@yovoice.error.browserDecode') : formatCallError(t, e)); } finally { setBusy(false); }
  }
  async function record() {
    setError('');
    if (recording) { recorder.current?.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      let instance: MediaRecorder;
      try { instance = new MediaRecorder(stream); } catch (e) { stream.getTracks().forEach(t => t.stop()); throw e; }
      recorder.current = instance; const chunks: Blob[] = [];
      instance.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      instance.onstop = async () => {
        clearTimeout(timer.current); stream.getTracks().forEach(t => t.stop()); setRecording(false); setBusy(true);
        const context = new AudioContext();
        try {
          const buffer = await context.decodeAudioData(await new Blob(chunks).arrayBuffer());
          if (buffer.duration < 1) throw new CallError('@yovoice.error.recordTooShort');
          const voice = await call<Voice>('voice.record', { name, base64: await toBase64(encodeWav(buffer, 0, Math.min(60, buffer.duration))) });
          onSelect(voice);
        } catch (e) { setError(formatCallError(t, e)); } finally { await context.close(); setBusy(false); }
      };
      instance.start(); setRecording(true); timer.current = setTimeout(() => { if (instance.state === 'recording') instance.stop(); }, 59000);
    } catch (e) {
      const err = e as Error;
      if (err.name === 'NotAllowedError') {
        setError(t(isMac ? '@yovoice.error.micDeniedMac' : '@yovoice.error.micDeniedBrowser'));
      } else if (err.name === 'NotFoundError') {
        setError(t('@yovoice.error.micNotFound'));
      } else {
        setError(t('@yovoice.error.micFailed', { detail: err.message }));
      }
    }
  }
  async function trim() {
    if (!crop) return; setBusy(true); let url = ''; const context = new AudioContext();
    try {
      if (range[1] - range[0] < 1) throw new CallError('@yovoice.error.trimTooShort');
      url = await mediaUrl('voices', crop.fileName);
      const buffer = await context.decodeAudioData(await (await fetch(url)).arrayBuffer());
      const voice = await call<Voice>('voice.record', { name: crop.name + t('@yovoice.voice.croppedSuffix'), base64: await toBase64(encodeWav(buffer, range[0], range[1])) }); onSelect(voice);
    } catch (e) { setError(formatCallError(t, e)); } finally { await context.close(); if (url.startsWith('blob:')) URL.revokeObjectURL(url); setBusy(false); }
  }
  return <Dialog className="voice-picker" isOpen onOpenChange={open => { if (!open && !recording && !busy) onClose(); }} width={560} purpose="form" padding={6}>
    <VStack gap={5}>
      <HStack hAlign="between" vAlign="center"><VStack gap={2}><h2 tabIndex={-1} data-autofocus="">{adding ? t('@yovoice.voice.addTitle') : t('@yovoice.voice.pickTitle')}</h2><small>{t('@yovoice.voice.hint')}</small></VStack><Button label={adding ? t('@yovoice.voice.closeAdd') : t('@yovoice.voice.closePick')} className="voice-close" size="sm" isIconOnly icon={<X size={17} />} variant="ghost" isDisabled={recording || busy} onClick={onClose} /></HStack>
      {error ? <p className="dialog-error" role="alert">{error}</p> : null}
      <HStack gap={2} wrap="wrap"><Button label={t('@yovoice.voice.import')} size="sm" icon={<Upload size={16} />} isLoading={busy} isDisabled={recording} onClick={() => input.current?.click()} /><Button label={t('@yovoice.voice.record')} size="sm" variant="secondary" icon={<Mic size={16} />} isDisabled={busy || recording} aria-expanded={showRecording} onClick={() => { setShowRecording(value => !value); setCrop(null); }} /></HStack>
      <input type="file" hidden ref={input} accept="audio/*,.aac,.m4a,.mp3,.wav,.flac,.ogg,.opus,.aiff,.aif,.wma,.webm" onChange={e => { const file = e.target.files?.[0]; if (file) void importing(file); e.target.value = ''; }} />
      {showRecording ? <VStack className="recording-form" gap={3}><TextInput label={t('@yovoice.voice.recordName')} value={name} onChange={setName} /><Button label={recording ? t('@yovoice.voice.stopSave') : t('@yovoice.voice.startRecord')} icon={recording ? <Square size={17} /> : <Mic size={17} />} variant="primary" isDisabled={busy} onClick={() => void record()} /></VStack> : null}
      {recording ? <p role="status" className="recording">{t('@yovoice.voice.recording')}</p> : null}
      {!adding ? <VStack className="voice-list" gap={0}>{voices.length ? voices.map(voice => <HStack key={voice.id} className="voice-row" gap={3} vAlign="center">
        <AudioLines className="muted" size={18} strokeWidth={1.5} /><Button label={voice.name} variant="ghost" className="grow text-left" isDisabled={busy || recording} onClick={() => onSelect(voice)} /><small>{formatTime(voice.duration)}</small>
        <Button label={t('@yovoice.voice.audition', { name: voice.name })} size="sm" icon={<Play size={16} />} isIconOnly variant="ghost" isDisabled={recording || busy} onClick={() => void audition(voice)} />
        <Button label={t('@yovoice.voice.crop')} size="sm" variant="secondary" isDisabled={recording || busy} onClick={() => { setCrop(voice); setShowRecording(false); setRange([0, voice.duration]); }} />
      </HStack>) : null}</VStack> : null}
      {preview ? <VStack gap={2}><small>{preview.name}</small><Player compact track={preview} suspended={recording || busy} onError={message => setError(formatCallError(t, new Error(message)))} /></VStack> : null}
      {crop ? <VStack gap={3}><h3>{t('@yovoice.voice.cropTitle', { name: crop.name })}</h3><Slider label={t('@yovoice.voice.cropRange')} value={range} min={0} max={crop.duration} step={0.1} onChange={(value: [number, number]) => setRange(value)} formatValue={formatTime} valueDisplay="text" /><Button label={t('@yovoice.voice.saveCrop')} variant="primary" isLoading={busy} onClick={() => void trim()} /></VStack> : null}
    </VStack>
  </Dialog>;
}
