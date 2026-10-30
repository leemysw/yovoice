// Package msg 定义界面可翻译的稳定消息码与结构化调用错误。
package msg

import "errors"

// Code is a stable catalog key. Spelling matches web @yovoice.* entries.
type Code string

const (
	ErrProjectPackage         Code = "@yovoice.timeline.packageInvalid"
	ErrProjectPackageLimit    Code = "@yovoice.timeline.packageLimit"
	ErrTimelineImportDuration Code = "@yovoice.timeline.importDuration"
	ErrTimelineInvalid        Code = "@yovoice.timeline.invalid"
	ErrTimelineInUse          Code = "@yovoice.timeline.inUse"
	ErrSubtitleInvalid        Code = "@yovoice.subtitle.invalid"
	ActivitySubtitle          Code = "@yovoice.subtitle.progress"
	ErrVoiceReferenced        Code = "@yovoice.error.voiceReferenced"
	ErrVoiceInUse             Code = "@yovoice.error.voiceInUse"
	ErrCharacterInvalid       Code = "@yovoice.error.characterInvalid"

	ErrOmniReferenceRequired    Code = "@yovoice.error.omniReferenceRequired"
	ErrReferenceTextRequired    Code = "@yovoice.error.referenceTextRequired"
	ErrXTTSReferenceDuration    Code = "@yovoice.error.xttsReferenceDuration"
	ErrVoiceDescriptionRequired Code = "@yovoice.error.voiceDescriptionRequired"
	ErrOmniAttributes           Code = "@yovoice.error.omniAttributes"
	ErrSpeakerInvalid           Code = "@yovoice.error.speakerInvalid"
)

const (
	ActivityDownload        Code = "@yovoice.activity.download"
	ActivityDownloading     Code = "@yovoice.activity.downloading"
	ActivityVerifying       Code = "@yovoice.activity.verifying"
	ActivityRuntimeDownload Code = "@yovoice.activity.runtimeDownload"
	ActivityRuntimeExtract  Code = "@yovoice.activity.runtimeExtract"
	ActivityEngineStart     Code = "@yovoice.activity.engineStart"
	ActivityGenerate        Code = "@yovoice.activity.generate"
	ActivitySynthesizing    Code = "@yovoice.activity.synthesizing"
	ActivitySavingAudio     Code = "@yovoice.activity.savingAudio"
	ActivityRendering       Code = "@yovoice.activity.rendering"
	ActivityCompleted       Code = "@yovoice.activity.completed"
	ActivityCancelled       Code = "@yovoice.activity.cancelled"
	ActivityPaused          Code = "@yovoice.activity.paused"
	ActivityFailed          Code = "@yovoice.activity.failed"
	ActivityInterrupted     Code = "@yovoice.activity.interrupted"
	ActivityRelocate        Code = "@yovoice.activity.relocate"
	ActivityPlanMelody      Code = "@yovoice.activity.planMelody"
	ActivityTranscribe      Code = "@yovoice.activity.transcribe"
	// 歌词逐字对齐：先分离人声，再按段对齐（参数含当前段与总段数）。
	ActivitySeparateVocals Code = "@yovoice.activity.separateVocals"
	ActivityAlignLyrics    Code = "@yovoice.activity.alignLyrics"

	ErrBusy                  Code = "@yovoice.error.busy"
	ErrProxyURL              Code = "@yovoice.error.proxyURL"
	ErrModelDirAbsolute      Code = "@yovoice.error.modelDirAbsolute"
	ErrModelDirSpace         Code = "@yovoice.error.modelDirSpace"
	ErrDownloadHTTP          Code = "@yovoice.error.downloadHTTP"
	ErrDownloadRange         Code = "@yovoice.error.downloadRange"
	ErrDownloadSize          Code = "@yovoice.error.downloadSize"
	ErrDownloadIncomplete    Code = "@yovoice.error.downloadIncomplete"
	ErrDownloadStale         Code = "@yovoice.error.downloadStale"
	ErrDownloadChecksum      Code = "@yovoice.error.downloadChecksum"
	ErrDownloadOversized     Code = "@yovoice.error.downloadOversized"
	ErrGenerateFailed        Code = "@yovoice.error.generateFailed"
	ErrParamsOutOfRange      Code = "@yovoice.error.paramsOutOfRange"
	ErrStateSaveFailed       Code = "@yovoice.error.stateSaveFailed"
	ErrStateCorrupt          Code = "@yovoice.error.stateCorrupt"
	ErrAudioPathInvalid      Code = "@yovoice.error.audioPathInvalid"
	ErrAudioPathSymlink      Code = "@yovoice.error.audioPathSymlink"
	ErrAudioMissing          Code = "@yovoice.error.audioMissing"
	ErrAudioKindInvalid      Code = "@yovoice.error.audioKindInvalid"
	ErrAudioIDInvalid        Code = "@yovoice.error.audioIDInvalid"
	ErrAudioTooLarge         Code = "@yovoice.error.audioTooLarge"
	ErrAudioDuration         Code = "@yovoice.error.audioDuration"
	ErrAudioFormat           Code = "@yovoice.error.audioFormat"
	ErrAudioDecode           Code = "@yovoice.error.audioDecode"
	ErrAudioConverterMissing Code = "@yovoice.error.audioConverterMissing"
	ErrNameLength            Code = "@yovoice.error.nameLength"
	ErrDraftLimits           Code = "@yovoice.error.draftLimits"
	ErrDraftIDInvalid        Code = "@yovoice.error.draftIDInvalid"
	ErrTextRequired          Code = "@yovoice.error.textRequired"
	ErrTitleLength           Code = "@yovoice.error.titleLength"
	ErrLanguageUnsupported   Code = "@yovoice.error.languageUnsupported"
	ErrModeInvalid           Code = "@yovoice.error.modeInvalid"
	ErrEmotionInvalid        Code = "@yovoice.error.emotionInvalid"
	ErrEmotionStrength       Code = "@yovoice.error.emotionStrength"
	ErrEmotionTextRequired   Code = "@yovoice.error.emotionTextRequired"
	ErrEmotionVoiceRequired  Code = "@yovoice.error.emotionVoiceRequired"
	ErrVoiceRequired         Code = "@yovoice.error.voiceRequired"
	ErrVoiceBusyDelete       Code = "@yovoice.error.voiceBusyDelete"
	ErrModelRequired         Code = "@yovoice.error.modelRequired"
	ErrModelUnsupported      Code = "@yovoice.error.modelUnsupported"
	ErrModelMoved            Code = "@yovoice.error.modelMoved"
	ErrModelForgetBlocked    Code = "@yovoice.error.modelForgetBlocked"
	ErrDownloadSource        Code = "@yovoice.error.downloadSource"
	ErrRuntimeRequired       Code = "@yovoice.error.runtimeRequired"
	ErrRuntimeMissing        Code = "@yovoice.error.runtimeMissing"
	ErrRuntimeUnique         Code = "@yovoice.error.runtimeUnique"
	ErrRuntimeArchivePath    Code = "@yovoice.error.runtimeArchivePath"
	ErrRuntimeArchiveLink    Code = "@yovoice.error.runtimeArchiveLink"
	ErrRuntimeArchiveSize    Code = "@yovoice.error.runtimeArchiveSize"
	ErrEngineStartFailed     Code = "@yovoice.error.engineStartFailed"
	ErrEngineStartTimeout    Code = "@yovoice.error.engineStartTimeout"
	ErrEngineNoAudio         Code = "@yovoice.error.engineNoAudio"
	ErrEngineCrashed         Code = "@yovoice.error.engineCrashed"
	ErrCPUBundleInvalid      Code = "@yovoice.error.cpuBundleInvalid"
	ErrBackendUnsupported    Code = "@yovoice.error.backendUnsupported"
	ErrPlatformArch          Code = "@yovoice.error.platformArch"
	ErrMacBackend            Code = "@yovoice.error.macBackend"
	ErrMacAppleSilicon       Code = "@yovoice.error.macAppleSilicon"
	ErrRequestInvalid        Code = "@yovoice.error.requestInvalid"
	ErrMethodUnsupported     Code = "@yovoice.error.methodUnsupported"
	ErrVoxModeInvalid        Code = "@yovoice.error.voxModeInvalid"
	ErrVoxTextLimits         Code = "@yovoice.error.voxTextLimits"
	ErrVoxReferenceRequired  Code = "@yovoice.error.voxReferenceRequired"
	ErrVoxParams             Code = "@yovoice.error.voxParams"
	ErrLegacyRestore         Code = "@yovoice.error.legacyRestore"
	ErrMusicStyle            Code = "@yovoice.error.musicStyle"
	ErrMusicLyrics           Code = "@yovoice.error.musicLyrics"
	ErrMusicParams           Code = "@yovoice.error.musicParams"
	ErrMusicLyricsRequired   Code = "@yovoice.error.musicLyricsRequired"
	// Stable Audio 改编时没有选起点版本，或选中的版本已删除、音频文件丢失。
	ErrMusicSourceRequired Code = "@yovoice.error.musicSourceRequired"
	ErrScoreInvalid        Code = "@yovoice.error.scoreInvalid"
	ErrScoreTooLong        Code = "@yovoice.error.scoreTooLong"
	ErrMidiInvalid         Code = "@yovoice.error.midiInvalid"
	// 旋律谱：谱面不合方言（参数含小节与声部）、引擎没有写出谱、扒谱模型未下载。
	ErrMelodyInvalid           Code = "@yovoice.error.melodyInvalid"
	ErrMelodyEmpty             Code = "@yovoice.error.melodyEmpty"
	ErrCoverModelRequired      Code = "@yovoice.error.coverModelRequired"
	ErrMelodySoundFontRequired Code = "@yovoice.error.melodySoundFontRequired"
	// 歌词逐字对齐：对齐模型未下载、没有可对齐的歌词、模型没有对上任何字。
	ErrAlignModelRequired    Code = "@yovoice.error.alignModelRequired"
	ErrAlignLyrics           Code = "@yovoice.error.alignLyrics"
	ErrAlignEmpty            Code = "@yovoice.error.alignEmpty"
	ErrEngineUpgradeRequired Code = "@yovoice.error.engineUpgradeRequired"
	// AI 服务（可选）：未配置、鉴权、限流、网络、响应异常与结果无效。
	ErrAIProviderInvalid Code = "@yovoice.error.aiProviderInvalid"
	ErrAINotConfigured   Code = "@yovoice.error.aiNotConfigured"
	ErrAIAuth            Code = "@yovoice.error.aiAuth"
	ErrAIRateLimit       Code = "@yovoice.error.aiRateLimit"
	ErrAINetwork         Code = "@yovoice.error.aiNetwork"
	ErrAIResponse        Code = "@yovoice.error.aiResponse"
	ErrAIModelsPath      Code = "@yovoice.error.aiModelsPath"
	ErrAIResultInvalid   Code = "@yovoice.error.aiResultInvalid"
	ErrAITimeout         Code = "@yovoice.error.aiTimeout"
	// 内置助手（ocho 运行时）缺失：安装包未随附且未通过 YOVOICE_OCHO_PATH 指定。
	ErrAssistantMissing Code = "@yovoice.error.assistantMissing"
	// 当前 AI 服务无法供内置助手使用（如经 Codex CLI 的 ChatGPT 订阅）。
	ErrAssistantProvider Code = "@yovoice.error.assistantProvider"
	// Codex CLI：未安装、未登录、运行失败、额度用完。
	ErrCodexMissing   Code = "@yovoice.error.codexMissing"
	ErrCodexLoggedOut Code = "@yovoice.error.codexLoggedOut"
	ErrCodexFailed    Code = "@yovoice.error.codexFailed"
	ErrCodexLimit     Code = "@yovoice.error.codexLimit"
	// Codex 运行结束但没有生成图片（工具不可用或模型拒绝），detail 为模型的说明。
	ErrCodexNoImage Code = "@yovoice.error.codexNoImage"
	// OrcaRouter 免费模型的四种拒绝：窗口已满、通道繁忙、单次提示超长、账号未满足免费条件。
	ErrAIFreeRate      Code = "@yovoice.error.aiFreeRate"
	ErrAIFreeBusy      Code = "@yovoice.error.aiFreeBusy"
	ErrAIFreePromptCap Code = "@yovoice.error.aiFreePromptCap"
	ErrAIFreeAccess    Code = "@yovoice.error.aiFreeAccess"
	// 本机接口：端口超出范围、端口已被占用。
	ErrLocalAPIPort      Code = "@yovoice.error.localApiPort"
	ErrLocalAPIPortInUse Code = "@yovoice.error.localApiPortInUse"
	// 存储迁移：不能在应用安装目录内、目标目录非空、不能与当前目录相同。
	ErrStorageInsideApp      Code = "@yovoice.error.storageInsideApp"
	ErrStorageTargetNotEmpty Code = "@yovoice.error.storageTargetNotEmpty"
	ErrStorageSame           Code = "@yovoice.error.storageSame"
	ErrStorageInsideData     Code = "@yovoice.error.storageInsideData"
	ErrStorageRestart        Code = "@yovoice.error.storageRestartRequired"
	// 数据目录在运行中被删除或断开（外置盘拔出），写入无法完成。
	ErrDataRootMissing Code = "@yovoice.error.dataRootMissing"
	// 磁盘已满：写入状态、音频或下载时系统返回空间不足。
	ErrDiskFull Code = "@yovoice.error.diskFull"
	ErrUnknown  Code = "@yovoice.error.unknown"
)

// Params carries ICU values. Keys match catalog placeholders.
type Params map[string]any

// CallError is the typed user-facing RPC error. Wire JSON: {"code","params"}.
type CallError struct {
	Code   Code   `json:"code"`
	Params Params `json:"params,omitempty"`
}

func (e *CallError) Error() string {
	if e == nil {
		return string(ErrUnknown)
	}
	return string(e.Code)
}

// Err builds a CallError for anything the UI shows.
func Err(code Code, params Params) *CallError {
	return &CallError{Code: code, Params: params}
}

func Encode(err error) map[string]any {
	var ce *CallError
	if errors.As(Classify(err), &ce) && ce != nil {
		out := map[string]any{"code": ce.Code}
		if len(ce.Params) > 0 {
			out["params"] = ce.Params
		}
		return out
	}
	return map[string]any{"code": ErrUnknown, "params": Params{"detail": err.Error()}}
}

// All lists every Code constant for catalog coverage checks.
func All() []Code {
	return []Code{ErrProjectPackage, ErrProjectPackageLimit, ErrTimelineImportDuration, ErrTimelineInvalid, ErrTimelineInUse, ErrSubtitleInvalid, ActivitySubtitle,
		ErrVoiceInUse, ErrVoiceReferenced, ErrCharacterInvalid,
		ErrOmniReferenceRequired, ErrReferenceTextRequired, ErrXTTSReferenceDuration,
		ErrVoiceDescriptionRequired, ErrOmniAttributes, ErrSpeakerInvalid,
		ActivityDownload, ActivityDownloading, ActivityVerifying,
		ActivityRuntimeDownload, ActivityRuntimeExtract, ActivityEngineStart,
		ActivityGenerate, ActivitySynthesizing, ActivitySavingAudio, ActivityRendering,
		ActivityCompleted, ActivityCancelled, ActivityPaused, ActivityFailed, ActivityInterrupted, ActivityRelocate, ActivityPlanMelody, ActivityTranscribe, ActivitySeparateVocals, ActivityAlignLyrics,
		ErrBusy, ErrProxyURL, ErrModelDirAbsolute, ErrModelDirSpace,
		ErrDownloadHTTP, ErrDownloadRange, ErrDownloadSize, ErrDownloadIncomplete,
		ErrDownloadStale, ErrDownloadChecksum, ErrDownloadOversized,
		ErrGenerateFailed, ErrParamsOutOfRange, ErrStateSaveFailed, ErrStateCorrupt,
		ErrAudioPathInvalid, ErrAudioPathSymlink, ErrAudioMissing, ErrAudioKindInvalid, ErrAudioIDInvalid,
		ErrAudioTooLarge, ErrAudioDuration, ErrAudioFormat, ErrAudioDecode, ErrAudioConverterMissing,
		ErrNameLength, ErrDraftLimits, ErrDraftIDInvalid, ErrTextRequired, ErrTitleLength,
		ErrLanguageUnsupported, ErrModeInvalid, ErrEmotionInvalid, ErrEmotionStrength,
		ErrEmotionTextRequired, ErrEmotionVoiceRequired, ErrVoiceRequired, ErrVoiceBusyDelete,
		ErrModelRequired, ErrModelUnsupported, ErrModelMoved, ErrModelForgetBlocked,
		ErrDownloadSource, ErrRuntimeRequired, ErrRuntimeMissing, ErrRuntimeUnique,
		ErrRuntimeArchivePath, ErrRuntimeArchiveLink, ErrRuntimeArchiveSize,
		ErrEngineStartFailed, ErrEngineStartTimeout, ErrEngineNoAudio, ErrEngineCrashed,
		ErrCPUBundleInvalid, ErrBackendUnsupported, ErrPlatformArch, ErrMacBackend, ErrMacAppleSilicon,
		ErrRequestInvalid, ErrMethodUnsupported,
		ErrVoxModeInvalid, ErrVoxTextLimits, ErrVoxReferenceRequired, ErrVoxParams,
		ErrMusicStyle, ErrMusicLyrics, ErrMusicParams, ErrMusicLyricsRequired, ErrMusicSourceRequired, ErrEngineUpgradeRequired, ErrScoreInvalid, ErrScoreTooLong, ErrMidiInvalid, ErrMelodyInvalid, ErrMelodyEmpty, ErrCoverModelRequired, ErrMelodySoundFontRequired, ErrAlignModelRequired, ErrAlignLyrics, ErrAlignEmpty,
		ErrAIProviderInvalid, ErrAINotConfigured, ErrAIAuth, ErrAIRateLimit, ErrAINetwork, ErrAIResponse, ErrAIModelsPath, ErrAIResultInvalid, ErrAITimeout, ErrAssistantMissing, ErrAssistantProvider,
		ErrAIFreeRate, ErrAIFreeBusy, ErrAIFreePromptCap, ErrAIFreeAccess, ErrCodexMissing, ErrCodexLoggedOut, ErrCodexFailed, ErrCodexLimit, ErrCodexNoImage,
		ErrLocalAPIPort, ErrLocalAPIPortInUse,
		ErrStorageInsideApp, ErrStorageTargetNotEmpty, ErrStorageSame, ErrStorageInsideData, ErrStorageRestart, ErrDataRootMissing, ErrDiskFull,
		ErrLegacyRestore, ErrUnknown,
	}
}
