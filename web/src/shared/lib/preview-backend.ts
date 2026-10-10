import catalog from './catalog.json';
import { performanceSettings, emptyState, type AudioAsset, type Draft, type State, type Voice, type Preferences, type Character, type SynthesisSettings } from '../workbench';
import { encodeWav } from './sound';
import { CallError } from './call-error';

// 浏览器预览的本地后端：只保存编辑和音频数据，不模拟桌面推理或模型安装。
// 作品状态存于 localStorage（主副本加恢复备份），音频存于 IndexedDB。
const primaryKey = 'voice-workbench-v1';
const backupKey = 'voice-workbench-backup';
const maxUploadBytes = 20 * 1024 * 1024;

const listeners = new Set<(state: State) => void>();
let stored: State | undefined;

function load(): State {
  let state = emptyState();
  for (const key of [primaryKey, backupKey]) {
    try {
      const value = JSON.parse(localStorage.getItem(key) ?? 'null');
      if (!value || !Array.isArray(value.drafts) || !Array.isArray(value.history) || !Array.isArray(value.voices)) continue;
      state = value; break;
    } catch { /* 主副本损坏时继续读取恢复备份。 */ }
  }
  state.characters ??= []; state.previews = [];
  if (!['zh-CN', 'en'].includes(state.preferences?.uiLocale)) {
    state = { ...state, preferences: { ...state.preferences, uiLocale: 'zh-CN' } };
  }
  return state;
}

// 首次使用时才读取本地存储，桌面端不会触碰预览数据。
const preview = () => stored ??= load();

function publish() {
  const previous = localStorage.getItem(primaryKey);
  if (previous) { try { JSON.parse(previous); localStorage.setItem(backupKey, previous); } catch { /* 损坏的主副本不覆盖恢复备份。 */ } }
  localStorage.setItem(primaryKey, JSON.stringify(preview()));
  listeners.forEach(fn => fn(structuredClone(preview())));
}

export function subscribePreview(listener: (state: State) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

export async function previewCall<T>(method: string, data: unknown): Promise<T> {
  const state = preview();
  if (method === 'state.get') return { state, catalog, engine: { version: '', minimum: '' }, desktop: false } as T;
  if (method === 'character.save') {
    const character = structuredClone(data as Character);
    if (!character.name.trim() || character.name.length > 120 || character.demoText.length > 2000) throw new CallError('@yovoice.error.characterInvalid');
    if ([character.settings.voiceId, character.settings.emotionVoiceId].some(id => id && !state.voices.some(v => v.id === id))) throw new CallError('@yovoice.error.voiceRequired');
    if ((character.performances?.length ?? 0) > 32 || character.performances?.some((p, i, all) => !/^[a-f0-9]{32}$/i.test(p.id) || !p.name.trim() || p.name.trim().length > 120 || all.some((v, j) => j !== i && (p.id === v.id || p.name.trim().toLowerCase() === v.name.trim().toLowerCase())))) throw new CallError('@yovoice.error.characterInvalid');
    character.performances = character.performances?.map(p => ({ ...p, name: p.name.trim(), settings: performanceSettings(character.settings, p) }));
    if (character.performances?.some(p => [p.settings.voiceId, p.settings.emotionVoiceId].some(id => id && !state.voices.some(v => v.id === id)))) throw new CallError('@yovoice.error.voiceRequired');
    const index = state.characters.findIndex(c => c.id === character.id);
    character.name = character.name.trim(); character.createdAt = index < 0 ? new Date().toISOString() : state.characters[index].createdAt;
    character.updatedAt = new Date().toISOString();
    if (index < 0) state.characters.push(character); else state.characters[index] = character;
    publish(); return character as T;
  }
  if (method === 'character.delete') { state.characters = state.characters.filter(c => c.id !== (data as { id: string }).id); publish(); return true as T; }
  if (method === 'character.discardPreview') return true as T;
  if (method === 'voice.update' || method === 'voice.fromGeneration') {
    const input = data as { id: string; name: string; referenceText: string };
    if (!input.name.trim() || input.name.length > 100 || input.referenceText.length > 2000) throw new CallError('@yovoice.error.characterInvalid');
    if (method === 'voice.update') {
      const voice = state.voices.find(v => v.id === input.id);
      if (!voice) throw new CallError('@yovoice.error.audioMissing');
      voice.name = input.name.trim(); voice.referenceText = input.referenceText;
      publish(); return voice as T;
    }
    const generation = state.history.find(g => g.id === input.id);
    if (!generation) throw new CallError('@yovoice.error.audioMissing');
    const blob = await blobStore(generation.fileName);
    if (!blob) throw new CallError('@yovoice.error.audioBlobMissing');
    const voice = await previewImportVoice(new File([blob], input.name.trim() + '.wav'));
    Object.assign(voice, { referenceText: input.referenceText, source: 'generation', sourceGenerationId: input.id });
    publish(); return voice as T;
  }
  if (method === 'draft.save') {
    const draft = structuredClone(data as Draft); const index = state.drafts.findIndex(d => d.id === draft.id);
    draft.createdAt = index < 0 ? new Date().toISOString() : state.drafts[index]?.createdAt;
    draft.updatedAt = state.drafts[index]?.updatedAt;
    if (index < 0 || JSON.stringify(draft) !== JSON.stringify(state.drafts[index])) draft.updatedAt = new Date().toISOString();
    if (index < 0) state.drafts.unshift(draft); else state.drafts[index] = draft;
    publish(); return true as T;
  }
  if (method === 'media.rename' || method === 'media.delete') {
    const { kind, id, name } = data as { kind: string; id: string; name: string };
    if (!['voices', 'outputs'].includes(kind)) throw new CallError('@yovoice.error.audioKindInvalid');
    if (method === 'media.rename') {
      if (!name?.trim() || name.trim().length > 120) throw new CallError('@yovoice.error.nameLength');
      if (kind === 'voices') state.voices = state.voices.map(v => v.id === id ? { ...v, name: name.trim() } : v);
      else state.history = state.history.map(v => v.id === id ? { ...v, title: name.trim() } : v);
    } else {
      const item = kind === 'voices' ? state.voices.find(v => v.id === id) : state.history.find(v => v.id === id);
      if (kind === 'outputs' && state.drafts.some(d => d.timeline?.tracks.some(t => t.clips.some(c => c.generationId === id)))) throw new CallError('@yovoice.timeline.inUse');
      if (kind === 'voices') {
        const uses = (s: SynthesisSettings) => s.voiceId === id || s.emotionVoiceId === id;
        const draftUses = (d: Draft) => uses(d) || (d.performance && uses(d.performance.settings)) || d.subtitles?.speakers.some(s => s.settings && uses(s.settings)) || d.subtitles?.cues.some(c => c.performance && uses(c.performance.settings));
        const names = [...state.characters.filter(c => uses(c.settings) || c.performances?.some(p => uses(p.settings)) || (c.preview && uses(c.preview.settings))).map(c => c.name), ...state.drafts.filter(draftUses).map(d => d.title), ...state.history.filter(g => draftUses(g.settings)).map(g => g.title)];
        if (names.length) throw new CallError('@yovoice.error.voiceReferenced', { names: names.join(', ') });
        state.voices = state.voices.filter(v => v.id !== id);
        state.drafts = state.drafts.map(d => ({ ...d, voiceId: d.voiceId === id ? null : d.voiceId, emotionVoiceId: d.emotionVoiceId === id ? null : d.emotionVoiceId }));
      } else state.history = state.history.filter(v => v.id !== id);
      if (item && ![...state.voices, ...state.history].some(v => v.fileName === item.fileName)) await blobDelete(item.fileName);
    }
    publish(); return true as T;
  }
  if (method === 'draft.delete') { state.drafts = state.drafts.filter(draft => draft.id !== (data as { id: string }).id); publish(); return true as T; }
  if (method === 'preferences.save') { state.preferences = data as Preferences; publish(); return true as T; }
  if (method === 'voice.record') {
    const recording = data as { base64: string; name: string };
    const bytes = Uint8Array.from(atob(recording.base64), c => c.charCodeAt(0));
    return await previewImportVoice(new File([bytes], `${recording.name}.wav`, { type: 'audio/wav' })) as T;
  }
  throw new CallError('@yovoice.error.previewDesktopOnly');
}

export function assertUploadSize(file: Blob) {
  if (file.size > maxUploadBytes) throw new CallError('@yovoice.error.audioTooLarge');
}

export async function previewImportTimeline(file: File, name: string): Promise<AudioAsset> {
  assertUploadSize(file);
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    if (buffer.duration < 0.01 || buffer.duration > 3600) throw new CallError('@yovoice.timeline.importDuration');
    const id = crypto.randomUUID().replaceAll('-', '');
    const asset = { id, name, fileName: `import-${id}.wav`, duration: buffer.duration };
    await blobStore(asset.fileName, encodeWav(buffer));
    return asset;
  } finally { await context.close(); }
}

export async function previewImportVoice(file: File): Promise<Voice> {
  assertUploadSize(file);
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    if (decoded.duration < 1 || decoded.duration > 60) throw new CallError('@yovoice.error.audioDuration');
    const wav = encodeWav(decoded);
    const id = crypto.randomUUID().replaceAll('-', '');
    const voice = { id, name: file.name.replace(/\.[^.]+$/, ''), fileName: id + '.wav', duration: decoded.duration };
    await blobStore(voice.fileName, wav); preview().voices.push(voice); publish(); return voice;
  } finally { await context.close(); }
}

export async function previewMediaUrl(file: string): Promise<string> {
  const blob = await blobStore(file); if (!blob) throw new CallError('@yovoice.error.audioBlobMissing'); return URL.createObjectURL(blob);
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

async function blobDelete(key: string): Promise<void> {
  const db = await database();
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('audio', 'readwrite'); tx.objectStore('audio').delete(key); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); } finally { db.close(); }
}
