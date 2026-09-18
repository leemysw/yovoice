import { draftCopy } from './i18n/draftCopy';

export type Mode = 'speaker' | 'reference' | 'vector' | 'text';
export interface Draft {
  modelOptions?: Record<string, Record<string, string | number | boolean>>; speaker?: string; synthesisLanguage?: string; omniSpeed?: number;
  voiceMode?: 'design' | 'clone';
  voxMode?: 'design' | 'clone' | 'continuation'; voiceDescription?: string; referenceText?: string; guidanceScale?: number; inferenceSteps?: number;
  id: string; title: string; text: string; modelId: string; voiceId: string | null;
  mode: Mode; emotionVoiceId: string | null; emotionText: string; inferEmotion: boolean;
  emotionStrength: number; emotions: number[]; randomEmotion: boolean; language: string;
  speed: number; temperature: number; topP: number; topK: number; repetitionPenalty: number;
  maxTokens: number; intervalSilenceMs: number; doSample: boolean; numBeams: number; lengthPenalty: number; seed: number | null;
}
export interface Voice { id: string; name: string; fileName: string; duration: number }
export interface ModelPackage { variant?: string; task?: string; family: string; id: string; name: string; version: string; precision: string; remotePath: string; size: number; sha256: string }
export interface InstalledModel { id: string; path: string; managed: boolean }
export interface Generation { id: string; title: string; fileName: string; createdAt: string; duration: number; settings: Draft }
/** UI chrome locale. Distinct from Draft.language (TTS). */
export type UiLocale = 'zh-CN' | 'en';
/** Stable product message key. Catalogs and Go constants share this spelling. */
export type MessageCode = `@yovoice.${string}`;
export type MessageParams = Record<string, unknown>;
export interface Activity {
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
export interface Preferences { downloadSource: string; backend: string; modelDirectory: string | null; uiLocale: UiLocale }
export interface State {
  drafts: Draft[]; voices: Voice[]; models: InstalledModel[]; history: Generation[];
  preferences: Preferences; runtimePath: string | null; runtimeBackend: string | null; activity: Activity | null;
}

export const createDraft = (example = false, locale: UiLocale = 'zh-CN'): Draft => {
  const copy = draftCopy[locale];
  return {
  id: crypto.randomUUID().replaceAll('-', ''),
  title: example ? copy.exampleTitle : copy.untitled,
  text: example ? copy.exampleText : '',
  modelId: 'index-2.5-q8', voiceId: null, mode: 'text', emotionVoiceId: null,
  emotionText: copy.emotionText, inferEmotion: false, emotionStrength: 0.6,
  emotions: [0, 0, 0, 0, 0, 0, 0, 0.5], randomEmotion: false, language: copy.language, speed: 1,
  temperature: 0.8, topP: 0.8, topK: 30, repetitionPenalty: 10, maxTokens: 1500,
  intervalSilenceMs: 200, doSample: true, numBeams: 3, lengthPenalty: 0, seed: null,
};
};
export const emptyState = (): State => ({ drafts: [createDraft(true)], voices: [], models: [], history: [], preferences: { downloadSource: 'modelscope', backend: 'cpu', modelDirectory: null, uiLocale: 'zh-CN' }, runtimePath: null, runtimeBackend: null, activity: null });
export const formatTime = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
export const formatSize = (bytes: number) => `${(bytes / 1e9).toFixed(2)} GB`;
export interface Track { id: string; name: string; fileName: string; kind: 'voices' | 'outputs'; subtitle: string; playRequest?: number }

export const isVoxModel = (id: string) => id.startsWith('voxcpm2-');
export const isReferenceModel = (id: string) => id.startsWith('omnivoice-') || id.startsWith('qwen3-tts-');
export const requiresVoice = (draft: Draft) => draft.modelId.startsWith('qwen3-tts-') ? !/customvoice|voicedesign/.test(draft.modelId) : draft.modelId.startsWith('omnivoice-') ? draft.voiceMode === 'clone' : !isVoxModel(draft.modelId) || ['clone', 'continuation'].includes(draft.voxMode ?? 'design');
