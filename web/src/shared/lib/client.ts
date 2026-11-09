import type { AudioAsset, State, Voice } from '../workbench';
import { decodeAudio, toBase64 } from './sound';
import { CallError, parseCallError } from './call-error';
import { desktopCall, desktopMediaUrl, isDesktop, isLinux, isMac, reportDesktop, subscribeDesktop } from './bridge';
import { assertUploadSize } from './upload-limit';

// 界面统一的后端入口：桌面端经宿主桥接调用 Go 服务，浏览器预览使用本地模拟后端。
// 预览后端连同它带的模型目录等数据只在浏览器里用到，按需加载，不进桌面端的首屏包；
// 加载完成后记住模块，之后的调用与静态引入时一样同步进入预览后端，不多等一拍。
type PreviewBackend = typeof import('./preview-backend');
let loaded: PreviewBackend | undefined;
const preview = () => loaded ? Promise.resolve(loaded) : import('./preview-backend').then(backend => (loaded = backend));
export { CallError, parseCallError, isDesktop, isLinux, isMac };

export function subscribe(listener: (state: State) => void) {
  if (isDesktop) return subscribeDesktop(listener);
  if (loaded) return loaded.subscribePreview(listener);
  let unsubscribe: (() => void) | undefined, cancelled = false;
  void preview().then(backend => { if (!cancelled) unsubscribe = backend.subscribePreview(listener); });
  return () => { cancelled = true; unsubscribe?.(); };
}

export function call<T = unknown>(method: string, data: unknown = {}): Promise<T> {
  if (isDesktop) return desktopCall<T>(method, data);
  if (loaded) return loaded.previewCall<T>(method, data);
  return preview().then(backend => backend.previewCall<T>(method, data));
}

export async function importTimelineFile(file: File): Promise<AudioAsset> {
  const name = file.name.replace(/\.[^.]+$/, '').slice(0, 120);
  if (!isDesktop) return (await preview()).previewImportTimeline(file, name);
  assertUploadSize(file);
  return call<AudioAsset>('timeline.import', { name, base64: await toBase64(file) });
}

export async function importTimelineGeneration(generationID: string): Promise<AudioAsset> {
  if (!isDesktop) return (await preview()).previewImportTimelineGeneration(generationID);
  return call<AudioAsset>('timeline.fromGeneration', { id: generationID });
}

// 先在界面解码供裁剪，系统不支持的格式交给打包的转换器。
export async function decodeVoiceSource(file: File): Promise<AudioBuffer> {
  assertUploadSize(file);
  let buffer: AudioBuffer;
  try {
    buffer = await decodeAudio(file, 24000);
  } catch (error) {
    if (!isDesktop) throw error;
    const wav = await call<string>('voice.decode', { base64: await toBase64(file) });
    buffer = await decodeAudio(await (await fetch(`data:audio/wav;base64,${wav}`)).arrayBuffer(), 24000);
  }
  if (buffer.duration < 1 || buffer.duration > 600) throw new CallError('@yovoice.error.audioDuration');
  return buffer;
}

// 长录音先挑出最适合克隆的一段（与导入时自动截取同一算法）；预览后端不分析音频，取开头 10 秒。
export async function suggestVoiceSource(file: File): Promise<{ start: number; end: number }> {
  if (!isDesktop) return { start: 0, end: 10 };
  return call<{ start: number; end: number }>('voice.suggestSource', { base64: await toBase64(file) });
}

export async function importVoiceFile(file: File): Promise<Voice> {
  if (!isDesktop) return (await preview()).previewImportVoice(file);
  assertUploadSize(file);
  return call<Voice>('voice.record', { name: file.name.replace(/\.[^.]+$/, ''), base64: await toBase64(file) });
}

// 翻唱扒谱：上传歌曲交给后台用 SheetSage2 提取旋律；浏览器预览不做推理。
export async function coverMelodyFile(projectId: string, file: File): Promise<void> {
  if (!isDesktop) throw new CallError('@yovoice.error.previewDesktopOnly');
  assertUploadSize(file);
  await call('melody.cover', { projectId, base64: await toBase64(file) });
}

// 语音转写：上传音频或视频交给后台用语音识别模型逐段转写；浏览器预览不上传音频，只演示结果。
// 桌面端把文件作为原始请求体直接上传，不转 base64，视频等大文件也能转写；maxMB 是设置里的文件上限，超出时先在界面拒绝。
export async function transcribeSpeechFile(file: File, maxMB: number): Promise<void> {
  if (!isDesktop) { await call('speech.transcribe', { name: file.name, base64: '' }); return; }
  if (file.size > maxMB * 1024 * 1024) throw new CallError('@yovoice.error.transcribeTooLarge', { size: maxMB % 1024 ? `${maxMB} MB` : `${maxMB / 1024} GB` });
  const response = await fetch(`/api/transcribe?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
  const reply = await response.json().catch(() => ({})) as { result?: boolean; error?: unknown };
  if (reply.error) throw parseCallError(reply.error);
  if (!response.ok || !reply.result) throw new CallError('@yovoice.error.unknown', { detail: `transcribe upload ${response.status}` });
}

// 音频地址：桌面端是服务上的固定地址，浏览器预览是临时 blob 地址；用完交给 releaseMediaUrl 释放。
export async function mediaUrl(kind: 'voices' | 'outputs', file: string): Promise<string> {
  return isDesktop ? desktopMediaUrl(kind, file) : (await preview()).previewMediaUrl(file);
}

// 释放 mediaUrl 返回的地址；固定地址无需释放，可以对任何结果调用。
export function releaseMediaUrl(url: string) {
  if (url.startsWith('blob:')) URL.revokeObjectURL(url);
}

// 导出文件名：去掉文件系统不接受的字符并限长，空名用兜底名。
export const exportName = (name: string, fallback = 'yovoice') => name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 100) || fallback;

// 浏览器预览没有保存对话框，直接交给浏览器下载。
export function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = fileName; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 只在界面里完成的操作（导出文件等）写入服务日志，事件名记为 client.<event>；上报失败不影响操作本身。
export function logEvent(event: string, detail = '') {
  if (isDesktop) reportDesktop(event, '', detail);
  else void call('diag.client', { event, detail }).catch(() => undefined);
}

// 导出结果写入日志：保存、取消或失败（失败时原样抛出）。
async function logged(format: string, save: () => Promise<boolean>): Promise<boolean> {
  try {
    const saved = await save();
    logEvent(saved ? 'export_saved' : 'export_cancelled', format);
    return saved;
  } catch (error) {
    logEvent('export_failed', `${format}: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// 导出音频的格式：WAV 原样，FLAC 无损压缩，M4A（AAC）体积小；后两种由本地服务转码并写入标签，只在桌面端可选。
export type AudioExportFormat = 'wav' | 'flac' | 'm4a';
// 写进 FLAC / M4A 的标签；cover 是 base64 编码的 JPEG 封面（不带 data: 前缀）。
export interface AudioExportTags { title?: string; album?: string; lyrics?: string; cover?: string }
export interface AudioExportOptions { format?: AudioExportFormat; loudness?: number; tags?: AudioExportTags }

// 让本地服务把版本或上传的临时文件转成所选格式，再交给宿主弹保存框；返回用户是否保存。
async function encodeAndSave(source: { kind: 'outputs' | 'export'; id: string }, name: string, { format = 'wav', loudness, tags }: AudioExportOptions): Promise<boolean> {
  const reply = await call<{ id: string }>('export.encode', { ...source, format, loudness: source.kind === 'outputs' ? loudness : undefined, ...(format === 'wav' ? {} : tags) });
  return call<boolean>('audio.export', { id: reply.id, name: `${exportName(name)}.${format}` });
}

// 界面合成的音频（时间线导出）：桌面端先直接上传给本地服务落成临时文件，宿主再弹保存框复制，
// 不经宿主消息通道传音频字节，长音频不受消息大小限制；浏览器预览直接下载 WAV。
// loudness 为目标响度（LUFS）时由本地服务整体调整音量后再保存；选了 FLAC / M4A 时再转码一次。
export async function saveAudio(blob: Blob, name: string, loudness?: number, format: AudioExportFormat = 'wav'): Promise<boolean> {
  return logged(isDesktop ? format : 'wav', async () => {
    if (!isDesktop) { download(blob, `${exportName(name)}.wav`); return true; }
    const response = await fetch(loudness ? `/api/export-audio?loudness=${loudness}` : '/api/export-audio', { method: 'POST', body: blob });
    const reply = await response.json().catch(() => ({})) as { id?: string; error?: unknown };
    if (!response.ok || !reply.id) throw reply.error ? parseCallError(reply.error) : new CallError('@yovoice.error.unknown', { detail: `export upload ${response.status}` });
    if (format !== 'wav') return encodeAndSave({ kind: 'export', id: reply.id }, name, { format });
    return call<boolean>('audio.export', { id: reply.id, name: `${exportName(name)}.wav` });
  });
}

// 导出已生成的版本：原样 WAV 由宿主弹出保存框后直接复制 outputs 中的文件，不经页面传音频字节，长歌也不受消息大小限制；
// 选了目标响度或其他格式时先由本地服务生成临时文件。浏览器预览没有文件可复制，取回音频后下载 WAV。
export async function exportOutput(id: string, fileName: string, name: string, options: AudioExportOptions = {}): Promise<boolean> {
  if (isDesktop) {
    const format = options.format ?? 'wav';
    if (format === 'wav' && !options.loudness) return logged('wav', () => call<boolean>('output.export', { kind: 'outputs', id, name: `${exportName(name)}.wav` }));
    return logged(format, () => encodeAndSave({ kind: 'outputs', id }, name, options));
  }
  const url = await mediaUrl('outputs', fileName);
  try { return await saveAudio(await (await fetch(url)).blob(), name); }
  finally { releaseMediaUrl(url); }
}

// 字幕、歌词与 ABC 谱面等 UTF-8 文本：桌面端由宿主弹出保存对话框并写文件，用户取消时返回 false。
export type TextExportFormat = 'srt' | 'vtt' | 'lrc' | 'abc';
export async function saveText(text: string, name: string, format: TextExportFormat): Promise<boolean> {
  const fileName = `${exportName(name)}.${format}`;
  return logged(format, async () => {
    if (isDesktop) return call<boolean>('text.export', { name: fileName, format, text });
    download(new Blob([text], { type: format === 'vtt' ? 'text/vtt' : 'text/plain' }), fileName);
    return true;
  });
}
