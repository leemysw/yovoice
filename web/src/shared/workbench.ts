import { draftCopy } from './i18n/draft-copy';

export type Mode = 'speaker' | 'reference' | 'vector' | 'text';
export interface SynthesisSettings {
  modelOptions?: Record<string, Record<string, string | number | boolean>>; speaker?: string; synthesisLanguage?: string; omniSpeed?: number;
  voiceMode?: 'design' | 'clone';
  voxMode?: 'design' | 'clone' | 'continuation'; voiceDescription?: string; referenceText?: string; guidanceScale?: number; inferenceSteps?: number;
  modelId: string; voiceId: string | null;
  mode: Mode; emotionVoiceId: string | null; emotionText: string; inferEmotion: boolean;
  emotionStrength: number; emotions: number[]; randomEmotion: boolean; language: string;
  speed: number; temperature: number; topP: number; topK: number; repetitionPenalty: number;
  maxTokens: number; intervalSilenceMs: number; doSample: boolean; numBeams: number; lengthPenalty: number; seed: number | null;
}
export interface SubtitleSpeaker { id: string; sourceName: string; characterId?: string; settings?: SynthesisSettings }
export interface CharacterPerformance { id: string; name: string; settings: SynthesisSettings }
export interface SubtitleCue { performance?: CharacterPerformance; id?: string; start: number; end: number; text: string; speakerId: string }
export interface SubtitleDocument { speakers: SubtitleSpeaker[]; cues: SubtitleCue[] }
export interface AudioClip { id: string; generationId?: string; assetId?: string; start: number; offset: number; duration: number; gainDb?: number }
export interface AudioLane { id: string; name: string; muted: boolean; solo?: boolean; locked?: boolean; gainDb?: number; duckDb?: number; clips: AudioClip[] }
export interface AudioAsset { id: string; name: string; fileName: string; duration: number }
export interface AudioMarker { id: string; time: number; name: string }
export interface AudioTimeline { markers?: AudioMarker[]; regenerateMode?: 'ripple' | 'preserve'; assets?: AudioAsset[]; acceptedGenerations?: string[]; tracks: AudioLane[] }
export type ProjectKind = 'text' | 'story' | 'subtitle';
export interface Draft extends SynthesisSettings { performance?: CharacterPerformance; id: string; title: string; text: string; kind?: ProjectKind; characterId?: string; createdAt?: string; updatedAt?: string; subtitles?: SubtitleDocument; timeline?: AudioTimeline }
// 旧字幕作品沿用原始数据，统一归入故事。
export const projectKind = (draft: Draft): 'text' | 'story' => draft.subtitles || draft.kind === 'story' || draft.kind === 'subtitle' ? 'story' : 'text';
export interface CharacterPreview { id: string; fileName: string; duration: number; settings: SynthesisSettings; text: string }
export interface Character { performances?: CharacterPerformance[]; id: string; name: string; settings: SynthesisSettings; demoText: string; preview?: CharacterPreview; createdAt?: string; updatedAt?: string }
export const synthesisSettings = ({ performance: _performance, id: _id, title: _title, text: _text, kind: _kind, characterId: _characterId, createdAt: _createdAt, updatedAt: _updatedAt, subtitles: _subtitles, timeline: _timeline, ...settings }: Draft): SynthesisSettings => structuredClone(settings);
// 参数键的序列化顺序不影响试听是否过期。
export const stableJSON = (value: unknown): string => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
// 与 Go 的可选字段默认值对齐，保留 seed=0 与自动随机种子的区别。
const comparableSettings = (settings: SynthesisSettings) => ({ speaker: '', synthesisLanguage: '', omniSpeed: 0, voiceMode: '', voxMode: '', voiceDescription: '', referenceText: '', guidanceScale: 0, inferenceSteps: 0, modelOptions: {}, ...Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== undefined)) });
export const previewStale = (c: Character) => !!c.preview && (c.demoText !== c.preview.text || stableJSON(comparableSettings(c.settings)) !== stableJSON(comparableSettings(c.preview.settings)));
// 每种演绎保存独立的模型和参数快照。
export function performanceSettings(base: SynthesisSettings, performance?: CharacterPerformance): SynthesisSettings {
  return structuredClone(performance?.settings ?? base);
}
export function cueSettings(draft: Draft, cue: SubtitleCue): SynthesisSettings {
  return performanceSettings(draft.subtitles?.speakers.find(s => s.id === cue.speakerId)?.settings ?? synthesisSettings(draft), cue.performance);
}
export function cueAudioStatus(draft: Draft, history: Generation[], cue: SubtitleCue): 'missing' | 'stale' | 'ready' {
  const ids = new Set(draft.timeline?.tracks.flatMap(t => t.clips.map(c => c.generationId)) ?? []);
  const generation = history.find(g => ids.has(g.id) && g.segment?.cueId === cue.id);
  if (!generation) return 'missing';
  return generation.settings.text === cue.text && generation.segment?.speakerId === cue.speakerId && stableJSON(comparableSettings(synthesisSettings(generation.settings))) === stableJSON(comparableSettings(cueSettings(draft, cue))) ? 'ready' : 'stale';
}
export interface Voice { referenceText?: string; source?: string; sourceGenerationId?: string; id: string; name: string; fileName: string; duration: number }
export interface ModelPackage { voices?: string[]; variant?: string; task?: string; family: string; id: string; name: string; version: string; precision: string; remotePath: string; size: number; sha256: string }
export interface InstalledModel { id: string; path: string; managed: boolean }
export interface GenerationSegment { cueId: string; speakerId: string; speakerName: string; batchId: string; index: number; targetClipId?: string; placement?: 'ripple' | 'preserve' }
export interface Generation { segment?: GenerationSegment; id: string; title: string; fileName: string; createdAt: string; duration: number; settings: Draft }
/** UI chrome locale. Distinct from Draft.language (TTS). */
export type UiLocale = 'zh-CN' | 'en';
/** Stable product message key. Catalogs and Go constants share this spelling. */
export type MessageCode = `@yovoice.${string}`;
export type MessageParams = Record<string, unknown>;
export interface Activity {
  cueId?: string;
  projectId?: string;
  characterId?: string;
  requestId?: string;
  startedAt?: string | null;
  modelId?: string | null;
  kind: string;
  code: MessageCode;
  params: MessageParams | null;
  status: string;
  received: number;
  total: number;
  errorCode: MessageCode | null;
  errorParams: MessageParams | null;
}
export interface Preferences { downloadSource: string; backend: string; modelDirectory: string | null; uiLocale: UiLocale; proxyURL?: string; proxyEnabled?: boolean }
export interface State {
  characters: Character[]; previews: CharacterPreview[]; drafts: Draft[]; voices: Voice[]; models: InstalledModel[]; history: Generation[];
  preferences: Preferences; runtimePath: string | null; runtimeBackend: string | null; runtimeVersion: string | null; runtimes?: Record<string, { path: string; version: string }>; activity: Activity | null;
}

export const createDraft = (example = false, locale: UiLocale = 'zh-CN', modelId = 'index-2.5-q8'): Draft => {
  const copy = draftCopy[locale];
  return {
  id: crypto.randomUUID().replaceAll('-', ''),
  title: example ? copy.exampleTitle : copy.untitled,
  text: example ? copy.exampleText : '',
  modelId, voiceId: null, mode: 'text', emotionVoiceId: null,
  emotionText: copy.emotionText, inferEmotion: false, emotionStrength: 0.6,
  emotions: [0, 0, 0, 0, 0, 0, 0, 0.5], randomEmotion: false, language: copy.language, speed: 1,
  temperature: 0.8, topP: 0.8, topK: 30, repetitionPenalty: 10, maxTokens: 1500,
  intervalSilenceMs: 200, doSample: true, numBeams: 3, lengthPenalty: 0, seed: null,
};
};
export const emptyState = (): State => ({ characters: [], previews: [], drafts: [createDraft(true)], voices: [], models: [], history: [], preferences: { downloadSource: 'modelscope', backend: 'cpu', modelDirectory: null, uiLocale: 'zh-CN' }, runtimePath: null, runtimeBackend: null, runtimeVersion: null, activity: null });
// version 是推荐安装的 audio.cpp 版本，minimum 是当前应用可用的最低版本。
export interface EngineInfo { version: string; minimum: string }
// 服务未报告版本要求（如浏览器预览）时不做限制。
const versionAtLeast = (value: string | null, minimum: string) => {
  if (!minimum) return true;
  const parse = (v: string | null) => /^v(\d+)\.(\d+)\.(\d+)$/.exec(v ?? '')?.slice(1).map(Number);
  const a = parse(value), b = parse(minimum);
  if (!a || !b) return false;
  const index = a.findIndex((n, i) => n !== b[i]);
  return index < 0 || a[index] > b[index];
};
// 内核需与所选设备一致：低于最低版本时必须更新；不低于最低版本但低于推荐版本时可继续使用，升级可选。
export type RuntimeStatus = 'ready' | 'upgradable' | 'outdated' | 'missing';
export const runtimeStatus = (state: State, engine: EngineInfo): RuntimeStatus =>
  !state.runtimePath || state.runtimeBackend !== state.preferences.backend ? 'missing'
    : !versionAtLeast(state.runtimeVersion, engine.minimum) ? 'outdated'
      : versionAtLeast(state.runtimeVersion, engine.version) ? 'ready' : 'upgradable';
export const runtimeUsable = (status: RuntimeStatus) => status === 'ready' || status === 'upgradable';
export const formatTime = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
export const formatSize = (bytes: number) => `${(bytes / 1e9).toFixed(2)} GB`;
export interface Track { id: string; name: string; fileName: string; kind: 'voices' | 'outputs'; subtitle: string; playRequest?: number }

export const isKokoroModel = (id: string) => id.startsWith('kokoro-');
export const isVoxModel = (id: string) => id.startsWith('voxcpm2-');
export const isReferenceModel = (id: string) => id.startsWith('omnivoice-') || id.startsWith('qwen3-tts-');
export const requiresVoice = (draft: Draft) => isKokoroModel(draft.modelId) ? false : draft.modelId.startsWith('qwen3-tts-') ? !/customvoice|voicedesign/.test(draft.modelId) : draft.modelId.startsWith('omnivoice-') ? draft.voiceMode === 'clone' : !isVoxModel(draft.modelId) || ['clone', 'continuation'].includes(draft.voxMode ?? 'design');

// 旧字幕的身份与 Go 保持一致，编辑后不再依赖数组位置。
export function withCueIds(draft: Draft): Draft {
  if (!draft.subtitles || draft.subtitles.cues.every(c => c.id)) return draft;
  return { ...draft, subtitles: { ...draft.subtitles, cues: draft.subtitles.cues.map((cue, index) => ({ ...cue, id: cue.id ?? `legacy-${draft.id}-${index}` })) } };
}
