// 模型包的判断：按模型 id 识别家族与用途、设置页分组、新作品的默认模型，以及是否需要参考音色。
import type { Draft, ModelFile, ModelPackage, State } from './types';

export const modelMainFile = (model: ModelPackage): ModelFile => model.files?.find(file => file.path === model.remotePath) ?? { path: model.remotePath, size: model.size, sha256: model.sha256 };
export const modelUpdateAvailable = (state: Pick<State, 'models'>, model: ModelPackage) => {
  const installed = state.models.find(item => item.id === model.id);
  return installed?.sha256 && installed.sha256 !== modelMainFile(model).sha256 ? installed : undefined;
};

export const isKokoroModel = (id: string) => id.startsWith('kokoro-');
/** Stable Audio 3 用英文描述生成纯音乐或音效，不唱歌词；可在作品已有的版本上改编或局部重绘。 */
export const isStableAudio = (id: string) => id.startsWith('stable-audio-');
// 音乐模型只用于音乐作品，不出现在配音和角色的模型列表里。
export const isMusicModel = (id: string) => id.startsWith('ace-step-') || id.startsWith('yue2-') || isStableAudio(id);
/** YuE2 由歌词或旋律谱决定长度，没有时长设置。 */
export const isYuE = (id: string) => id.startsWith('yue2-');
// 设置里模型按用途分页：语音模型、音乐模型（歌曲生成、扒谱与歌词对齐）和编曲音色库。
const musicFamilies = new Set(['ace_step', 'yue2', 'stable_audio', 'sheetsage2', 'lyric_align']);
export const modelTab = (family: string) => family === 'soundfont' ? 'soundfonts' : musicFamilies.has(family) ? 'music-models' : 'models';
export const modelTabs = ['models', 'music-models', 'soundfonts'];
// 音色库只供编曲作品渲染使用。
export const isSoundFont = (id: string) => id.endsWith('-sf2');
// 扒谱模型只用于从歌曲提取旋律谱。
export const isTranscriber = (id: string) => id.startsWith('sheetsage2-');
// 歌词对齐模型只用于给已生成的歌曲做逐字对齐，可选下载。
export const isAligner = (id: string) => id.startsWith('lyric-align-');
export const isVoiceModel = (id: string) => !isMusicModel(id) && !isSoundFont(id) && !isTranscriber(id) && !isAligner(id);
// 同名模型的不同量化归为一组，保持目录顺序。
export function groupModels(models: ModelPackage[]) {
  const groups = new Map<string, ModelPackage[]>();
  for (const model of models) groups.set(model.name, [...(groups.get(model.name) ?? []), model]);
  return [...groups.values()];
}
// 音效可用专门的 SFX 模型或 Stable Audio Medium；Small Music 只用于歌曲。
export const isSfxModel = (id: string) => isStableAudio(id) && (id.includes('-sfx-') || id.includes('-medium-'));
// 新作品的默认模型：沿用最近一次同类作品用过且已安装的模型，否则取第一个已安装的同类模型，都没有时用 fallback。
export function preferredModel(state: Pick<State, 'models' | 'drafts'>, kind: 'text' | 'story' | 'music' | 'score' | 'sfx', fallback: string) {
  const fits = kind === 'music' ? (id: string) => isMusicModel(id) && !id.includes('-sfx-') : kind === 'sfx' ? isSfxModel : kind === 'score' ? isSoundFont : isVoiceModel;
  const installed = new Set(state.models.map(model => model.id));
  const recent = state.drafts.filter(d => installed.has(d.modelId) && fits(d.modelId)).sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))[0];
  return recent?.modelId ?? state.models.find(model => fits(model.id))?.id ?? fallback;
}
export const isIndexModel = (id: string) => id.startsWith('index-');
export const isVoxModel = (id: string) => id.startsWith('voxcpm2-');
export const isReferenceModel = (id: string) => id.startsWith('omnivoice-') || id.startsWith('qwen3-tts-');
export const isBreezeModel = (id: string) => id.startsWith('breeze-tts-');
export const isMingModel = (id: string) => id.startsWith('ming3-tts-');
export const isVoxtralModel = (id: string) => id.startsWith('voxtral-tts-');
export const isPlapreModel = (id: string) => id.startsWith('plapre-');
export const isXTTSModel = (id: string) => id.startsWith('xtts-v2-');
export const isGradiumModel = (id: string) => id.startsWith('gradium-phonon-');
export const isDramaModel = (id: string) => id.startsWith('fish-drama3-');
export const requiresVoice = (draft: Draft) => isKokoroModel(draft.modelId) || isVoxtralModel(draft.modelId) || isGradiumModel(draft.modelId) || !isVoiceModel(draft.modelId) ? false : draft.modelId.startsWith('qwen3-tts-') ? !/customvoice|voicedesign/.test(draft.modelId) : draft.modelId.startsWith('omnivoice-') || isBreezeModel(draft.modelId) || isMingModel(draft.modelId) || isPlapreModel(draft.modelId) || isDramaModel(draft.modelId) ? draft.voiceMode === 'clone' : !isVoxModel(draft.modelId) || ['clone', 'continuation'].includes(draft.voxMode ?? 'design');
