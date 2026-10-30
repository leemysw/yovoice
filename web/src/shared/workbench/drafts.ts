// 作品草稿的工厂与合成参数：新建草稿与空状态、从草稿/角色/台词取合成参数、判断试听是否过期。
import { draftCopy } from '../i18n/draft-copy';
import { seedLocale, type UiLocale } from '../i18n/locale';
import { stableJSON } from './format';
import type { Character, CharacterPerformance, Draft, Generation, ProjectPage, Score, State, SubtitleCue, SynthesisSettings } from './types';

// 旧字幕作品沿用原始数据，统一归入故事。
export const projectKind = (draft: Draft): ProjectPage => draft.kind === 'music' || draft.kind === 'score' || draft.kind === 'sfx' ? draft.kind : draft.subtitles || draft.kind === 'story' || draft.kind === 'subtitle' ? 'story' : 'text';
export const synthesisSettings = ({ performance: _performance, id: _id, title: _title, text: _text, kind: _kind, characterId: _characterId, createdAt: _createdAt, updatedAt: _updatedAt, subtitles: _subtitles, timeline: _timeline, score: _score, ...settings }: Draft): SynthesisSettings => structuredClone(settings);
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
/** 时间轴上正在使用的这一句的版本；还没放上时间轴时为空。 */
export function cueGeneration(draft: Draft, history: Generation[], cue: SubtitleCue): Generation | undefined {
  const ids = new Set(draft.timeline?.tracks.flatMap(t => t.clips.map(c => c.generationId)) ?? []);
  return history.find(g => ids.has(g.id) && g.segment?.cueId === cue.id);
}
export function cueAudioStatus(draft: Draft, history: Generation[], cue: SubtitleCue): 'missing' | 'stale' | 'ready' {
  const generation = cueGeneration(draft, history, cue);
  if (!generation) return 'missing';
  return generation.settings.text === cue.text && generation.segment?.speakerId === cue.speakerId && stableJSON(comparableSettings(synthesisSettings(generation.settings))) === stableJSON(comparableSettings(cueSettings(draft, cue))) ? 'ready' : 'stale';
}

/** 标题为空或仍是任一界面语言的“未命名作品”时视为尚未命名，AI 写作可以顺带起名。 */
export const isUntitled = (title: string) => !title.trim() || Object.values(draftCopy).some(copy => copy.untitled === title.trim());

/** 新建对象的 ID：32 位十六进制，与 Go 的 schema.NewID 一致。 */
export const newId = () => crypto.randomUUID().replaceAll('-', '');

export const createDraft = (example = false, locale: UiLocale = 'zh-CN', modelId = 'index-2.5-q8'): Draft => {
  const copy = draftCopy[seedLocale(locale)];
  return {
  id: newId(),
  title: example ? copy.exampleTitle : copy.untitled,
  text: example ? copy.exampleText : '',
  modelId, voiceId: null, mode: 'text', emotionVoiceId: null,
  emotionText: copy.emotionText, inferEmotion: false, emotionStrength: 0.6,
  emotions: [0, 0, 0, 0, 0, 0, 0, 0.5], randomEmotion: false, language: copy.language, speed: 1,
  temperature: 0.8, topP: 0.8, topK: 30, repetitionPenalty: 10, maxTokens: 1500,
  intervalSilenceMs: 200, doSample: true, numBeams: 3, lengthPenalty: 0, seed: null,
};
};
export const emptyState = (): State => ({ characters: [], previews: [], drafts: [createDraft(true)], voices: [], models: [], history: [], preferences: { downloadSource: 'modelscope', backend: 'cpu', modelDirectory: null, uiLocale: 'zh-CN' }, runtimePath: null, runtimeBackend: null, runtimeVersion: null, activity: null, modelActivity: null });

export const emptyScore = (): Score => ({ tempo: 100, timeSignature: [4, 4], key: '', sections: [], tracks: [] });
