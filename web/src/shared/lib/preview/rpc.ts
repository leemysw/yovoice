import catalogFile from '@internal/catalog/catalog.json';
import aiPresets from '@internal/llm/presets.json';
import audited from '@internal/desktop/audited.json';
import { performanceSettings, newId, type Draft, type State, type Preferences, type Character, type SynthesisSettings, type AIProvider, type AITask, type Activity, type LocalAPIStatus, type LogFilter, aiTimeoutDefault, type Asset, type AssetKind, type AssetResult, projectKind, modelMainFile, type MessageCode } from '../../workbench';
import { download } from '../client';
import { CallError } from '../call-error';
import { encodeError, previewExportLogs, previewLog, previewQueryLogs } from '../preview-logs';
import { preview, publish } from './store';
import { blobDelete, blobStore } from './blobs';
import { previewImportVoice } from './media';
import { previewInspectMelody, previewTransformMelody } from './melody';
import { assistantCancel, assistantDelete, assistantForget, assistantNew, assistantOpen, assistantProposal, assistantSend } from './assistant';

// 与 Go 服务同一份清单（internal/desktop/audited.json）：这些方法无论成败都留一条日志。
const auditedMethods = new Set<string>(audited);

// 模型目录与 Go 服务同源：桌面端由 state.get 带回，预览直接读同一份文件。
const catalog = catalogFile.models;

// 预览不监听端口：本机接口只记录开关与端口，用于演示设置页。
let localApi: LocalAPIStatus = { enabled: false, port: 8080, token: 'preview'.padEnd(64, '0'), running: false };
let mockPendingPath = '';

// 开发预览的测试钩子：浏览器测试据此模拟生成或下载的进度变化（预览没有推理引擎），并读取最近一条消息附带的上下文；
// __previewFail 让某个方法的下一次调用按给定消息码失败，用来验证界面的错误处理。
declare global { interface Window { __previewFail?: (method: string, code?: MessageCode) => void } }
const forcedFailures = new Map<string, MessageCode>();
if (import.meta.env.DEV && typeof window !== 'undefined') {
  Object.assign(window, {
    __previewActivity: (slot: 'activity' | 'modelActivity', activity: Activity | null) => { preview()[slot] = activity; publish(); },
    __previewFail: (method: string, code: MessageCode = '@yovoice.error.unknown') => { forcedFailures.set(method, code); },
  });
}

// 关键操作与桌面端一样记入日志；日志页的查询、导出和界面事件在这里直接处理。
export async function previewCall<T>(method: string, data: unknown): Promise<T> {
  if (method === 'logs.query') return previewQueryLogs((data ?? {}) as LogFilter) as T;
  if (method === 'diag.client') {
    const { event, method: source, detail } = data as { event: string; method?: string; detail?: string };
    previewLog(`client.${event.slice(0, 40)}`, { method: source, detail: detail?.slice(0, 2000) });
    return true as T;
  }
  if (method === 'logs.export') {
    download(new Blob([previewExportLogs()], { type: 'application/x-ndjson' }), 'yovoice-preview-logs.jsonl');
  }
  if (!auditedMethods.has(method)) return dispatch<T>(method, data);
  const started = performance.now(), input = (data ?? {}) as { id?: unknown; kind?: unknown; model?: unknown };
  const fields = { id: input.id, kind: input.kind, model: input.model };
  try {
    const result = await dispatch<T>(method, data);
    previewLog(method, { elapsed_ms: Math.round(performance.now() - started), ...fields });
    return result;
  } catch (error) {
    previewLog(method, { elapsed_ms: Math.round(performance.now() - started), error: encodeError(error), ...fields });
    throw error;
  }
}

// 引用参考音频的角色与作品名称，与服务端 State.VoiceUsers 一致。
function voiceUsers(state: State, id: string): string[] {
  const uses = (s: SynthesisSettings) => s.voiceId === id || s.emotionVoiceId === id;
  // 与服务端一致：所有说话人都有独立设置时，作品级设置与演绎快照不可见，不阻止删除，删除时一并清理。
  const baseHidden = (d: Draft) => !!d.subtitles?.speakers.length && d.subtitles.speakers.every(s => s.settings);
  const draftUses = (d: Draft) => (!baseHidden(d) && (uses(d) || (d.performance && uses(d.performance.settings)))) || d.subtitles?.speakers.some(s => s.settings && uses(s.settings)) || d.subtitles?.cues.some(c => c.performance && uses(c.performance.settings));
  return [...state.characters.filter(c => uses(c.settings) || c.performances?.some(p => uses(p.settings)) || (c.preview && uses(c.preview.settings))).map(c => c.name), ...state.drafts.filter(draftUses).map(d => d.title)];
}

// 资源列表：预览没有真实文件大小，按 24 kHz 16 位单声道 WAV 由时长估算；预览不生成图片。
function previewAssets(state: State): Asset[] {
  const drafts = new Map(state.drafts.map(d => [d.id, d]));
  const bytes = (seconds: number) => Math.round(seconds * 48000) + 44;
  const clipUsers = (id: string) => state.drafts.filter(d => d.timeline?.tracks.some(t => t.clips.some(c => c.generationId === id))).map(d => d.title);
  const project = (id: string) => { const d = drafts.get(id); return { projectId: id, projectTitle: d?.title, projectKind: d && projectKind(d) }; };
  return [
    ...state.history.map((g): Asset => ({ kind: g.segment ? 'segment' : 'generation', id: g.id, name: g.segment?.speakerName ? `${g.segment.speakerName} · ${g.settings.text.trim()}` : g.title, media: 'outputs', fileName: g.fileName, createdAt: g.createdAt, duration: g.duration, bytes: bytes(g.duration), users: clipUsers(g.id), ...project(g.settings.id) })),
    ...state.voices.map((v): Asset => ({ kind: 'voice', id: v.id, name: v.name, media: 'voices', fileName: v.fileName, createdAt: '', duration: v.duration, bytes: bytes(v.duration), users: voiceUsers(state, v.id) })),
    ...state.drafts.flatMap(d => (d.timeline?.assets ?? []).map((m): Asset => ({ kind: 'material', id: m.id, name: m.name, media: 'outputs', fileName: m.fileName, createdAt: '', duration: m.duration, bytes: bytes(m.duration), users: [d.title], ...project(d.id) }))),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function dispatch<T>(method: string, data: unknown): Promise<T> {
  const forced = forcedFailures.get(method);
  if (forced) { forcedFailures.delete(method); throw new CallError(forced); }
  if (method === 'assets.list') return previewAssets(preview()) as T;
  if (method === 'assets.image') throw new CallError('@yovoice.error.audioMissing');
  if (method === 'assets.delete') {
    // 与服务端一致：逐项删除，单项失败不影响其他项，失败项带消息码。
    const results: AssetResult[] = [];
    for (const item of (data as { items: { kind: AssetKind; id: string }[] }).items) {
      try {
        if (item.kind === 'material') throw new CallError('@yovoice.timeline.inUse');
        if (item.kind === 'image') throw new CallError('@yovoice.error.audioMissing');
        if (!['generation', 'segment', 'voice'].includes(item.kind)) throw new CallError('@yovoice.error.audioKindInvalid');
        await dispatch('media.delete', { kind: item.kind === 'voice' ? 'voices' : 'outputs', id: item.id });
        results.push({ kind: item.kind, id: item.id });
      } catch (e) {
        results.push({ kind: item.kind, id: item.id, error: e instanceof CallError ? e.code : '@yovoice.error.unknown', params: e instanceof CallError ? e.params : undefined });
      }
    }
    return results as T;
  }
  const state = preview();
  // 预览默认带上助手运行时；测试可用 yovoice-preview-no-ocho 模拟安装包缺失的情形。
  const assistant = { available: !localStorage.getItem('yovoice-preview-no-ocho') };
  if (method === 'logs.export') return true as T;
  // 预览不能运行本机程序：Codex 显示为未安装，登录需要桌面端。
  if (method === 'ai.codex.status') return {} as T;
  if (method === 'ai.codex.login') throw new CallError('@yovoice.error.previewDesktopOnly');
  if (method === 'state.get') return { state, catalog, catalogRevision: catalogFile.revision, engine: { version: '', minimum: '' }, desktop: false, assistant } as T;
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
  if (method === 'generation.lyricTimes') {
    const { id, times } = data as { id: string; times: number[] };
    const item = state.history.find(v => v.id === id);
    if (!item) throw new CallError('@yovoice.error.audioMissing');
    if (times.length > 2000 || times.some((t, i) => !(t >= 0) || t > item.duration + 1 || (i > 0 && t < times[i - 1]))) throw new CallError('@yovoice.error.requestInvalid');
    state.history = state.history.map(v => v.id === id ? { ...v, lyricTimes: times.length ? [...times] : undefined, lyricWords: undefined } : v);
    publish(); return true as T;
  }
  if (method === 'generation.lyricWords') {
    const { id, words } = data as { id: string; words: { word: string; start: number; end: number }[] };
    const item = state.history.find(v => v.id === id);
    if (!item) throw new CallError('@yovoice.error.audioMissing');
    if (!words.length || words.length > 20000 || words.some((w, i) => !w.word || [...w.word].length > 64 || !(w.start >= 0) || !(w.end >= w.start) || w.end > item.duration + 1 || (i > 0 && w.start < words[i - 1].start))) throw new CallError('@yovoice.error.requestInvalid');
    state.history = state.history.map(v => v.id === id ? { ...v, lyricWords: words.map(w => ({ ...w })), lyricTimes: undefined } : v);
    publish(); return true as T;
  }
  // 浏览器预览没有推理引擎：装了对齐模型时把歌词里的字均匀铺在歌曲中段，只用来演示界面；桌面端才真正分离人声并对齐。
  if (method === 'generation.alignLyrics') {
    const { id } = data as { id: string };
    const item = state.history.find(v => v.id === id);
    if (!item) throw new CallError('@yovoice.error.audioMissing');
    if (!state.models.some(m => m.id.startsWith('lyric-align-'))) throw new CallError('@yovoice.error.alignModelRequired');
    const letters = item.settings.instrumental ? [] : (item.settings.lyrics ?? '').split('\n').filter(line => !/^\s*\[[^\]]*\]\s*$/.test(line)).join(' ').match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}']+/gu) ?? [];
    if (!letters.length) throw new CallError('@yovoice.error.alignLyrics');
    const span = item.duration * .8 / letters.length;
    const lyricWords = letters.map((word, i) => ({ word, start: +(item.duration * .1 + i * span).toFixed(3), end: +(item.duration * .1 + (i + .8) * span).toFixed(3) }));
    state.history = state.history.map(v => v.id === id ? { ...v, lyricWords, lyricTimes: undefined } : v);
    publish(); return true as T;
  }
  // 参考片段挑选与音频体检在桌面端测量；预览后端不分析音频，挑选固定取开头 10 秒，体检返回已有结果。
  if (method === 'voice.suggest') {
    const voice = state.voices.find(v => v.id === (data as { id: string }).id);
    if (!voice) throw new CallError('@yovoice.error.audioMissing');
    return { start: 0, end: Math.min(voice.duration, 10) } as T;
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
        const names = voiceUsers(state, id);
        if (names.length) throw new CallError('@yovoice.error.voiceReferenced', { names: names.join(', ') });
        state.voices = state.voices.filter(v => v.id !== id);
        const clear = <T extends SynthesisSettings>(s: T): T => ({ ...s, voiceId: s.voiceId === id ? null : s.voiceId, emotionVoiceId: s.emotionVoiceId === id ? null : s.emotionVoiceId });
        state.drafts = state.drafts.map(d => ({ ...clear(d), performance: d.performance && { ...d.performance, settings: clear(d.performance.settings) } }));
        state.history = state.history.map(g => ({ ...g, settings: { ...g.settings, voiceId: g.settings.voiceId === id ? null : g.settings.voiceId, emotionVoiceId: g.settings.emotionVoiceId === id ? null : g.settings.emotionVoiceId } }));
      } else {
        // 与服务端一致：同时清掉时间轴的已采纳标记和由它保存出的声音的来源。
        state.history = state.history.filter(v => v.id !== id);
        state.drafts = state.drafts.map(d => d.timeline?.acceptedGenerations?.includes(id) ? { ...d, timeline: { ...d.timeline, acceptedGenerations: d.timeline.acceptedGenerations.filter(g => g !== id) } } : d);
        state.voices = state.voices.map(v => v.sourceGenerationId === id ? { ...v, sourceGenerationId: undefined } : v);
      }
      if (item && ![...state.voices, ...state.history].some(v => v.fileName === item.fileName)) await blobDelete(item.fileName);
    }
    publish(); return true as T;
  }
  if (method === 'draft.delete') {
    const id = (data as { id: string }).id;
    if (state.activity?.status === 'running' && state.activity.projectId === id) throw new CallError('@yovoice.error.busy');
    const otherDrafts = state.drafts.filter(d => d.id !== id);
    const referencedGenIds = new Set<string>();
    const referencedAssetIds = new Set<string>();
    for (const d of otherDrafts) {
      for (const track of d.timeline?.tracks ?? []) {
        for (const clip of track.clips) {
          if (clip.generationId) referencedGenIds.add(clip.generationId);
          if (clip.assetId) referencedAssetIds.add(clip.assetId);
        }
      }
    }
    const targetDraft = state.drafts.find(d => d.id === id);
    for (const asset of targetDraft?.timeline?.assets ?? []) {
      if (!referencedAssetIds.has(asset.id)) {
        await blobDelete(asset.fileName);
      }
    }
    const removedGens = state.history.filter(g => g.settings.id === id && !referencedGenIds.has(g.id));
    for (const gen of removedGens) {
      if (![...state.voices, ...state.history.filter(g => !removedGens.includes(g))].some(v => v.fileName === gen.fileName)) {
        await blobDelete(gen.fileName);
      }
    }
    state.history = state.history.filter(g => !removedGens.includes(g));
    state.drafts = otherDrafts;
    publish();
    return true as T;
  }
  if (method === 'storage.info') {
    return {
      root: mockPendingPath || '/Users/preview/.yovoice',
      modelsBytes: 1024 * 1024 * 350,
      outputsBytes: 1024 * 1024 * 15,
      voicesBytes: 1024 * 1024 * 5,
      downloadsBytes: 1024 * 1024 * 80,
      totalBytes: 1024 * 1024 * 450,
      pendingPath: mockPendingPath || undefined,
    } as T;
  }
  if (method === 'storage.directory') {
    mockPendingPath = '/Volumes/Data/yovoice-data';
    return true as T;
  }
  if (method === 'storage.directory.open') return true as T;
  if (method === 'storage.cleanup') {
    return { cleanedCount: 0, freedBytes: 0 } as T;
  }
  if (method === 'localApi.get' || method === 'localApi.save' || method === 'localApi.resetToken') {
    if (method === 'localApi.save') {
      const { enabled, port } = data as { enabled: boolean; port: number };
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new CallError('@yovoice.error.localApiPort');
      localApi = { ...localApi, enabled, port };
    }
    if (method === 'localApi.resetToken') localApi = { ...localApi, token: newId().repeat(2) };
    localApi = { ...localApi, running: localApi.enabled, url: localApi.enabled ? `http://127.0.0.1:${localApi.port}` : undefined };
    return structuredClone(localApi) as T;
  }
  if (method === 'preferences.save') { state.preferences = data as Preferences; publish(); return true as T; }
  if (method === 'voice.record') {
    const recording = data as { base64: string; name: string };
    const bytes = Uint8Array.from(atob(recording.base64), c => c.charCodeAt(0));
    return await previewImportVoice(new File([bytes], `${recording.name}.wav`, { type: 'audio/wav' })) as T;
  }
  // AI 服务配置可在预览中编辑（不保存密钥），实际调用模型只在桌面端进行。
  if (method === 'ai.provider.save') {
    const input = data as AIProvider & { key?: string | null };
    const preset = aiPresets.find(p => p.key === input.preset);
    if (!preset) throw new CallError('@yovoice.error.aiProviderInvalid');
    const editable = preset.endpoint !== 'fixed';
    const next: AIProvider = { id: input.id || newId(), preset: preset.key, name: input.name?.trim() || preset.name, format: preset.endpoint === 'custom' ? input.format : preset.format, baseURL: editable ? input.baseURL.trim() : preset.baseURL, modelsPath: preset.endpoint === 'custom' ? input.modelsPath : preset.modelsPath, model: input.model?.trim() ?? '' };
    // ChatGPT 订阅经本机 Codex CLI，没有服务地址。
    if (next.format !== 'codex_cli' && !/^https?:\/\/[^/]+/.test(next.baseURL)) throw new CallError('@yovoice.error.aiProviderInvalid');
    const providers = state.aiProviders ?? [];
    const old = providers.find(p => p.id === next.id);
    next.keyMask = input.key == null ? old?.keyMask : input.key.trim() ? '••••••••' : undefined;
    next.models = old?.models;
    state.aiProviders = old ? providers.map(p => p.id === next.id ? next : p) : [...providers, next];
    state.aiProviderID ||= next.id;
    publish(); return next as T;
  }
  if (method === 'ai.provider.delete' || method === 'ai.provider.use') {
    const id = (data as { id: string }).id;
    if (method === 'ai.provider.delete') {
      state.aiProviders = (state.aiProviders ?? []).filter(p => p.id !== id);
      if (state.aiProviderID === id) state.aiProviderID = state.aiProviders[0]?.id ?? '';
    } else {
      // 写作栏切换模型时同时改服务的当前模型。
      const model = (data as { model?: string }).model?.trim();
      state.aiProviderID = id;
      if (model) state.aiProviders = (state.aiProviders ?? []).map(p => p.id === id ? { ...p, model } : p);
    }
    publish(); return true as T;
  }
  // 预览模拟 OrcaRouter 一键授权：不打开外部页面，稍后直接添加使用免费模型的服务并设为当前服务。
  if (method === 'ai.connect') {
    setTimeout(() => {
      const providers = state.aiProviders ?? [];
      const old = providers.find(p => p.preset === 'orcarouter');
      const next: AIProvider = { id: old?.id ?? newId(), preset: 'orcarouter', name: old?.name ?? 'OrcaRouter', format: 'chat_completions', baseURL: 'https://api.orcarouter.ai/v1', modelsPath: '/models', model: old?.model || 'orcarouter/free', models: old?.models, keyMask: '••••••••' };
      state.aiProviders = old ? providers.map(p => p.id === next.id ? next : p) : [...providers, next];
      state.aiProviderID = next.id; publish();
    }, 300);
    return { url: '' } as T;
  }
  // 旋律谱的完整校验在 Go 中；预览只读出谱头与人声旋律，便于查看导入的谱。
  if (method === 'melody.inspect') return previewInspectMelody((data as { abc: string }).abc) as T;
  // 试听要用音色库渲染，只在桌面里做；预览只检查是否装了音色库。
  if (method === 'melody.listen') throw new CallError(state.models.some(m => m.id.endsWith('-sf2')) ? '@yovoice.error.previewDesktopOnly' : '@yovoice.error.melodySoundFontRequired');
  if (method === 'melody.transform') {
    const { abc, op, tempo } = data as { abc: string; op: string; tempo: number };
    return previewTransformMelody(abc, op, tempo) as T;
  }
  if (method === 'melody.dismiss') {
    if (state.melody?.id === (data as { id: string }).id) { delete state.melody; publish(); }
    return true as T;
  }
  // 预览模拟 AI 后台任务的生命周期：开始后短暂运行，再以“仅桌面可用”结束，便于检查界面闭环。
  if (method === 'ai.cast') {
    const input = { projectId: '', brief: (data as { title: string }).title };
    const provider = state.aiProviders?.find(p => p.id === state.aiProviderID);
    if (!provider?.model) throw new CallError('@yovoice.error.aiNotConfigured');
    if (state.aiTask?.status === 'running') throw new CallError('@yovoice.error.busy');
    const task: AITask = { id: newId(), kind: 'cast', projectId: input.projectId, brief: input.brief, status: 'running', stage: 'writing', provider: provider.name, model: provider.model, timeout: state.preferences.aiTimeout || aiTimeoutDefault, startedAt: new Date().toISOString() };
    state.aiTask = task; publish();
    setTimeout(() => {
      if (state.aiTask?.id !== task.id || state.aiTask.status !== 'running') return;
      state.aiTask = { ...state.aiTask, status: 'failed', finishedAt: new Date().toISOString(), errorCode: '@yovoice.error.previewDesktopOnly' }; publish();
    }, 1500);
    return task as T;
  }
  if (method === 'ai.cancel') {
    if (state.aiTask?.status === 'running') { state.aiTask = { ...state.aiTask, status: 'cancelled', finishedAt: new Date().toISOString() }; publish(); }
    return true as T;
  }
  if (method === 'ai.dismiss') {
    if (state.aiTask?.id === (data as { id: string }).id && state.aiTask.status !== 'running') { delete state.aiTask; publish(); }
    return true as T;
  }
  // 助手对话、会话与提案的模拟在 assistant.ts；一轮结束后排队的下一条消息经 previewCall 重新进入分发，与真实后端的路径一致。
  if (method === 'assistant.send') return assistantSend(state, data, assistant.available, next => { void previewCall('assistant.send', next); }) as T;
  if (method === 'assistant.cancel') return assistantCancel(state) as T;
  if (method === 'assistant.new') return assistantNew(state) as T;
  if (method === 'assistant.open') return assistantOpen(state, data) as T;
  if (method === 'assistant.proposal') return assistantProposal(state, data) as T;
  if (method === 'assistant.forget') return assistantForget(state, data) as T;
  if (method === 'assistant.delete') return assistantDelete(state, data) as T;
  if (method === 'model.download') {
    const id = (data as { id: string }).id;
    const installed = state.models.find(model => model.id === id);
    const definition = catalog.find(model => model.id === id);
    if (!installed || !definition) throw new CallError('@yovoice.error.previewDesktopOnly');
    installed.sha256 = modelMainFile(definition as Parameters<typeof modelMainFile>[0]).sha256;
    publish();
    return true as T;
  }
  throw new CallError('@yovoice.error.previewDesktopOnly');
}
