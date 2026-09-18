package workbench

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"
)

func newID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b[:])
}
func validID(id string) bool { b, e := hex.DecodeString(id); return e == nil && len(b) == 16 }
func ptr(s string) *string   { return &s }
func value(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

type Draft struct {
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
	ID                string    `json:"id"`
	Title             string    `json:"title"`
	Text              string    `json:"text"`
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

func DefaultDraft() Draft {
	return Draft{ID: newID(), Title: "清晨旁白", Text: "清晨的阳光穿过窗帘，\n房间渐渐明亮起来。\n\n给自己倒一杯热茶，\n让思绪在片刻的安静里慢下来。\n\n今天，我们从一个好声音开始。", ModelID: "index-2.5-q8", Mode: "text", EmotionText: "温柔、平静，像是在和熟悉的人说话。", EmotionStrength: .6, Emotions: []float64{0, 0, 0, 0, 0, 0, 0, .5}, Language: "zh", Speed: 1, Temperature: .8, TopP: .8, TopK: 30, RepetitionPenalty: 10, MaxTokens: 1500, IntervalSilenceMs: 200, DoSample: true, NumBeams: 3}
}

type Voice struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	FileName string  `json:"fileName"`
	Duration float64 `json:"duration"`
}
type InstalledModel struct {
	ID      string `json:"id"`
	Path    string `json:"path"`
	Managed bool   `json:"managed"`
}
type Generation struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	FileName  string    `json:"fileName"`
	CreatedAt time.Time `json:"createdAt"`
	Duration  float64   `json:"duration"`
	Settings  Draft     `json:"settings"`
}
type Activity struct {
	Kind        string         `json:"kind"`
	Code        MessageCode    `json:"code"`
	Params      MessageParams  `json:"params"`
	Status      string         `json:"status"`
	Received    int64          `json:"received"`
	Total       int64          `json:"total"`
	ErrorCode   *MessageCode   `json:"errorCode"`
	ErrorParams MessageParams  `json:"errorParams"`
	ModelID     *string        `json:"modelId"`
	StartedAt   time.Time      `json:"startedAt"`
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
	DownloadSource string   `json:"downloadSource"`
	Backend        string   `json:"backend"`
	ModelDirectory *string  `json:"modelDirectory"`
	UiLocale       UiLocale `json:"uiLocale"`
}
type State struct {
	Drafts         []Draft          `json:"drafts"`
	Voices         []Voice          `json:"voices"`
	Models         []InstalledModel `json:"models"`
	History        []Generation     `json:"history"`
	Preferences    Preferences      `json:"preferences"`
	RuntimePath    *string          `json:"runtimePath"`
	RuntimeBackend *string          `json:"runtimeBackend"`
	Activity       *Activity        `json:"activity"`
}

func defaultState() State {
	return State{Drafts: []Draft{DefaultDraft()}, Voices: []Voice{}, Models: []InstalledModel{}, History: []Generation{}, Preferences: Preferences{DownloadSource: "modelscope", Backend: "cpu"}}
}
