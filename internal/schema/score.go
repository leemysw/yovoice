package schema

import (
	"fmt"
	"math"
	"slices"
	"strings"
	"yovoice/internal/catalog"
	"yovoice/internal/msg"
)

// Score 是编曲作品的乐谱：以小节和拍为单位，渲染、MIDI 互转和界面音块都读同一份数据。
type Score struct {
	Tempo         float64        `json:"tempo"`
	TimeSignature []int          `json:"timeSignature"`
	Key           string         `json:"key,omitempty"`
	Sections      []ScoreSection `json:"sections,omitempty"`
	Tracks        []ScoreTrack   `json:"tracks"`
}

// ScoreSection 是一个段落，Start/End 为首尾小节（从 1 开始，含 End）；Tempo 为空时沿用乐谱速度。
type ScoreSection struct {
	Name  string  `json:"name"`
	Start int     `json:"start"`
	End   int     `json:"end"`
	Tempo float64 `json:"tempo,omitempty"`
}

// ScoreTrack 是一个声部。Program 为 General MIDI 音色号（0–127），Drums 时使用鼓组。
// Level 是该声部“有声部分”的目标电平（dBFS），为 0 时按 Role 取默认值。
type ScoreTrack struct {
	ID       string      `json:"id"`
	Name     string      `json:"name"`
	Role     string      `json:"role,omitempty"`
	Program  int         `json:"program"`
	Drums    bool        `json:"drums,omitempty"`
	Level    float64     `json:"level,omitempty"`
	Pan      float64     `json:"pan,omitempty"`
	Reverb   float64     `json:"reverb,omitempty"`
	Mute     bool        `json:"mute,omitempty"`
	Humanize *Humanize   `json:"humanize,omitempty"`
	Dynamics []ScoreRamp `json:"dynamics,omitempty"`
	Notes    []ScoreNote `json:"notes"`
}

// Humanize 为每个音加入确定性的力度与时间微调，避免机器味；同一份乐谱每次渲染结果一致。
type Humanize struct {
	Velocity int     `json:"velocity,omitempty"`
	TimingMs float64 `json:"timingMs,omitempty"`
}

// ScoreRamp 在小节范围内把声部音量从 From 渐变到 To（0–1），用于渐强渐弱。
type ScoreRamp struct {
	Start int     `json:"start"`
	End   int     `json:"end"`
	From  float64 `json:"from"`
	To    float64 `json:"to"`
}

// ScoreNote 的 Beat 从 1 开始，可为小数；Length 以拍计。
type ScoreNote struct {
	Bar      int     `json:"bar"`
	Beat     float64 `json:"beat"`
	Pitch    int     `json:"pitch"`
	Length   float64 `json:"length"`
	Velocity int     `json:"velocity"`
}

const (
	ScoreMaxBars    = 512
	ScoreMaxTracks  = 32
	ScoreMaxNotes   = 20000
	ScoreMaxSeconds = 600
)

// ScoreRoles 与界面的声部分组一致；默认电平参考常见配乐混音：主奏在前，铺底和琶音退后。
var ScoreRoles = map[string]float64{
	"melody": -21, "piano": -21, "strings": -23, "bass": -25, "drums": -25, "pad": -29, "arp": -29, "other": -24,
}

func (t ScoreTrack) TargetLevel() float64 {
	if t.Level != 0 {
		return t.Level
	}
	if level, ok := ScoreRoles[t.Role]; ok {
		return level
	}
	return ScoreRoles["other"]
}

// BeatsPerBar 以四分音符为拍：6/8 记为 3 拍，便于速度统一按四分音符计算。
func (s Score) BeatsPerBar() float64 {
	return float64(s.TimeSignature[0]) * 4 / float64(s.TimeSignature[1])
}

// Bars 返回乐谱的小节数：取段落与音符的最大结束位置。
func (s Score) Bars() int {
	bars := 0
	for _, section := range s.Sections {
		bars = max(bars, section.End)
	}
	per := s.BeatsPerBar()
	for _, t := range s.Tracks {
		for _, n := range t.Notes {
			end := float64(n.Bar-1)*per + n.Beat - 1 + n.Length
			bars = max(bars, int(math.Ceil(end/per-1e-9)))
		}
	}
	return bars
}

// BarTempo 返回某小节的速度：落在设定速度的段落内时用段落速度。
func (s Score) BarTempo(bar int) float64 {
	for _, section := range s.Sections {
		if section.Tempo > 0 && bar >= section.Start && bar <= section.End {
			return section.Tempo
		}
	}
	return s.Tempo
}

// Seconds 把小节与拍位置（拍从 1 开始）换算为秒，逐小节累加以支持段落变速。
func (s Score) Seconds(bar int, beat float64) float64 {
	per := s.BeatsPerBar()
	position := float64(bar-1)*per + beat - 1
	seconds := 0.0
	for b := 1; position > 0; b++ {
		step := min(position, per)
		seconds += step * 60 / s.BarTempo(b)
		position -= step
	}
	return seconds
}

func (s Score) Duration() float64 { return s.Seconds(s.Bars()+1, 1) }

// ScoreWithinLimits 只检查规模，编辑中的乐谱允许暂时不完整，生成前再完整校验。
func ScoreWithinLimits(s *Score) bool {
	if s == nil {
		return true
	}
	notes := 0
	for _, t := range s.Tracks {
		notes += len(t.Notes)
	}
	return len(s.Tracks) <= ScoreMaxTracks && notes <= ScoreMaxNotes && len(s.Sections) <= ScoreMaxBars
}

func ValidateScore(s *Score) error {
	if ScoreIssue(s) != "" {
		return msg.Err(msg.ErrScoreInvalid, nil)
	}
	return nil
}

// ScoreIssue 返回乐谱第一处不合规的英文说明，合规时返回空串；AI 写谱时据此要求模型修正。
func ScoreIssue(s *Score) string {
	if s == nil {
		return "score is empty"
	}
	if s.Tempo < 30 || s.Tempo > 300 {
		return "tempo must be 30-300"
	}
	if len(s.TimeSignature) != 2 || s.TimeSignature[0] < 1 || s.TimeSignature[0] > 16 || !slices.Contains([]int{2, 4, 8, 16}, s.TimeSignature[1]) {
		return "timeSignature must be [1-16, 2|4|8|16]"
	}
	if TextLen(s.Key) > 40 {
		return "key must be at most 40 characters"
	}
	if len(s.Tracks) == 0 || len(s.Tracks) > ScoreMaxTracks {
		return fmt.Sprintf("score needs 1-%d tracks", ScoreMaxTracks)
	}
	for _, section := range s.Sections {
		if strings.TrimSpace(section.Name) == "" || TextLen(section.Name) > 40 || section.Start < 1 || section.End < section.Start || section.End > ScoreMaxBars || (section.Tempo != 0 && (section.Tempo < 30 || section.Tempo > 300)) {
			return fmt.Sprintf("section %q needs a name, 1 <= start <= end <= %d and tempo 30-300 if set", section.Name, ScoreMaxBars)
		}
	}
	notes, ids := 0, map[string]bool{}
	per := s.BeatsPerBar()
	for _, t := range s.Tracks {
		if t.ID == "" || len(t.ID) > 64 || ids[t.ID] {
			return fmt.Sprintf("track id %q must be unique and 1-64 characters", t.ID)
		}
		ids[t.ID] = true
		if strings.TrimSpace(t.Name) == "" || TextLen(t.Name) > 40 {
			return fmt.Sprintf("track %q needs a name of at most 40 characters", t.ID)
		}
		if t.Program < 0 || t.Program > 127 {
			return fmt.Sprintf("track %q program must be 0-127", t.ID)
		}
		if _, ok := ScoreRoles[t.Role]; t.Role != "" && !ok {
			return fmt.Sprintf("track %q role must be one of melody, piano, strings, bass, drums, pad, arp, other", t.ID)
		}
		if t.Level < -60 || t.Level > 0 || t.Pan < -1 || t.Pan > 1 || t.Reverb < 0 || t.Reverb > 1 {
			return fmt.Sprintf("track %q needs level -60..0, pan -1..1, reverb 0..1", t.ID)
		}
		if h := t.Humanize; h != nil && (h.Velocity < 0 || h.Velocity > 40 || h.TimingMs < 0 || h.TimingMs > 50) {
			return fmt.Sprintf("track %q humanize needs velocity 0-40 and timingMs 0-50", t.ID)
		}
		for _, r := range t.Dynamics {
			if r.Start < 1 || r.End < r.Start || r.End > ScoreMaxBars || r.From < 0 || r.From > 1 || r.To < 0 || r.To > 1 {
				return fmt.Sprintf("track %q dynamics need 1 <= start <= end and from/to 0-1", t.ID)
			}
		}
		for _, n := range t.Notes {
			if n.Bar < 1 || n.Bar > ScoreMaxBars || n.Beat < 1 || n.Beat >= per+1 {
				return fmt.Sprintf("track %q note at bar %d beat %g: bar must be 1-%d and beat 1 to below %g", t.ID, n.Bar, n.Beat, ScoreMaxBars, per+1)
			}
			if n.Pitch < 0 || n.Pitch > 127 || n.Length <= 0 || n.Length > 64 || n.Velocity < 1 || n.Velocity > 127 {
				return fmt.Sprintf("track %q note at bar %d beat %g needs pitch 0-127, length 0-64 beats, velocity 1-127", t.ID, n.Bar, n.Beat)
			}
		}
		notes += len(t.Notes)
	}
	if notes == 0 || notes > ScoreMaxNotes {
		return fmt.Sprintf("score needs 1-%d notes", ScoreMaxNotes)
	}
	if s.Bars() > ScoreMaxBars || s.Duration() > ScoreMaxSeconds {
		return fmt.Sprintf("score must be at most %d bars and %d seconds", ScoreMaxBars, int(ScoreMaxSeconds))
	}
	return ""
}

func validateScoreDraft(d Draft) error {
	if strings.TrimSpace(d.Title) == "" || TextLen(d.Title) > 120 {
		return msg.Err(msg.ErrTitleLength, nil)
	}
	if m, e := catalog.Lookup(d.ModelID); e != nil || m.Family != "soundfont" {
		return msg.Err(msg.ErrModelUnsupported, nil)
	}
	return ValidateScore(d.Score)
}
