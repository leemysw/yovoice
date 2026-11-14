// 工作台共享的数据结构：作品、角色、模型、生成记录、助手会话等，字段与 Go 的 schema 对齐。
// 这里只放类型以及派生类型所依赖的常量；判断与工厂函数在同目录的其他文件里。
import type { UiLocale } from '../i18n/locale';

export type Mode = 'speaker' | 'reference' | 'vector' | 'text';
// 作品的运行方式：是否边生成边试听。
export interface RuntimeSettings { streaming?: boolean }
// 推理引擎的运行参数（设置 › 推理引擎），对所有模型生效；session 的键带模型族前缀。
// 语音转写的限制与断句参数（设置 › 常规 › 语音转写），不填的项用默认值（见 transcribeDefaults）。
export interface TranscribeSettings { maxFileMB?: number; maxMinutes?: number; lineChars?: number; lineSeconds?: number; linePause?: number; normalizeLoudness?: boolean; isolateVocals?: boolean }
export interface EngineSettings { threads?: number; device?: number; idleUnloadSeconds?: number; session?: Record<string, string | number | boolean> }
export interface SynthesisSettings {
  runtime?: RuntimeSettings;
  modelOptions?: Record<string, Record<string, string | number | boolean>>; speaker?: string; synthesisLanguage?: string; omniSpeed?: number;
  lyrics?: string; instrumental?: boolean;
  // YuE2 的 ABC 旋律谱：带和弦按谱编曲，只有旋律时按旋律填配器。
  abc?: string;
  sourceGenerationId?: string;
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
// 编曲乐谱与 Go 的 schema.Score 一致：位置以小节和拍计，拍从 1 开始，音高为 MIDI 音高。
export interface ScoreNote { bar: number; beat: number; pitch: number; length: number; velocity: number }
export interface ScoreRamp { start: number; end: number; from: number; to: number }
export interface Humanize { velocity?: number; timingMs?: number }
export type ScoreRole = 'melody' | 'piano' | 'strings' | 'bass' | 'drums' | 'pad' | 'arp' | 'other';
export interface ScoreTrack { id: string; name: string; role?: ScoreRole; program: number; drums?: boolean; level?: number; pan?: number; reverb?: number; mute?: boolean; humanize?: Humanize; dynamics?: ScoreRamp[]; notes: ScoreNote[] }
export interface ScoreSection { name: string; start: number; end: number; tempo?: number }
export interface Score { tempo: number; timeSignature: number[]; key?: string; sections?: ScoreSection[]; tracks: ScoreTrack[] }
export type ProjectKind = 'text' | 'story' | 'subtitle' | 'music' | 'score' | 'sfx';
export interface Draft extends SynthesisSettings { performance?: CharacterPerformance; id: string; title: string; text: string; kind?: ProjectKind; characterId?: string; createdAt?: string; updatedAt?: string; subtitles?: SubtitleDocument; timeline?: AudioTimeline; score?: Score }
export type ProjectPage = 'text' | 'story' | 'music' | 'score' | 'sfx';
export interface CharacterPreview { id: string; fileName: string; duration: number; settings: SynthesisSettings; text: string }
export interface Character { performances?: CharacterPerformance[]; id: string; name: string; settings: SynthesisSettings; demoText: string; preview?: CharacterPreview; createdAt?: string; updatedAt?: string }
export interface Voice { referenceText?: string; source?: string; sourceGenerationId?: string; id: string; name: string; fileName: string; duration: number; excerpt?: VoiceExcerpt }
/** 导入的录音过长时自动截取的片段：start/end 为在原录音里的秒数，total 为原录音时长。 */
export interface VoiceExcerpt { start: number; end: number; total: number }
export interface ModelFile { path: string; size: number; sha256: string }
export interface ModelPackage { voices?: string[]; variant?: string; maxDuration?: number; loadOptions?: Record<string, string>; sessionOptions?: Record<string, string>; files?: ModelFile[]; directory?: string; stripPrefix?: string; task?: string; engineMinimum?: string; family: string; id: string; name: string; version: string; precision: string; remotePath: string; size: number; sha256: string; history?: ModelVersion[] }
/** 被目录更新替换掉的旧版本，replaced 为替换日期；多文件包的版本由 files 里主文件的摘要区分。 */
export interface ModelVersion { replaced: string; revision: string; modelScopeRevision: string; size: number; sha256?: string; files?: ModelFile[] }
/** pinned：用户主动换到了旧版本，不再提示更新。 */
export interface InstalledModel { id: string; path: string; managed: boolean; sha256?: string; pinned?: boolean; converted?: boolean }
export interface GenerationSegment { cueId: string; speakerId: string; speakerName: string; batchId: string; index: number; targetClipId?: string; placement?: 'ripple' | 'preserve' }
// 本机 Codex CLI 的检测结果：path 为空表示未安装，login 为 chatgpt、apikey 或空（未登录）。
export interface CodexInfo { path?: string; version?: string; login?: 'chatgpt' | 'apikey' }
// 服务日志的一条记录与查询：级别是下限，模块是事件名第一段；结果新的在前。
export type LogLevel = 'INFO' | 'WARN' | 'ERROR';
export interface LogEntry { time: string; level: LogLevel; event: string; fields?: Record<string, unknown> }
export interface LogFilter { level?: string; module?: string; text?: string; since?: string; offset?: number; limit?: number }
export interface LogPage { entries: LogEntry[]; total: number; modules: string[] }
export interface Generation { segment?: GenerationSegment; id: string; title: string; fileName: string; createdAt: string; duration: number; settings: Draft; lyricTimes?: number[]; gene?: string; lyricWords?: AlignedWord[]; textWords?: AlignedWord[]; check?: AudioCheck; seed?: number; stemOf?: string; stem?: StemName; patchOf?: string; patchBars?: number[] }
/** HTDemucs 6-stem 的分轨名；分轨结果是同一作品里 stemOf 指向原版本的版本。 */
export type StemName = 'drums' | 'bass' | 'other' | 'vocals' | 'guitar' | 'piano';
/** 生成后的测量体检：整体响度（LUFS）、真峰值（dBTP）与发现的问题。 */
export interface AudioCheck { loudness: number; peak: number; issues?: AudioIssue[] }
/** 体检发现的一处问题；at/end 为秒。 */
export interface AudioIssue { code: AudioIssueCode; at: number; end?: number; count?: number }
export type AudioIssueCode = 'clipping' | 'clicks' | 'cutoff' | 'silence' | 'silent' | 'quiet' | 'dc';
/** 歌词对齐模型给出的逐字时间（秒），和逐行校准互斥，以最近一次为准。 */
export interface AlignedWord { word: string; start: number; end: number }
/** UI chrome locale. Distinct from Draft.language (TTS). */
export type { UiLocale };
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
  // melody 为出谱或扒谱，align 为歌词对齐，recognize 为识别声音样本的参考文本。
  task?: 'melody' | 'align' | 'recognize' | 'transcribe' | 'caption' | 'stems' | 'midi' | 'local-model-import';
  code: MessageCode;
  params: MessageParams | null;
  status: string;
  received: number;
  total: number;
  errorCode: MessageCode | null;
  errorParams: MessageParams | null;
}
// 本机接口的设置与运行状态，由 localApi.* 调用返回，不属于作品状态。
export interface LocalAPIStatus { enabled: boolean; port: number; token: string; running: boolean; url?: string; error?: { code: MessageCode; params?: MessageParams } }
// 存储空间状态与清理结果，由 storage.* 调用返回。
export interface StorageInfo {
  root: string;
  modelsBytes: number;
  outputsBytes: number;
  voicesBytes: number;
  downloadsBytes: number;
  totalBytes: number;
  pendingPath?: string;
}
export interface CleanupReport {
  cleanedCount: number;
  freedBytes: number;
}
export interface Preferences { downloadSource: string; backend: string; performanceFirst?: boolean; modelDirectory: string | null; uiLocale: UiLocale; proxyURL?: string; proxyEnabled?: boolean; aiTimeout?: number; introSeen?: boolean; tourSeen?: boolean; assistantQuiet?: boolean; hiddenFeatures?: Feature[]; theme?: AppTheme; engine?: EngineSettings; transcribe?: TranscribeSettings; recognizeModel?: string; alignSeparator?: 'htdemucs'; hotkeys?: HotkeySettings }
/** 改过的快捷键与快捷键开关，与 Go 的 schema.HotkeySettings 一致：bindings 只记与默认不同的命令，空字符串表示清除；off 是停用的功能区。 */
export interface HotkeySettings { disabled?: boolean; off?: string[]; bindings?: Record<string, string> }
// 可在设置中隐藏的功能入口：故事配音、音乐生成（含编曲与音效）与 Ocho 助手，默认全部显示。
export const optionalFeatures = ['story', 'music', 'transcribe', 'assistant'] as const;
export type Feature = typeof optionalFeatures[number];
// 界面主题，与 Go 的 schema.Themes 一致；偏好里没有 theme 时跟随系统（浅色用纸白，深色用夜墨）。
export const appThemes = ['paper', 'ink', 'lagoon', 'sand', 'sage', 'abyss'] as const;
export type AppTheme = typeof appThemes[number];
export interface State {
  runtimeOptions?: Record<string, string[]>;
  runtimeModes?: Record<string, string[]>;
  runtimeSessionOptions?: Record<string, string[]>;
  characters: Character[]; previews: CharacterPreview[]; drafts: Draft[]; voices: Voice[]; models: InstalledModel[]; history: Generation[];
  preferences: Preferences; runtimePath: string | null; runtimeBackend: string | null; runtimeVersion: string | null; runtimes?: Record<string, { path: string; version: string }>; activity: Activity | null; modelActivity?: Activity | null;
  modelDownloads?: Record<string, { version: string; received: number; total: number; status: string }>;
  aiProviders?: AIProvider[]; aiProviderID?: string; aiTask?: AITask;
  melody?: MelodyResult;
  midiImport?: MidiImport;
  transcript?: TranscriptResult;
  transcripts?: Transcript[];
  /** 助手会话的持久化记录与仅广播的实时状态，与 Go 的 schema.AssistantSessions/Live 一致。 */
  assistantSessions?: AssistantSessions; assistantLive?: AssistantLive; assistantMemory?: AssistantMemo[];
  /** 社区账号与进行中的登录、分享，与 Go 的 schema.CommunityState 一致；只在本次会话有效。 */
  community?: CommunityState;
  /** state.get 附带的随包 AI 助手运行时可用性：缺失时 AI 写作入口禁用。 */
  assistantMissing?: boolean;
}

// 引擎写出的旋律谱，与 Go 的 schema.MelodyResult 一致：plan 为按歌词出谱，cover 为从歌曲扒谱；只在本次会话有效。
/** 从版本扒出 MIDI 后新建的编曲作品，界面打开后清除。 */
export interface MidiImport { id: string; projectId: string; sourceId: string }
/** 导入的 YuE2 LoRA 适配器，由 adapter.list 返回，不属于作品状态。 */
export interface Adapter { id: string; name: string; size: number; createdAt: string }
export interface MelodyResult { id: string; projectId: string; source: 'plan' | 'cover'; abc: string; truncated?: boolean; createdAt: string }
// 识别声音样本得到的文字，与 Go 的 schema.TranscriptResult 一致，只在本次会话有效，由发起识别的输入框填入后清除。
export interface TranscriptResult { id: string; voiceId: string; text: string; language?: string; createdAt: string }
// 转写页保存的转写记录，与 Go 的 schema.Transcript 一致；字幕内容由 transcript.read 读取。
// videoFile 是输入为可直接播放的视频时保存的原视频，用来在编辑页预览画面。
export interface Transcript { id: string; name?: string; language?: string; duration: number; fileName: string; audioFile?: string; videoFile?: string; excerpt?: string; createdAt: string; updatedAt?: string }
// 一行字幕，与 Go 的 schema.TranscriptCaption 一致。
export interface TranscriptCaption { start: number; end: number; text: string }
// 字幕文件的内容，与 Go 的 schema.TranscriptContent 一致；还没编辑过时本地服务读取时按逐词时间分好行。
export interface TranscriptContent { text: string; words: AlignedWord[]; captions: TranscriptCaption[] | null }
/** 后端解析旋律谱的结果；issue 指出第一处问题所在的小节与声部。 */
export interface MelodyIssue { code: string; line?: number; bar?: number; voice?: string; detail?: string }
export interface MelodyInspection { issue?: MelodyIssue; tempo?: number; meter?: [number, number]; key?: string; bars?: number; seconds?: number; chords?: boolean; score?: Score }

// 社区状态，与 Go 的 schema.Community* 一致。登录在浏览器里确认：code 是要核对的确认码，url 是确认页。
export interface CommunityAccount { nickname: string; email: string }
export interface CommunityLogin { code: string; url: string; expiresAt: string; expired?: boolean }
export interface CommunityShare {
  id: string; generationId: string; status: 'running' | 'completed' | 'failed' | 'cancelled'; stage: 'packing' | 'uploading' | 'submitting';
  received: number; total: number; errorCode?: string; errorParams?: Record<string, unknown>;
}
export interface CommunityState { account?: CommunityAccount; login?: CommunityLogin; share?: CommunityShare }
/** 自己分享到社区的一个作品，由 community.mine 返回。 */
export interface CommunityItem { id: string; kind: string; status: 'draft' | 'pending' | 'published' | 'rejected' | 'removed'; title: string; reviewNote?: string; likeCount: number; useCount: number; createdAt: string }
// 可选的大模型服务，与 Go 的 schema.AIProvider 一致；密钥不在状态中，只有掩码。
export interface AITest { ok: boolean; code?: string; params?: Record<string, unknown>; at: string }
// 后台 AI 写作任务，与 Go 的 schema.AITask 一致；只在本次会话有效。
export type AITaskKind = 'cast' | 'image';
export interface AITask {
  id: string; kind: AITaskKind; projectId: string; brief: string; status: 'running' | 'completed' | 'failed' | 'cancelled'; stage: 'writing' | 'repairing'; done?: number; total?: number;
  provider: string; model: string; timeout: number; startedAt: string; finishedAt?: string; result?: unknown; errorCode?: string; errorParams?: Record<string, unknown>;
}
export interface AIProvider { id: string; preset: string; name: string; format: string; baseURL: string; modelsPath: string; model: string; models?: string[]; keyMask?: string; lastTest?: AITest }

// 助手会话记录与实时状态，与 Go 的 schema.Assistant* 一致。
export type AssistantMessageRole = 'user' | 'assistant';
export type AssistantToolCardState = 'running' | 'done' | 'error';
export interface AssistantToolCard { tool: string; summary?: string; args?: string; state?: AssistantToolCardState; proposal?: AssistantProposal }
/** 助手提议、等用户在卡片上确认的操作，与 Go 的 schema.AssistantProposal 一致。 */
export type AssistantProposalState = 'pending' | 'confirmed' | 'dismissed' | 'failed';
export interface AssistantProposal { id: string; action: string; target?: string; value?: string; label?: string; reason?: string; state: AssistantProposalState; errorCode?: string; errorParams?: Record<string, unknown> }
/** 助手记住的一条用户偏好。 */
export interface AssistantMemo { id: string; text: string; createdAt: string }
/** 助手消息里按出现顺序排列的一块：文本、思考或一次工具调用。 */
export interface AssistantBlock { kind: 'text' | 'thinking' | 'tool'; text?: string; card?: AssistantToolCard }
/** 助手消息：blocks 为按顺序的内容块，text 为文本块拼接；tools 只出现在旧版本记录里。 */
export interface AssistantMessage {
  id: string; role: AssistantMessageRole; text?: string; blocks?: AssistantBlock[];
  status?: 'completed' | 'cancelled' | 'failed'; errorCode?: MessageCode; errorParams?: MessageParams; createdAt: string;
}
/** 一段助手对话：每个会话对应独立的助手时间线。 */
export interface AssistantSession { id: string; title: string; messages: AssistantMessage[]; updatedAt: string }
export interface AssistantSessions { currentId: string; sessions: AssistantSession[] }
export interface AssistantTurn { blocks?: AssistantBlock[]; model?: string; startedAt: string }
export interface AssistantNav { id: string; workId?: string; page?: string }
export interface AssistantUpdate { id: string; workId: string }
export interface AssistantLive { turn?: AssistantTurn | null; queued?: number; nav?: AssistantNav | null; update?: AssistantUpdate | null }
/** assistant.send 附带的界面上下文，与 Go 的 workbench.AssistantContext 一致。 */
export interface AssistantContext {
  page?: string; workId?: string; workTitle?: string; workKind?: string; locale?: UiLocale;
  /** 发送时刻用户在编辑区选中的文字、故事配音里选中的台词与播放位置（秒）。 */
  selection?: string; cue?: AssistantCue; playhead?: number;
}
export interface AssistantCue { index: number; total: number; speaker?: string; text?: string }

export interface Track { id: string; name: string; fileName: string; kind: 'voices' | 'outputs'; subtitle: string; playRequest?: number }
/** 资源页的一行，对应 Go 的 workbench.Asset；bytes 为 -1 表示文件已丢失，users 非空表示正在被引用。 */
export type AssetKind = 'generation' | 'segment' | 'voice' | 'material' | 'image';
export interface Asset { kind: AssetKind; id: string; name: string; media: 'outputs' | 'voices' | 'images'; fileName: string; projectId?: string; projectTitle?: string; projectKind?: ProjectPage; createdAt: string; duration?: number; bytes: number; users?: string[] }
export interface AssetResult { kind: AssetKind; id: string; error?: MessageCode; params?: MessageParams }
