import { useEffect, useRef, useState } from 'react';
import { VStack } from '@astryxdesign/core/Layout';
import type { TranslatorFn } from '@astryxdesign/core/i18n';
import { isMac } from '../../shared/lib/client';
import { formatTime } from '../../shared/workbench';

// 麦克风录音：声音样本与语音转写共用。start 打开麦克风开始录，stop 结束并把录到的音频交给 onStop，
// cancel 丢弃本次录音；到 limit 秒自动结束。组件卸载时释放麦克风。
export function useRecorder(limit: number) {
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const release = () => {
    clearTimeout(timer.current);
    recorder.current?.stream.getTracks().forEach(t => t.stop());
    setStream(null);
  };
  const cancel = () => {
    const current = recorder.current;
    if (current) { current.onstop = null; if (current.state === 'recording') current.stop(); }
    release();
  };
  useEffect(() => () => {
    clearTimeout(timer.current);
    const current = recorder.current;
    if (current?.state === 'recording') { current.onstop = null; current.stop(); }
    current?.stream.getTracks().forEach(t => t.stop());
  }, []);
  // 麦克风不可用时抛出原始错误，由 micError 转成提示。
  async function start(onStop: (audio: Blob) => void, options?: MediaRecorderOptions) {
    const media = await navigator.mediaDevices.getUserMedia({ audio: true });
    let instance: MediaRecorder;
    try { instance = new MediaRecorder(media, options); } catch (e) { media.getTracks().forEach(t => t.stop()); throw e; }
    recorder.current = instance;
    const chunks: Blob[] = [];
    instance.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    instance.onstop = () => { release(); onStop(new Blob(chunks, { type: instance.mimeType })); };
    instance.start();
    setStream(media);
    timer.current = setTimeout(() => { if (instance.state === 'recording') instance.stop(); }, limit * 1000);
  }
  const stop = () => { if (recorder.current?.state === 'recording') recorder.current.stop(); };
  return { stream, recording: stream !== null, start, stop, cancel };
}

// 打开麦克风失败时的提示：未授权、没有麦克风或其他原因。
export function micError(t: TranslatorFn, e: unknown): string {
  const err = e as Error;
  if (err.name === 'NotAllowedError') return t(isMac ? '@yovoice.error.micDeniedMac' : '@yovoice.error.micDeniedBrowser');
  if (err.name === 'NotFoundError') return t('@yovoice.error.micNotFound');
  return t('@yovoice.error.micFailed', { detail: err.message });
}

// 录音时的电平和已录时长；limit 为最长秒数。
export function RecordingMeter({ stream, limit }: { stream: MediaStream; limit: number }) {
  const [seconds, setSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  useEffect(() => {
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    const source = stream.getAudioTracks().length ? context.createMediaStreamSource(stream) : null;
    source?.connect(analyser);
    void context.resume().catch(() => {});
    const samples = new Uint8Array(analyser.fftSize);
    const started = performance.now();
    const interval = setInterval(() => {
      analyser.getByteTimeDomainData(samples);
      const amplitude = Math.sqrt(samples.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / samples.length);
      setLevels(previous => [...previous.slice(-63), Math.min(1, amplitude * 4)]);
      setSeconds(Math.min(limit, (performance.now() - started) / 1000));
    }, 80);
    return () => { clearInterval(interval); source?.disconnect(); analyser.disconnect(); void context.close(); };
  }, [stream, limit]);
  return <VStack className="recording-meter" gap={3} hAlign="center">
    <svg viewBox="0 0 256 64" preserveAspectRatio="none" aria-hidden="true">{levels.map((level, index) => <line key={index} x1={(64 - levels.length + index) * 4 + 2} x2={(64 - levels.length + index) * 4 + 2} y1={32 - Math.max(1, level * 30)} y2={32 + Math.max(1, level * 30)} />)}</svg>
    <time role="timer">{formatTime(seconds)}</time>
  </VStack>;
}
