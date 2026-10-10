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
}
type InstalledModel struct {
	ID      string `json:"id"`
	Path    string `json:"path"`
	Managed bool   `json:"managed"`
}
type Generation struct {
	ID        string             `json:"id"`
	Title     string             `json:"title"`
	FileName  string             `json:"fileName"`
	CreatedAt time.Time          `json:"createdAt"`
	Duration  float64            `json:"duration"`
	Settings  Draft              `json:"settings"`
	Segment   *GenerationSegment `json:"segment,omitempty"`
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
	CueID       string     `json:"cueId,omitempty"`
	ProjectID   string     `json:"projectId,omitempty"`
	CharacterID string     `json:"characterId,omitempty"`
	RequestID   string     `json:"requestId,omitempty"`
	Kind        string     `json:"kind"`
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

func ParseUiLocale(raw string) (UiLocale, error) {
	switch UiLocale(raw) {
	case UiLocaleZhCN, UiLocaleEn:
		return UiLocale(raw), nil
	default:
		return "", fmt.Errorf("unsupported uiLocale %q", raw)
	}
}

type Preferences struct {
	ProxyURL       string   `json:"proxyURL,omitempty"`
	ProxyEnabled   *bool    `json:"proxyEnabled,omitempty"`
	DownloadSource string   `json:"downloadSource"`
	Backend        string   `json:"backend"`
	ModelDirectory *string  `json:"modelDirectory"`
	UiLocale       UiLocale `json:"uiLocale"`
}
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
	Activity       *Activity          `json:"activity"`
}

func DefaultState() State {
	return State{Characters: []Character{}, Previews: []CharacterPreview{}, Drafts: []Draft{DefaultDraft()}, Voices: []Voice{}, Models: []InstalledModel{}, History: []Generation{}, Preferences: Preferences{DownloadSource: "modelscope", Backend: "cpu"}}
}
