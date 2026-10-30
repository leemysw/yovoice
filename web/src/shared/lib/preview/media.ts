import { newId, type AudioAsset, type Voice } from '../../workbench';
import { encodeWav } from '../sound';
import { assertUploadSize } from '../upload-limit';
import { CallError } from '../call-error';
import { preview, publish } from './store';
import { blobStore } from './blobs';

// 浏览器预览的音频导入：用 AudioContext 解码上传、录制或已生成的音频，按 WAV 存进 IndexedDB 后返回素材或声音记录；
// 媒体地址是临时的 blob 地址，由调用方用完释放。
export async function previewImportTimeline(file: File, name: string): Promise<AudioAsset> {
  assertUploadSize(file);
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    if (buffer.duration < 0.01 || buffer.duration > 3600) throw new CallError('@yovoice.timeline.importDuration');
    const id = newId();
    const asset = { id, name, fileName: `import-${id}.wav`, duration: buffer.duration };
    await blobStore(asset.fileName, encodeWav(buffer));
    return asset;
  } finally { await context.close(); }
}

export async function previewImportTimelineGeneration(generationID: string): Promise<AudioAsset> {
  const state = preview();
  const generation = state.history.find(item => item.id === generationID && !item.segment);
  if (!generation) throw new CallError('@yovoice.error.audioMissing');
  const draft = state.drafts.find(item => item.id === generation.settings.id);
  const name = Array.from(`${draft?.title ?? generation.settings.title} · ${generation.title}`).slice(0, 120).join('');
  const blob = await blobStore(generation.fileName);
  if (!blob) throw new CallError('@yovoice.error.audioBlobMissing');
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    if (buffer.duration < 0.01 || buffer.duration > 3600) throw new CallError('@yovoice.timeline.importDuration');
    const id = newId();
    const asset = { id, name, fileName: `import-${id}.wav`, duration: buffer.duration };
    await blobStore(asset.fileName, blob);
    return asset;
  } finally { await context.close(); }
}

export async function previewImportVoice(file: File): Promise<Voice> {
  assertUploadSize(file);
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    if (decoded.duration < 1 || decoded.duration > 600) throw new CallError('@yovoice.error.audioDuration');
    // 超过 60 秒的录音：桌面端按清晰度挑一段，预览后端不做测量，固定取开头 10 秒。
    const excerpt = decoded.duration > 60 ? { start: 0, end: 10, total: Math.round(decoded.duration * 100) / 100 } : undefined;
    const wav = excerpt ? encodeWav(decoded, excerpt.start, excerpt.end) : encodeWav(decoded);
    const id = newId();
    const voice: Voice = { id, name: file.name.replace(/\.[^.]+$/, ''), fileName: id + '.wav', duration: excerpt ? excerpt.end - excerpt.start : decoded.duration, ...(excerpt ? { excerpt } : {}) };
    await blobStore(voice.fileName, wav); preview().voices.push(voice); publish(); return voice;
  } finally { await context.close(); }
}

export async function previewMediaUrl(file: string): Promise<string> {
  const blob = await blobStore(file); if (!blob) throw new CallError('@yovoice.error.audioBlobMissing'); return URL.createObjectURL(blob);
}
