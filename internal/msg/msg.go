// Package msg 定义界面可翻译的稳定消息码与结构化调用错误。
package msg

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

	ErrModelImportRequired      Code = "@yovoice.error.modelImportRequired"
	ErrOmniReferenceRequired    Code = "@yovoice.error.omniReferenceRequired"
	ErrVoiceDescriptionRequired Code = "@yovoice.error.voiceDescriptionRequired"
	ErrOmniAttributes           Code = "@yovoice.error.omniAttributes"
	ErrSpeakerInvalid           Code = "@yovoice.error.speakerInvalid"
)

const (
	ActivityDownload        Code = "@yovoice.activity.download"
	ActivityDownloading     Code = "@yovoice.activity.downloading"
	ActivityVerifying       Code = "@yovoice.activity.verifying"
	ActivityImport          Code = "@yovoice.activity.import"
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
	ErrModelImportNone       Code = "@yovoice.error.modelImportNone"
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
	ErrScoreInvalid          Code = "@yovoice.error.scoreInvalid"
	ErrMidiInvalid           Code = "@yovoice.error.midiInvalid"
	ErrEngineUpgradeRequired Code = "@yovoice.error.engineUpgradeRequired"
	ErrUnknown               Code = "@yovoice.error.unknown"
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
	if ce, ok := err.(*CallError); ok && ce != nil {
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
		ErrModelImportRequired,
		ErrOmniReferenceRequired,
		ErrVoiceDescriptionRequired, ErrOmniAttributes, ErrSpeakerInvalid,
		ActivityDownload, ActivityDownloading, ActivityVerifying, ActivityImport,
		ActivityRuntimeDownload, ActivityRuntimeExtract, ActivityEngineStart,
		ActivityGenerate, ActivitySynthesizing, ActivitySavingAudio, ActivityRendering,
		ActivityCompleted, ActivityCancelled, ActivityPaused, ActivityFailed, ActivityInterrupted,
		ErrBusy, ErrProxyURL, ErrModelDirAbsolute, ErrModelDirSpace,
		ErrDownloadHTTP, ErrDownloadRange, ErrDownloadSize, ErrDownloadIncomplete,
		ErrDownloadStale, ErrDownloadChecksum, ErrDownloadOversized,
		ErrGenerateFailed, ErrParamsOutOfRange, ErrStateSaveFailed, ErrStateCorrupt,
		ErrAudioPathInvalid, ErrAudioPathSymlink, ErrAudioMissing, ErrAudioKindInvalid, ErrAudioIDInvalid,
		ErrAudioTooLarge, ErrAudioDuration, ErrAudioFormat, ErrAudioDecode, ErrAudioConverterMissing,
		ErrNameLength, ErrDraftLimits, ErrDraftIDInvalid, ErrTextRequired, ErrTitleLength,
		ErrLanguageUnsupported, ErrModeInvalid, ErrEmotionInvalid, ErrEmotionStrength,
		ErrEmotionTextRequired, ErrEmotionVoiceRequired, ErrVoiceRequired, ErrVoiceBusyDelete,
		ErrModelRequired, ErrModelUnsupported, ErrModelMoved, ErrModelImportNone, ErrModelForgetBlocked,
		ErrDownloadSource, ErrRuntimeRequired, ErrRuntimeMissing, ErrRuntimeUnique,
		ErrRuntimeArchivePath, ErrRuntimeArchiveLink, ErrRuntimeArchiveSize,
		ErrEngineStartFailed, ErrEngineStartTimeout, ErrEngineNoAudio,
		ErrCPUBundleInvalid, ErrBackendUnsupported, ErrPlatformArch, ErrMacBackend, ErrMacAppleSilicon,
		ErrRequestInvalid, ErrMethodUnsupported,
		ErrVoxModeInvalid, ErrVoxTextLimits, ErrVoxReferenceRequired, ErrVoxParams,
		ErrMusicStyle, ErrMusicLyrics, ErrMusicParams, ErrEngineUpgradeRequired, ErrScoreInvalid, ErrMidiInvalid,
		ErrLegacyRestore, ErrUnknown,
	}
}
