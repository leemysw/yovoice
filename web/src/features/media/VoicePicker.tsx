import { useEffect, useRef, useState } from 'react';
import { Dialog } from '@astryxdesign/core/Dialog';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Slider } from '@astryxdesign/core/Slider';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Upload, Mic, Square, Play, X, AudioLines } from 'lucide-react';
import { call, importVoiceFile, mediaUrl, isMac } from '../../shared/lib/client';
import { encodeWav, toBase64 } from '../../shared/lib/sound';
import { formatTime, type Voice } from '../../shared/workbench';
export function VoicePicker({ voices, onClose, onSelect }: { voices: Voice[]; onClose: () => void; onSelect: (v: Voice) => void }) {
  const input = useRef<HTMLInputElement>(null); const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [error, onError] = useState(''); const [showRecording, setShowRecording] = useState(false);
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => () => { if (preview?.url.startsWith('blob:')) URL.revokeObjectURL(preview.url); }, [preview]);
  async function audition(voice: Voice) {
    try { const url = await mediaUrl('voices', voice.fileName); if (!alive.current) { if (url.startsWith('blob:')) URL.revokeObjectURL(url); return; } setPreview({ url, name: voice.name }); }
    catch (e) { onError((e as Error).message); }
  }
  const [recording, setRecording] = useState(false); const [busy, setBusy] = useState(false);
  const [name, setName] = useState('我的声音'); const [crop, setCrop] = useState<Voice | null>(null); const [range, setRange] = useState<[number, number]>([0, 10]);
  useEffect(() => () => { clearTimeout(timer.current); if (recorder.current?.state === 'recording') { recorder.current.onstop = null; recorder.current.stop(); } recorder.current?.stream.getTracks().forEach(t => t.stop()); }, []);
  async function importing(file?: File) {
    setBusy(true); onError('');
    try { const voice = file ? await importVoiceFile(file) : null; if (voice) onSelect(voice); }
    catch (e) { onError((e as Error).name === 'EncodingError' ? '无法解码此音频，请选择未加密且未损坏的 AAC、M4A、MP3 或 WAV 文件。' : (e as Error).message); } finally { setBusy(false); }
  }
  async function record() {
    onError('');
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
          if (buffer.duration < 1) throw new Error('请至少录制 1 秒。');
          const voice = await call<Voice>('voice.record', { name, base64: await toBase64(encodeWav(buffer, 0, Math.min(60, buffer.duration))) });
          onSelect(voice);
        } catch (e) { onError((e as Error).message); } finally { await context.close(); setBusy(false); }
      };
      instance.start(); setRecording(true); timer.current = setTimeout(() => { if (instance.state === 'recording') instance.stop(); }, 59000);
    } catch (e) {
      const error = e as Error;
      if (error.name === 'NotAllowedError') {
        onError(isMac ? '无法访问麦克风。请退出并重新打开 yovoice；若仍无法录音，请在系统设置 → 隐私与安全性 → 麦克风中允许 yovoice。' : '无法访问麦克风，请在浏览器的网站权限和系统设置中允许使用麦克风后重试。');
      } else if (error.name === 'NotFoundError') {
        onError('未找到麦克风，请连接输入设备后重试。');
      } else {
        onError('无法录音：' + error.message);
      }
    }
  }
  async function trim() {
    if (!crop) return; setBusy(true); let url = ''; const context = new AudioContext();
    try {
      if (range[1] - range[0] < 1) throw new Error('裁剪后请至少保留 1 秒。');
      url = await mediaUrl('voices', crop.fileName);
      const buffer = await context.decodeAudioData(await (await fetch(url)).arrayBuffer());
      const voice = await call<Voice>('voice.record', { name: crop.name + ' · 裁剪', base64: await toBase64(encodeWav(buffer, range[0], range[1])) }); onSelect(voice);
    } catch (e) { onError((e as Error).message); } finally { await context.close(); if (url.startsWith('blob:')) URL.revokeObjectURL(url); setBusy(false); }
  }
  return <Dialog className="voice-picker" isOpen onOpenChange={open => { if (!open && !recording && !busy) onClose(); }} width={560} purpose="form" padding={6}>
    <VStack gap={5}>
      <HStack hAlign="between" vAlign="center"><VStack gap={2}><h2>选择声音</h2><small>1–60 秒清晰人声，避免背景音乐。</small></VStack><Button label="关闭声音选择" className="voice-close" size="sm" isIconOnly icon={<X size={17} />} variant="ghost" isDisabled={recording || busy} onClick={onClose} /></HStack>
      {error ? <p className="dialog-error" role="alert">{error}</p> : null}
      <HStack gap={2} wrap="wrap"><Button label="导入参考音频" size="sm" icon={<Upload size={16} />} isLoading={busy} isDisabled={recording} onClick={() => input.current?.click()} /><Button label="录制声音" size="sm" variant="ghost" icon={<Mic size={16} />} isDisabled={busy || recording} aria-expanded={showRecording} onClick={() => { setShowRecording(value => !value); setCrop(null); }} /></HStack>
      <input type="file" hidden ref={input} accept="audio/*,.aac,.m4a,.mp3,.wav,.flac" onChange={e => { const file = e.target.files?.[0]; if (file) void importing(file); e.target.value = ''; }} />
      {showRecording ? <VStack className="recording-form" gap={3}><TextInput label="录音名称" value={name} onChange={setName} /><Button label={recording ? '停止并保存' : '开始录音'} icon={recording ? <Square size={17} /> : <Mic size={17} />} variant="primary" isDisabled={busy} onClick={() => void record()} /></VStack> : null}
      {recording ? <p role="status" className="recording">正在录音，最长 60 秒…</p> : null}
      <VStack className="voice-list" gap={0}>{voices.length ? voices.map(voice => <HStack key={voice.id} className="voice-row" gap={3} vAlign="center">
        <AudioLines className="muted" size={18} strokeWidth={1.5} /><Button label={voice.name} variant="ghost" className="grow text-left" isDisabled={busy || recording} onClick={() => onSelect(voice)} /><small>{formatTime(voice.duration)}</small>
        <Button label={`试听${voice.name}`} size="sm" icon={<Play size={16} />} isIconOnly variant="ghost" isDisabled={recording || busy} onClick={() => void audition(voice)} />
        <Button label="裁剪" size="sm" variant="ghost" isDisabled={recording || busy} onClick={() => { setCrop(voice); setShowRecording(false); setRange([0, voice.duration]); }} />
      </HStack>) : null}</VStack>
      {preview ? <VStack gap={2}><small>{preview.name}</small><audio className="voice-preview" aria-label={`试听${preview.name}`} src={preview.url} controls autoPlay /></VStack> : null}
      {crop ? <VStack gap={3}><h3>裁剪 · {crop.name}</h3><Slider label="保留范围" value={range} min={0} max={crop.duration} step={0.1} onChange={(value: [number, number]) => setRange(value)} formatValue={formatTime} valueDisplay="text" /><Button label="另存为新音色" variant="primary" isLoading={busy} onClick={() => void trim()} /></VStack> : null}
    </VStack>
  </Dialog>;
}
