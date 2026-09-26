package workbench

// MessageCode is a stable catalog key. Spelling matches web @yovoice.* entries.
type MessageCode string

const (
	MsgErrVoiceInUse       MessageCode = "@yovoice.error.voiceInUse"
	MsgErrCharacterInvalid MessageCode = "@yovoice.error.characterInvalid"

	MsgErrModelImportRequired      MessageCode = "@yovoice.error.modelImportRequired"
	MsgErrOmniReferenceRequired    MessageCode = "@yovoice.error.omniReferenceRequired"
	MsgErrVoiceDescriptionRequired MessageCode = "@yovoice.error.voiceDescriptionRequired"
	MsgErrOmniAttributes           MessageCode = "@yovoice.error.omniAttributes"
	MsgErrSpeakerInvalid           MessageCode = "@yovoice.error.speakerInvalid"
)

const (
	MsgActivityDownload        MessageCode = "@yovoice.activity.download"
	MsgActivityDownloading     MessageCode = "@yovoice.activity.downloading"
	MsgActivityVerifying       MessageCode = "@yovoice.activity.verifying"
	MsgActivityImport          MessageCode = "@yovoice.activity.import"
	MsgActivityRuntimeDownload MessageCode = "@yovoice.activity.runtimeDownload"
	MsgActivityRuntimeExtract  MessageCode = "@yovoice.activity.runtimeExtract"
	MsgActivityEngineStart     MessageCode = "@yovoice.activity.engineStart"
	MsgActivityGenerate        MessageCode = "@yovoice.activity.generate"
	MsgActivitySynthesizing    MessageCode = "@yovoice.activity.synthesizing"
	MsgActivitySavingAudio     MessageCode = "@yovoice.activity.savingAudio"
	MsgActivityCompleted       MessageCode = "@yovoice.activity.completed"
	MsgActivityCancelled       MessageCode = "@yovoice.activity.cancelled"
	MsgActivityPaused          MessageCode = "@yovoice.activity.paused"
	MsgActivityFailed          MessageCode = "@yovoice.activity.failed"
	MsgActivityInterrupted     MessageCode = "@yovoice.activity.interrupted"

	MsgErrBusy                  MessageCode = "@yovoice.error.busy"
	MsgErrProxyURL              MessageCode = "@yovoice.error.proxyURL"
	MsgErrModelDirAbsolute      MessageCode = "@yovoice.error.modelDirAbsolute"
	MsgErrModelDirSpace         MessageCode = "@yovoice.error.modelDirSpace"
	MsgErrDownloadHTTP          MessageCode = "@yovoice.error.downloadHTTP"
	MsgErrDownloadRange         MessageCode = "@yovoice.error.downloadRange"
	MsgErrDownloadSize          MessageCode = "@yovoice.error.downloadSize"
	MsgErrDownloadIncomplete    MessageCode = "@yovoice.error.downloadIncomplete"
	MsgErrDownloadStale         MessageCode = "@yovoice.error.downloadStale"
	MsgErrDownloadChecksum      MessageCode = "@yovoice.error.downloadChecksum"
	MsgErrDownloadOversized     MessageCode = "@yovoice.error.downloadOversized"
	MsgErrGenerateFailed        MessageCode = "@yovoice.error.generateFailed"
	MsgErrParamsOutOfRange      MessageCode = "@yovoice.error.paramsOutOfRange"
	MsgErrStateSaveFailed       MessageCode = "@yovoice.error.stateSaveFailed"
	MsgErrStateCorrupt          MessageCode = "@yovoice.error.stateCorrupt"
	MsgErrAudioPathInvalid      MessageCode = "@yovoice.error.audioPathInvalid"
	MsgErrAudioPathSymlink      MessageCode = "@yovoice.error.audioPathSymlink"
	MsgErrAudioMissing          MessageCode = "@yovoice.error.audioMissing"
	MsgErrAudioKindInvalid      MessageCode = "@yovoice.error.audioKindInvalid"
	MsgErrAudioIDInvalid        MessageCode = "@yovoice.error.audioIDInvalid"
	MsgErrAudioTooLarge         MessageCode = "@yovoice.error.audioTooLarge"
	MsgErrAudioDuration         MessageCode = "@yovoice.error.audioDuration"
	MsgErrAudioFormat           MessageCode = "@yovoice.error.audioFormat"
	MsgErrAudioDecode           MessageCode = "@yovoice.error.audioDecode"
	MsgErrAudioConverterMissing MessageCode = "@yovoice.error.audioConverterMissing"
	MsgErrNameLength            MessageCode = "@yovoice.error.nameLength"
	MsgErrDraftLimits           MessageCode = "@yovoice.error.draftLimits"
	MsgErrDraftIDInvalid        MessageCode = "@yovoice.error.draftIDInvalid"
	MsgErrTextRequired          MessageCode = "@yovoice.error.textRequired"
	MsgErrTitleLength           MessageCode = "@yovoice.error.titleLength"
	MsgErrLanguageUnsupported   MessageCode = "@yovoice.error.languageUnsupported"
	MsgErrModeInvalid           MessageCode = "@yovoice.error.modeInvalid"
	MsgErrEmotionInvalid        MessageCode = "@yovoice.error.emotionInvalid"
	MsgErrEmotionStrength       MessageCode = "@yovoice.error.emotionStrength"
	MsgErrEmotionTextRequired   MessageCode = "@yovoice.error.emotionTextRequired"
	MsgErrEmotionVoiceRequired  MessageCode = "@yovoice.error.emotionVoiceRequired"
	MsgErrVoiceRequired         MessageCode = "@yovoice.error.voiceRequired"
	MsgErrVoiceBusyDelete       MessageCode = "@yovoice.error.voiceBusyDelete"
	MsgErrModelRequired         MessageCode = "@yovoice.error.modelRequired"
	MsgErrModelUnsupported      MessageCode = "@yovoice.error.modelUnsupported"
	MsgErrModelMoved            MessageCode = "@yovoice.error.modelMoved"
	MsgErrModelImportNone       MessageCode = "@yovoice.error.modelImportNone"
	MsgErrModelForgetBlocked    MessageCode = "@yovoice.error.modelForgetBlocked"
	MsgErrDownloadSource        MessageCode = "@yovoice.error.downloadSource"
	MsgErrRuntimeRequired       MessageCode = "@yovoice.error.runtimeRequired"
	MsgErrRuntimeMissing        MessageCode = "@yovoice.error.runtimeMissing"
	MsgErrRuntimeUnique         MessageCode = "@yovoice.error.runtimeUnique"
	MsgErrRuntimeArchivePath    MessageCode = "@yovoice.error.runtimeArchivePath"
	MsgErrRuntimeArchiveLink    MessageCode = "@yovoice.error.runtimeArchiveLink"
	MsgErrRuntimeArchiveSize    MessageCode = "@yovoice.error.runtimeArchiveSize"
	MsgErrEngineStartFailed     MessageCode = "@yovoice.error.engineStartFailed"
	MsgErrEngineStartTimeout    MessageCode = "@yovoice.error.engineStartTimeout"
	MsgErrEngineNoAudio         MessageCode = "@yovoice.error.engineNoAudio"
	MsgErrCPUBundleInvalid      MessageCode = "@yovoice.error.cpuBundleInvalid"
	MsgErrBackendUnsupported    MessageCode = "@yovoice.error.backendUnsupported"
	MsgErrPlatformArch          MessageCode = "@yovoice.error.platformArch"
	MsgErrMacBackend            MessageCode = "@yovoice.error.macBackend"
	MsgErrMacAppleSilicon       MessageCode = "@yovoice.error.macAppleSilicon"
	MsgErrRequestInvalid        MessageCode = "@yovoice.error.requestInvalid"
	MsgErrMethodUnsupported     MessageCode = "@yovoice.error.methodUnsupported"
	MsgErrVoxModeInvalid        MessageCode = "@yovoice.error.voxModeInvalid"
	MsgErrVoxTextLimits         MessageCode = "@yovoice.error.voxTextLimits"
	MsgErrVoxReferenceRequired  MessageCode = "@yovoice.error.voxReferenceRequired"
	MsgErrVoxParams             MessageCode = "@yovoice.error.voxParams"
	MsgErrLegacyRestore         MessageCode = "@yovoice.error.legacyRestore"
	MsgErrUnknown               MessageCode = "@yovoice.error.unknown"
)

// MessageParams carries ICU values. Keys match catalog placeholders.
type MessageParams map[string]any

// CallError is the typed user-facing RPC error. Wire JSON: {"code","params"}.
type CallError struct {
	Code   MessageCode   `json:"code"`
	Params MessageParams `json:"params,omitempty"`
}

func (e *CallError) Error() string {
	if e == nil {
		return string(MsgErrUnknown)
	}
	return string(e.Code)
}

// Err builds a CallError for anything the UI shows.
func Err(code MessageCode, params MessageParams) *CallError {
	return &CallError{Code: code, Params: params}
}

func encodeCallError(err error) map[string]any {
	if ce, ok := err.(*CallError); ok && ce != nil {
		out := map[string]any{"code": ce.Code}
		if len(ce.Params) > 0 {
			out["params"] = ce.Params
		}
		return out
	}
	return map[string]any{"code": MsgErrUnknown, "params": MessageParams{"detail": err.Error()}}
}

// AllMessageCodes lists every MessageCode constant for catalog coverage checks.
func AllMessageCodes() []MessageCode {
	return []MessageCode{
		MsgErrVoiceInUse, MsgErrCharacterInvalid,
		MsgErrModelImportRequired,
		MsgErrOmniReferenceRequired,
		MsgErrVoiceDescriptionRequired, MsgErrOmniAttributes, MsgErrSpeakerInvalid,
		MsgActivityDownload, MsgActivityDownloading, MsgActivityVerifying, MsgActivityImport,
		MsgActivityRuntimeDownload, MsgActivityRuntimeExtract, MsgActivityEngineStart,
		MsgActivityGenerate, MsgActivitySynthesizing, MsgActivitySavingAudio,
		MsgActivityCompleted, MsgActivityCancelled, MsgActivityPaused, MsgActivityFailed, MsgActivityInterrupted,
		MsgErrBusy, MsgErrProxyURL, MsgErrModelDirAbsolute, MsgErrModelDirSpace,
		MsgErrDownloadHTTP, MsgErrDownloadRange, MsgErrDownloadSize, MsgErrDownloadIncomplete,
		MsgErrDownloadStale, MsgErrDownloadChecksum, MsgErrDownloadOversized,
		MsgErrGenerateFailed, MsgErrParamsOutOfRange, MsgErrStateSaveFailed, MsgErrStateCorrupt,
		MsgErrAudioPathInvalid, MsgErrAudioPathSymlink, MsgErrAudioMissing, MsgErrAudioKindInvalid, MsgErrAudioIDInvalid,
		MsgErrAudioTooLarge, MsgErrAudioDuration, MsgErrAudioFormat, MsgErrAudioDecode, MsgErrAudioConverterMissing,
		MsgErrNameLength, MsgErrDraftLimits, MsgErrDraftIDInvalid, MsgErrTextRequired, MsgErrTitleLength,
		MsgErrLanguageUnsupported, MsgErrModeInvalid, MsgErrEmotionInvalid, MsgErrEmotionStrength,
		MsgErrEmotionTextRequired, MsgErrEmotionVoiceRequired, MsgErrVoiceRequired, MsgErrVoiceBusyDelete,
		MsgErrModelRequired, MsgErrModelUnsupported, MsgErrModelMoved, MsgErrModelImportNone, MsgErrModelForgetBlocked,
		MsgErrDownloadSource, MsgErrRuntimeRequired, MsgErrRuntimeMissing, MsgErrRuntimeUnique,
		MsgErrRuntimeArchivePath, MsgErrRuntimeArchiveLink, MsgErrRuntimeArchiveSize,
		MsgErrEngineStartFailed, MsgErrEngineStartTimeout, MsgErrEngineNoAudio,
		MsgErrCPUBundleInvalid, MsgErrBackendUnsupported, MsgErrPlatformArch, MsgErrMacBackend, MsgErrMacAppleSilicon,
		MsgErrRequestInvalid, MsgErrMethodUnsupported,
		MsgErrVoxModeInvalid, MsgErrVoxTextLimits, MsgErrVoxReferenceRequired, MsgErrVoxParams,
		MsgErrLegacyRestore, MsgErrUnknown,
	}
}
