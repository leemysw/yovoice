import type { AudioAsset, State, Voice } from '../workbench';
import { toBase64 } from './sound';
import { CallError, parseCallError } from './call-error';
import { desktopCall, desktopMediaUrl, isDesktop, isMac, subscribeDesktop } from './bridge';
import { assertUploadSize, previewCall, previewImportTimeline, previewImportVoice, previewMediaUrl, subscribePreview } from './preview-backend';

// 界面统一的后端入口：桌面端经宿主桥接调用 Go 服务，浏览器预览使用本地模拟后端。
export { CallError, parseCallError, isDesktop, isMac };

export function subscribe(listener: (state: State) => void) {
  return isDesktop ? subscribeDesktop(listener) : subscribePreview(listener);
}

export function call<T = unknown>(method: string, data: unknown = {}): Promise<T> {
  return isDesktop ? desktopCall<T>(method, data) : previewCall<T>(method, data);
}

export async function importTimelineFile(file: File): Promise<AudioAsset> {
  const name = file.name.replace(/\.[^.]+$/, '').slice(0, 120);
  if (!isDesktop) return previewImportTimeline(file, name);
  assertUploadSize(file);
  return call<AudioAsset>('timeline.import', { name, base64: await toBase64(file) });
}

export async function importVoiceFile(file: File): Promise<Voice> {
  if (!isDesktop) return previewImportVoice(file);
  assertUploadSize(file);
  return call<Voice>('voice.record', { name: file.name.replace(/\.[^.]+$/, ''), base64: await toBase64(file) });
}

export async function mediaUrl(kind: 'voices' | 'outputs', file: string): Promise<string> {
  return isDesktop ? desktopMediaUrl(kind, file) : previewMediaUrl(file);
}

export async function saveAudio(blob: Blob, name: string): Promise<boolean> {
  const fileName = `${name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 100) || 'yovoice'}.wav`;
  if (isDesktop) return call<boolean>('audio.export', { name: fileName, base64: await toBase64(blob) });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = fileName; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
