package workbench

import (
	"cmp"
	"encoding/json"
	"fmt"
	"reflect"
	"slices"
	"strings"
	"yovoice/internal/schema"

	"github.com/google/jsonschema-go/jsonschema"
)

// 助手写谱与 update_work 共用的乐谱构建与校验：notes 接受紧凑数组与完整对象，
// repeats 让模型只写一遍循环段落，由这里展开。

// scoreInput 是助手提交的乐谱输入。
type scoreInput struct {
	Tempo         float64               `json:"tempo" jsonschema:"速度 30-300（BPM）"`
	TimeSignature []int                 `json:"timeSignature" jsonschema:"拍号 [分子,分母]，如 [4,4]"`
	Key           string                `json:"key,omitempty" jsonschema:"调性，如 D minor"`
	Sections      []schema.ScoreSection `json:"sections,omitempty" jsonschema:"段落，可带自己的 tempo 做渐慢"`
	Tracks        []scoreTrack          `json:"tracks"`
}

// scoreTrack 是乐谱里的一个声部。
type scoreTrack struct {
	ID       string             `json:"id" jsonschema:"声部唯一 ID"`
	Name     string             `json:"name" jsonschema:"声部名称，用界面语言书写"`
	Role     string             `json:"role,omitempty" jsonschema:"melody/piano/strings/bass/drums/pad/arp/other"`
	Program  int                `json:"program" jsonschema:"General MIDI 音色号 0-127"`
	Drums    bool               `json:"drums,omitempty" jsonschema:"鼓组时为 true"`
	Level    float64            `json:"level,omitempty" jsonschema:"电平 dBFS，一般省略"`
	Pan      float64            `json:"pan,omitempty" jsonschema:"-1 到 1"`
	Reverb   float64            `json:"reverb,omitempty" jsonschema:"0 到 1"`
	Humanize *schema.Humanize   `json:"humanize,omitempty" jsonschema:"力度与时间微调"`
	Dynamics []schema.ScoreRamp `json:"dynamics,omitempty" jsonschema:"音量渐变"`
	Notes    []scoreNoteInput   `json:"notes" jsonschema:"音符数组，每项为 [小节,拍,MIDI音高,拍数,力度] 五个数字或同字段对象；小节与拍从 1 开始，拍可为小数"`
	Repeats  []scoreRepeat      `json:"repeats,omitempty" jsonschema:"把 from..to 小节的音符复制到各 at 起点"`
}

// scoreNoteInput 是一个音符的两种写法之一：[小节,拍,音高,拍数,力度] 数组或同字段对象。
// 用具名类型是为了给它单独指定 JSON Schema：裸 any 会生成 items: true，Moonshot（Kimi）等
// 严格校验的服务会拒绝整个工具定义。
type scoreNoteInput any

// updateWorkInputSchema 生成 update_work 的入参 Schema，音符项显式声明为“数字数组或对象”。
func updateWorkInputSchema() (*jsonschema.Schema, error) {
	note := &jsonschema.Schema{AnyOf: []*jsonschema.Schema{
		{Type: "array", Items: &jsonschema.Schema{Type: "number"}, MinItems: jsonschema.Ptr(5), MaxItems: jsonschema.Ptr(5)},
		{Type: "object"},
	}}
	return jsonschema.For[updateWorkInput](&jsonschema.ForOptions{
		TypeSchemas: map[reflect.Type]*jsonschema.Schema{reflect.TypeFor[scoreNoteInput](): note},
	})
}

// scoreRepeat 让模型只写一遍循环段落，由这里展开成音符，长曲子不必逐个写出。
type scoreRepeat struct {
	From int   `json:"from"`
	To   int   `json:"to"`
	At   []int `json:"at"`
}

// expandRepeats 把 From..To 小节的音符复制到每个 At 起点；展开后的总数仍受乐谱音符上限约束。
func expandRepeats(track *schema.ScoreTrack, repeats []scoreRepeat, budget int) error {
	written := track.Notes
	for _, r := range repeats {
		if r.From < 1 || r.To < r.From || r.To > schema.ScoreMaxBars {
			return fmt.Errorf("track %q: repeats need 1 <= from <= to <= %d", track.ID, schema.ScoreMaxBars)
		}
		for _, at := range r.At {
			if at < 1 || at > schema.ScoreMaxBars {
				return fmt.Errorf("track %q: repeat targets must be bars 1-%d", track.ID, schema.ScoreMaxBars)
			}
			for _, n := range written {
				if n.Bar < r.From || n.Bar > r.To {
					continue
				}
				if len(track.Notes) >= budget {
					return fmt.Errorf("score needs 1-%d notes after repeats", schema.ScoreMaxNotes)
				}
				n.Bar += at - r.From
				track.Notes = append(track.Notes, n)
			}
		}
	}
	slices.SortStableFunc(track.Notes, func(a, b schema.ScoreNote) int {
		if a.Bar != b.Bar {
			return a.Bar - b.Bar
		}
		return cmp.Compare(a.Beat, b.Beat)
	})
	return nil
}

// buildScore 把工具参数转成乐谱并做与界面一致的校验。
func buildScore(in scoreInput) (schema.Score, error) {
	s := schema.Score{Tempo: in.Tempo, TimeSignature: in.TimeSignature, Key: strings.TrimSpace(in.Key), Sections: in.Sections}
	notes := 0
	for _, t := range in.Tracks {
		track := schema.ScoreTrack{ID: t.ID, Name: t.Name, Role: t.Role, Program: t.Program, Drums: t.Drums, Level: t.Level, Pan: t.Pan, Reverb: t.Reverb, Humanize: t.Humanize, Dynamics: t.Dynamics}
		for _, raw := range t.Notes {
			note, err := parseScoreNote(raw)
			if err != nil {
				return schema.Score{}, fmt.Errorf("track %q: %v", track.ID, err)
			}
			track.Notes = append(track.Notes, note)
		}
		if err := expandRepeats(&track, t.Repeats, schema.ScoreMaxNotes-notes); err != nil {
			return schema.Score{}, err
		}
		notes += len(track.Notes)
		s.Tracks = append(s.Tracks, track)
	}
	if issue := schema.ScoreIssue(&s); issue != "" {
		return schema.Score{}, fmt.Errorf("%s", issue)
	}
	return s, nil
}

// parseScoreNote 接受紧凑数组 [bar, beat, pitch, length, velocity] 与完整对象两种音符写法。
func parseScoreNote(raw any) (schema.ScoreNote, error) {
	switch v := raw.(type) {
	case []any:
		if len(v) != 5 {
			return schema.ScoreNote{}, fmt.Errorf("each note array needs exactly 5 numbers [bar, beat, pitch, length, velocity]")
		}
		values := make([]float64, 5)
		for i, item := range v {
			f, ok := item.(float64)
			if !ok {
				return schema.ScoreNote{}, fmt.Errorf("note array values must be numbers")
			}
			values[i] = f
		}
		return schema.ScoreNote{Bar: int(values[0]), Beat: values[1], Pitch: int(values[2]), Length: values[3], Velocity: int(values[4])}, nil
	case map[string]any:
		data, err := json.Marshal(v)
		if err != nil {
			return schema.ScoreNote{}, err
		}
		var note schema.ScoreNote
		if err = json.Unmarshal(data, &note); err != nil {
			return schema.ScoreNote{}, fmt.Errorf("invalid note %s", data)
		}
		return note, nil
	}
	return schema.ScoreNote{}, fmt.Errorf("invalid note %v", raw)
}
