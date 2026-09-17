import catalog from './catalog.json';
import { emptyState, type Draft, type State, type Voice, type Preferences } from '../workbench';
import { encodeWav, toBase64 } from './sound';

declare global { interface Window { __workbenchPlatform?: 'macos'; __workbenchMediaBase?: string; __workbenchDraft?: Draft; chrome?: { webview?: { postMessage: (data: unknown) => void; addEventListener: (name: string, listener: (event: MessageEvent) => void) => void } } } }
const native = window.chrome?.webview;
export const isDesktop = !!native;
export const isMac = window.__workbenchPlatform === 'macos';
const listeners = new Set<(state: State) => void>();
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> }>();
native?.addEventListener('message', ({ data }) => {
  if (data.event === 'state') { listeners.forEach(fn => fn(data.state)); return; }
  const callback = pending.get(data.id);
  if (!callback) return;
  clearTimeout(callback.timer); pending.delete(data.id);
  if (data.error) callback.reject(new Error(data.error)); else callback.resolve(data.result);
});
let preview: State;
try {
  const stored = JSON.parse(localStorage.getItem('voice-workbench-v1') ?? 'null');
  preview = stored ?? emptyState();
  if (!preview.preferences?.uiLocale || (preview.preferences.uiLocale !== 'zh-CN' && preview.preferences.uiLocale !== 'en')) {
    preview = { ...preview, preferences: { ...preview.preferences, uiLocale: 'zh-CN' } };
  }
} catch { preview = emptyState(); }
function publish() { localStorage.setItem('voice-workbench-v1', JSON.stringify(preview)); listeners.forEach(fn => fn(structuredClone(preview))); }
export function subscribe(listener: (state: State) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export async function call<T = unknown>(method: string, data: unknown = {}): Promise<T> {
  if (native) return new Promise<T>((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('桌面服务没有响应，请重试。')); }, 120000);
    pending.set(id, { resolve: value => resolve(value as T), reject, timer }); native.postMessage({ id, method, data });
  });
  // 浏览器预览只保存编辑和音频数据，不模拟桌面推理或模型安装。
  if (method === 'state.get') return { state: preview, catalog, desktop: false } as T;
  if (method === 'draft.save') {
    const draft = data as Draft; const index = preview.drafts.findIndex(d => d.id === draft.id);
    if (index < 0) preview.drafts.unshift(draft); else preview.drafts[index] = draft;
    publish(); return true as T;
  }
  if (method === 'media.rename' || method === 'media.delete') {
    const { kind, id, name } = data as { kind: string; id: string; name: string };
    if (!['voices', 'outputs'].includes(kind)) throw new Error('音频类型无效。');
    if (method === 'media.rename') {
      if (!name?.trim() || name.trim().length > 120) throw new Error('名称需为 1–120 个字符。');
      if (kind === 'voices') preview.voices = preview.voices.map(v => v.id === id ? { ...v, name: name.trim() } : v);
      else preview.history = preview.history.map(v => v.id === id ? { ...v, title: name.trim() } : v);
    } else {
      const item = kind === 'voices' ? preview.voices.find(v => v.id === id) : preview.history.find(v => v.id === id);
      if (kind === 'voices') {
        preview.voices = preview.voices.filter(v => v.id !== id);
        preview.drafts = preview.drafts.map(d => ({ ...d, voiceId: d.voiceId === id ? null : d.voiceId, emotionVoiceId: d.emotionVoiceId === id ? null : d.emotionVoiceId }));
      } else preview.history = preview.history.filter(v => v.id !== id);
      if (item && ![...preview.voices, ...preview.history].some(v => v.fileName === item.fileName)) {
        const db = await database();
        try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('audio', 'readwrite'); tx.objectStore('audio').delete(item.fileName); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); } finally { db.close(); }
      }
    }
    publish(); return true as T;
  }
  if (method === 'draft.delete') { preview.drafts = preview.drafts.filter(draft => draft.id !== (data as { id: string }).id); publish(); return true as T; }
  if (method === 'preferences.save') { preview.preferences = data as Preferences; publish(); return true as T; }
  if (method === 'voice.record') {
    const recording = data as { base64: string; name: string };
    const bytes = Uint8Array.from(atob(recording.base64), c => c.charCodeAt(0));
    return await importVoiceFile(new File([bytes], `${recording.name}.wav`, { type: 'audio/wav' })) as T;
  }
  throw new Error('请在桌面应用中使用此功能；浏览器可预览界面、编辑正文和试听参考音频。');
}
function database(): Promise<IDBDatabase> { return new Promise((resolve, reject) => {
  const request = indexedDB.open('voice-workbench-audio', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('audio');
  request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
}); }
async function blobStore(key: string, value?: Blob): Promise<Blob | undefined> {
  const db = await database();
  try { return await new Promise((resolve, reject) => {
    const transaction = db.transaction('audio', value ? 'readwrite' : 'readonly');
    const request = value ? transaction.objectStore('audio').put(value, key) : transaction.objectStore('audio').get(key);
    transaction.oncomplete = () => resolve(value ?? request.result); transaction.onerror = () => reject(transaction.error);
  }); } finally { db.close(); }
}
export async function importVoiceFile(file: File): Promise<Voice> {
  if (file.size > 20 * 1024 * 1024) throw new Error('参考音频需小于 20 MB。');
  if (native) return call<Voice>('voice.record', { name: file.name.replace(/\.[^.]+$/, ''), base64: await toBase64(file) });
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    if (decoded.duration < 1 || decoded.duration > 60) throw new Error('请选择 1–60 秒的参考音频。');
    const wav = encodeWav(decoded);
    const id = crypto.randomUUID().replaceAll('-', '');
    const voice = { id, name: file.name.replace(/\.[^.]+$/, ''), fileName: id + '.wav', duration: decoded.duration };
    await blobStore(voice.fileName, wav); preview.voices.push(voice); publish(); return voice;
  } finally { await context.close(); }
}
export async function mediaUrl(kind: 'voices' | 'outputs', file: string): Promise<string> {
  if (native && window.__workbenchMediaBase) return `${window.__workbenchMediaBase}${kind}/${encodeURIComponent(file)}`;
  if (native) return `https://${kind}.workbench.local/${encodeURIComponent(file)}`;
  const blob = await blobStore(file); if (!blob) throw new Error('音频文件不存在，请重新导入。'); return URL.createObjectURL(blob);
}
