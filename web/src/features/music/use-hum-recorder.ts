import { useEffect, useRef, useState } from 'react';
import { CallError } from '../../shared/lib/call-error';
import { decodeAudio, encodeWav } from '../../shared/lib/sound';

// 哼唱录音的上限：一段主歌加副歌足够，也让扒谱很快出结果。
const humSeconds = 120;

// 录一段哼唱或清唱，停下后转成 WAV 交给 onRecorded；再点一次停止，到上限自动停。
// 等待麦克风授权（getUserMedia 返回前）时再按快捷键或按钮不会再开一个录音器；组件卸载后才拿到的麦克风立即释放。
export function useHumRecorder(onRecorded: (file: File) => void, onError: (error: unknown) => void) {
  const [recording, setRecording] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const starting = useRef(false);
  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; clearTimeout(timer.current); recorder.current?.stream.getTracks().forEach(track => track.stop()); };
  }, []);
  const toggle = async () => {
    if (recorder.current) { recorder.current.stop(); return; }
    if (starting.current) return;
    starting.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true } });
      if (!mounted.current) { stream.getTracks().forEach(track => track.stop()); return; }
      let instance: MediaRecorder;
      try { instance = new MediaRecorder(stream); } catch (e) { stream.getTracks().forEach(track => track.stop()); throw e; }
      const chunks: Blob[] = [];
      instance.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      instance.onstop = async () => {
        clearTimeout(timer.current); stream.getTracks().forEach(track => track.stop());
        recorder.current = null; setRecording(false);
        try {
          const buffer = await decodeAudio(new Blob(chunks));
          if (buffer.duration < 3) throw new CallError('@yovoice.error.humTooShort');
          onRecorded(new File([encodeWav(buffer, 0, Math.min(humSeconds, buffer.duration))], 'hum.wav', { type: 'audio/wav' }));
        } catch (e) { onError(e); }
      };
      recorder.current = instance; instance.start(); setRecording(true);
      timer.current = setTimeout(() => instance.stop(), humSeconds * 1000);
    } catch (e) { onError(e); } finally { starting.current = false; }
  };
  return { recording, toggle };
}
