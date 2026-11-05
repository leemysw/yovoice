// Package schema 定义持久化的作品、角色、素材与偏好结构，以及与存储无关的校验规则。
package schema

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"
	"yovoice/internal/msg"
)

func NewID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b[:])
}
func ValidID(id string) bool { b, e := hex.DecodeString(id); return e == nil && len(b) == 16 }

type SynthesisSettings struct {
	ModelOptions      map[string]map[string]any `json:"modelOptions,omitempty"`
	Speaker           string                    `json:"speaker,omitempty"`
	SynthesisLanguage string                    `json:"synthesisLanguage,omitempty"`
	OmniSpeed         float64                   `json:"omniSpeed,omitempty"`
	// 音乐作品中 Text 是风格描述，歌词单独保存；纯音乐时保留歌词但不演唱。
	Lyrics       string `json:"lyrics,omitempty"`
	Instrumental bool   `json:"instrumental,omitempty"`
	// Abc 是 YuE2 的旋律谱（受限 ABC 方言）：有谱时按谱演唱，随版本快照一起保存。
	Abc string `json:"abc,omitempty"`
	// SourceGenerationID 是 Stable Audio 改编（edit 选项）时作为起点的版本，必须是同一作品已生成的音频。
	SourceGenerationID string `json:"sourceGenerationId,omitempty"`

	VoiceMode         string    `json:"voiceMode"`
	VoxMode           string    `json:"voxMode"`
	VoiceDescription  string    `json:"voiceDescription"`
	ReferenceText     string    `json:"referenceText"`
	GuidanceScale     float64   `json:"guidanceScale"`
	InferenceSteps    int       `json:"inferenceSteps"`
	ModelID           string    `json:"modelId"`
	VoiceID           *string   `json:"voiceId"`
	Mode              string    `json:"mode"`
	EmotionVoiceID    *string   `json:"emotionVoiceId"`
	EmotionText       string    `json:"emotionText"`
	InferEmotion      bool      `json:"inferEmotion"`
	EmotionStrength   float64   `json:"emotionStrength"`
	Emotions          []float64 `json:"emotions"`
	RandomEmotion     bool      `json:"randomEmotion"`
	Language          string    `json:"language"`
	Speed             float64   `json:"speed"`
	Temperature       float64   `json:"temperature"`
	TopP              float64   `json:"topP"`
	TopK              int       `json:"topK"`
	RepetitionPenalty float64   `json:"repetitionPenalty"`
	MaxTokens         int       `json:"maxTokens"`
	IntervalSilenceMs int       `json:"intervalSilenceMs"`
	DoSample          bool      `json:"doSample"`
	NumBeams          int       `json:"numBeams"`
	LengthPenalty     float64   `json:"lengthPenalty"`
	Seed              *int      `json:"seed"`
}

type SubtitleSpeaker struct {
	ID          string             `json:"id"`
	SourceName  string             `json:"sourceName"`
	CharacterID string             `json:"characterId,omitempty"`
	Settings    *SynthesisSettings `json:"settings,omitempty"`
}
type CharacterPerformance struct {
	ID       string            `json:"id"`
	Name     string            `json:"name"`
	Settings SynthesisSettings `json:"settings"`
}

type SubtitleCue struct {
	Performance *CharacterPerformance `json:"performance,omitempty"`
	ID          string                `json:"id,omitempty"`
	Start       int64                 `json:"start"`
	End         int64                 `json:"end"`
	Text        string                `json:"text"`
	SpeakerID   string                `json:"speakerId"`
}
type SubtitleDocument struct {
	Speakers []SubtitleSpeaker `json:"speakers"`
	Cues     []SubtitleCue     `json:"cues"`
}
type AudioClip struct {
	GainDB       float64 `json:"gainDb,omitempty"`
	FadeIn       float64 `json:"fadeIn,omitempty"`
	FadeOut      float64 `json:"fadeOut,omitempty"`
	ID           string  `json:"id"`
	GenerationID string  `json:"generationId,omitempty"`
	AssetID      string  `json:"assetId,omitempty"`
	Start        float64 `json:"start"`
	Offset       float64 `json:"offset"`
	Duration     float64 `json:"duration"`
}
type AudioLane struct {
	Solo   bool        `json:"solo,omitempty"`
	Locked bool        `json:"locked,omitempty"`
	GainDB float64     `json:"gainDb,omitempty"`
	DuckDB float64     `json:"duckDb,omitempty"`
	ID     string      `json:"id"`
	Name   string      `json:"name"`
	Muted  bool        `json:"muted"`
	Clips  []AudioClip `json:"clips"`
}
type AudioAsset struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	FileName string  `json:"fileName"`
	Duration float64 `json:"duration"`
}
type AudioMarker struct {
	ID   string  `json:"id"`
	Time float64 `json:"time"`
	Name string  `json:"name"`
}
type AudioTimeline struct {
	Markers             []AudioMarker `json:"markers,omitempty"`
	RegenerateMode      string        `json:"regenerateMode,omitempty"`
	Assets              []AudioAsset  `json:"assets,omitempty"`
	Tracks              []AudioLane   `json:"tracks"`
	AcceptedGenerations []string      `json:"acceptedGenerations,omitempty"`
}
type Draft struct {
	Performance *CharacterPerformance `json:"performance,omitempty"`
	SynthesisSettings
	Kind        string            `json:"kind,omitempty"`
	CharacterID string            `json:"characterId,omitempty"`
	CreatedAt   *time.Time        `json:"createdAt,omitempty"`
	UpdatedAt   *time.Time        `json:"updatedAt,omitempty"`
	ID          string            `json:"id"`
	Title       string            `json:"title"`
	Text        string            `json:"text"`
	Subtitles   *SubtitleDocument `json:"subtitles,omitempty"`
	Timeline    *AudioTimeline    `json:"timeline,omitempty"`
	// Score 仅编曲作品使用，ModelID 指向渲染所用的音色库。
	Score *Score `json:"score,omitempty"`
}

func DefaultDraft() Draft {
	return Draft{ID: NewID(), Title: "清晨旁白", Text: "清晨的阳光穿过窗帘，\n房间渐渐明亮起来。\n\n给自己倒一杯热茶，\n让思绪在片刻的安静里慢下来。\n\n今天，我们从一个好声音开始。", SynthesisSettings: SynthesisSettings{ModelID: "index-2.5-q8", Mode: "text", EmotionText: "温柔、平静，像是在和熟悉的人说话。", EmotionStrength: .6, Emotions: []float64{0, 0, 0, 0, 0, 0, 0, .5}, Language: "zh", Speed: 1, Temperature: .8, TopP: .8, TopK: 30, RepetitionPenalty: 10, MaxTokens: 1500, IntervalSilenceMs: 200, DoSample: true, NumBeams: 3}}
}

type CharacterPreview struct {
	ID       string            `json:"id"`
	FileName string            `json:"fileName"`
	Duration float64           `json:"duration"`
	Settings SynthesisSettings `json:"settings"`
	Text     string            `json:"text"`
}

type Character struct {
	Performances []CharacterPerformance `json:"performances,omitempty"`
	ID           string                 `json:"id"`
	Name         string                 `json:"name"`
	Settings     SynthesisSettings      `json:"settings"`
	DemoText     string                 `json:"demoText"`
	Preview      *CharacterPreview      `json:"preview,omitempty"`
	CreatedAt    time.Time              `json:"createdAt"`
	UpdatedAt    time.Time              `json:"updatedAt"`
}

type Voice struct {
	ReferenceText      string  `json:"referenceText,omitempty"`
	Source             string  `json:"source,omitempty"`
	SourceGenerationID string  `json:"sourceGenerationId,omitempty"`
	ID                 string  `json:"id"`
	Name               string  `json:"name"`
	FileName           string  `json:"fileName"`
	Duration           float64 `json:"duration"`
	// Excerpt 记录导入的录音过长时自动截取的片段。
	Excerpt *VoiceExcerpt `json:"excerpt,omitempty"`
}

// VoiceExcerpt 是从较长录音里自动挑出的参考片段：Start/End 为片段在原录音里的秒数，Total 为原录音时长。
type VoiceExcerpt struct {
	Start float64 `json:"start"`
	End   float64 `json:"end"`
	Total float64 `json:"total"`
}
type InstalledModel struct {
	ID      string `json:"id"`
	Path    string `json:"path"`
	Managed bool   `json:"managed"`
	SHA256  string `json:"sha256,omitempty"`
}
type Generation struct {
	ID        string             `json:"id"`
	Title     string             `json:"title"`
	FileName  string             `json:"fileName"`
	CreatedAt time.Time          `json:"createdAt"`
	Duration  float64            `json:"duration"`
	Settings  Draft              `json:"settings"`
	Segment   *GenerationSegment `json:"segment,omitempty"`
	// LyricTimes 是播放页校准的歌词时间：按顺序记录每一行（含器乐段落）的开始秒数。
	LyricTimes []float64 `json:"lyricTimes,omitempty"`
	// LyricWords 是强制对齐得到的逐字时间，按歌词顺序排列；与 LyricTimes 只保留较新的一份。
	LyricWords []LyricWord `json:"lyricWords,omitempty"`
	// TextWords 是语音版本的正文对齐到音频上的逐字时间，用于导出字幕；歌曲、音效与编曲版本没有。
	TextWords []LyricWord `json:"textWords,omitempty"`
	// Check 是生成后对音频的测量体检；导入旧版本或文件丢失时为空。
	Check *AudioCheck `json:"check,omitempty"`
	// StemOf 是分轨结果出自的版本 ID，Stem 是分轨名（drums、bass、other、vocals、guitar、piano）；普通版本为空。
	StemOf string `json:"stemOf,omitempty"`
	Stem   string `json:"stem,omitempty"`
}

// AudioCheck 是不用模型的音频体检：整体响度、真峰值与发现的问题。
type AudioCheck struct {
	Loudness float64      `json:"loudness"` // LUFS，静音为 -70
	Peak     float64      `json:"peak"`     // 真峰值 dBTP
	Issues   []AudioIssue `json:"issues,omitempty"`
}

// AudioIssue 是体检发现的一处问题，At/End 为秒。Code：
// clipping 削波（爆音），clicks 咔哒声，cutoff 结尾被截断，silence 长时间静音，silent 整段几乎无声，quiet 音量过小，dc 直流偏移。
type AudioIssue struct {
	Code  string  `json:"code"`
	At    float64 `json:"at"`
	End   float64 `json:"end,omitempty"`
	Count int     `json:"count,omitempty"`
}

// LyricWord 是对齐到音频上的一个字（拉丁文为一个词），时间以秒计。
type LyricWord struct {
	Word  string  `json:"word"`
	Start float64 `json:"start"`
	End   float64 `json:"end"`
}

// GenerationSegment 保留单句来源；剪辑与原音频通过生成版本关联。
type GenerationSegment struct {
	Placement    string `json:"placement,omitempty"`
	CueID        string `json:"cueId"`
	SpeakerID    string `json:"speakerId"`
	SpeakerName  string `json:"speakerName"`
	BatchID      string `json:"batchId"`
	Index        int    `json:"index"`
	TargetClipID string `json:"targetClipId,omitempty"`
}
type Activity struct {
	CueID       string `json:"cueId,omitempty"`
	ProjectID   string `json:"projectId,omitempty"`
	CharacterID string `json:"characterId,omitempty"`
	RequestID   string `json:"requestId,omitempty"`
	Kind        string `json:"kind"`
	// Task 区分同一类操作里的具体任务：melody 为出谱或扒谱，界面据此在旋律谱区域显示进度；align 为歌词对齐，在播放页显示；
	// recognize 为识别声音样本的参考文本，在参考文本输入框旁显示；transcribe 为转写页转写音频；caption 为给语音版本对齐字幕时间。
	Task        string     `json:"task,omitempty"`
	Code        msg.Code   `json:"code"`
	Params      msg.Params `json:"params"`
	Status      string     `json:"status"`
	Received    int64      `json:"received"`
	Total       int64      `json:"total"`
	ErrorCode   *msg.Code  `json:"errorCode"`
	ErrorParams msg.Params `json:"errorParams"`
	ModelID     *string    `json:"modelId"`
	StartedAt   time.Time  `json:"startedAt"`
}

// UiLocale is the persisted interface language. Distinct from Draft.Language (TTS).
type UiLocale string

const (
	UiLocaleZhCN UiLocale = "zh-CN"
	UiLocaleEn   UiLocale = "en"
)

// UiLocaleNames 列出支持的界面语言及其英文名（写进 AI 提示词），与 web/src/shared/i18n/locale.ts 一致。
var UiLocaleNames = map[UiLocale]string{
	UiLocaleZhCN: "Simplified Chinese",
	"zh-TW":      "Traditional Chinese",
	UiLocaleEn:   "English",
	"ja":         "Japanese",
	"ko":         "Korean",
	"es":         "Spanish",
	"fr":         "French",
	"de":         "German",
	"pt-BR":      "Brazilian Portuguese",
	"ru":         "Russian",
	"it":         "Italian",
	"vi":         "Vietnamese",
}

func ParseUiLocale(raw string) (UiLocale, error) {
	if _, ok := UiLocaleNames[UiLocale(raw)]; !ok {
		return "", fmt.Errorf("unsupported uiLocale %q", raw)
	}
	return UiLocale(raw), nil
}

type Preferences struct {
	ProxyURL       string `json:"proxyURL,omitempty"`
	ProxyEnabled   *bool  `json:"proxyEnabled,omitempty"`
	DownloadSource string `json:"downloadSource"`
	Backend        string `json:"backend"`
	// PerformanceFirst 在支持的 CUDA 模型上启用高性能会话模式，以更多显存换取生成速度。
	PerformanceFirst bool     `json:"performanceFirst,omitempty"`
	ModelDirectory   *string  `json:"modelDirectory"`
	UiLocale         UiLocale `json:"uiLocale"`
	// AITimeout 是单次 AI 请求的超时秒数，0 表示默认值。
	AITimeout int `json:"aiTimeout,omitempty"`
	// IntroSeen 表示已看过首次启动的开场画面，之后启动只显示简短的加载动画。
	IntroSeen bool `json:"introSeen,omitempty"`
	// TourSeen 表示已看过或跳过首次进入主界面的功能引导。
	TourSeen bool `json:"tourSeen,omitempty"`
	// AssistantQuiet 关闭助手的主动提示（生成完成、失败等时刻在角落出现的气泡）。
	AssistantQuiet bool `json:"assistantQuiet,omitempty"`
	// HiddenFeatures 是在设置中隐藏的功能入口（见 OptionalFeatures），为空时全部显示。
	HiddenFeatures []string `json:"hiddenFeatures,omitempty"`
}

// OptionalFeatures 是可在设置中隐藏的功能：故事配音、音乐生成（含编曲）与 Ocho 助手。
var OptionalFeatures = []string{"story", "music", "assistant"}

type State struct {
	Characters     []Character        `json:"characters"`
	Previews       []CharacterPreview `json:"previews"`
	Drafts         []Draft            `json:"drafts"`
	Voices         []Voice            `json:"voices"`
	Models         []InstalledModel   `json:"models"`
	History        []Generation       `json:"history"`
	Preferences    Preferences        `json:"preferences"`
	RuntimePath    *string            `json:"runtimePath"`
	RuntimeBackend *string            `json:"runtimeBackend"`
	RuntimeVersion *string            `json:"runtimeVersion"`
	// Runtimes 按后端记录下载安装的内核，切换计算设备后再切回时直接复用。
	Runtimes map[string]InstalledRuntime `json:"runtimes,omitempty"`
	Activity *Activity                   `json:"activity"`
	// ModelActivity 是模型下载或导入：不占用推理引擎，与 Activity 中的生成等操作同时进行。
	ModelActivity *Activity `json:"modelActivity"`
	// AIProviders 为可选的大模型服务，AIProviderID 指向当前使用的服务。
	AIProviders  []AIProvider `json:"aiProviders,omitempty"`
	AIProviderID string       `json:"aiProviderID,omitempty"`
	AITask       *AITask      `json:"aiTask,omitempty"`
	// Melody 是最近一次出谱或扒谱的结果，等界面填入作品；只属于本次会话。
	Melody *MelodyResult `json:"melody,omitempty"`
	// MidiImport 是最近一次从版本扒出 MIDI 新建的编曲作品，等界面打开；只属于本次会话。
	MidiImport *MidiImport `json:"midiImport,omitempty"`
	// Transcript 是最近一次识别的结果：声音样本的参考文本，或转写页上传音频的文字与逐词时间；只属于本次会话。
	Transcript *TranscriptResult `json:"transcript,omitempty"`
	// AssistantSessions 是助手会话的持久化记录；AssistantLive 只随状态广播（进行中的一轮与界面事件）。
	AssistantSessions *AssistantSessions `json:"assistantSessions,omitempty"`
	AssistantLive     *AssistantLive     `json:"assistantLive,omitempty"`
	// AssistantMemory 是助手记住的用户偏好，所有会话共用。
	AssistantMemory []AssistantMemo `json:"assistantMemory,omitempty"`
}

// MidiImport 记录扒 MIDI 新建的编曲作品：ProjectID 是新作品，SourceID 是来源版本。
type MidiImport struct {
	ID        string `json:"id"`
	ProjectID string `json:"projectId"`
	SourceID  string `json:"sourceId"`
}

// MelodyResult 是引擎写出的旋律谱：Source 为 plan（YuE2 按歌词出谱）或 cover（从歌曲扒谱）。
type MelodyResult struct {
	ID        string    `json:"id"`
	ProjectID string    `json:"projectId"`
	Source    string    `json:"source"`
	Abc       string    `json:"abc"`
	Truncated bool      `json:"truncated,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

// TranscriptResult 是语音识别模型识别出的文字；Language 是模型判断的语言（如 Chinese），可能为空。
// 识别声音样本时 VoiceID 指向样本；转写上传的音频时 Name 是文件名（不含扩展名），Words 是逐词时间，Duration 是音频秒数。
type TranscriptResult struct {
	ID        string      `json:"id"`
	VoiceID   string      `json:"voiceId,omitempty"`
	Name      string      `json:"name,omitempty"`
	Text      string      `json:"text"`
	Language  string      `json:"language,omitempty"`
	Words     []LyricWord `json:"words,omitempty"`
	Duration  float64     `json:"duration,omitempty"`
	CreatedAt time.Time   `json:"createdAt"`
}

type InstalledRuntime struct {
	Path    string `json:"path"`
	Version string `json:"version"`
}

func DefaultState() State {
	return State{Characters: []Character{}, Previews: []CharacterPreview{}, Drafts: []Draft{DefaultDraft()}, Voices: []Voice{}, Models: []InstalledModel{}, History: []Generation{}, Preferences: Preferences{DownloadSource: "modelscope", Backend: "cpu"}}
}
