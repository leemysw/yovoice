package workbench

import (
	"fmt"
	"slices"
	"strings"
	"yovoice/internal/schema"
)

type workSubtitles struct {
	Speakers []workSubtitleSpeaker `json:"speakers" jsonschema:"角色列表，name 必填"`
	Cues     []workSubtitleCue     `json:"cues" jsonschema:"台词列表，speaker 为角色名或 1 开始的序号"`
}

type workSubtitleSpeaker struct {
	Name    string `json:"name" jsonschema:"角色名"`
	VoiceID string `json:"voiceId,omitempty" jsonschema:"该角色使用的参考音色 ID"`
}

type workSubtitleCue struct {
	Speaker string `json:"speaker" jsonschema:"角色名或 1 开始的序号"`
	Text    string `json:"text" jsonschema:"这句台词"`
}

type workSpeakerVoice struct {
	Speaker string `json:"speaker" jsonschema:"角色名或 1 开始的序号"`
	VoiceID string `json:"voiceId" jsonschema:"参考音色 ID；空字符串表示清除"`
}

// patchWorkStory 修改故事配音的角色与台词、各角色的参考音色，以及按角色套用声音库角色或单独改声音设置。
func (w *Workbench) patchWorkStory(d *schema.Draft, in updateWorkInput, kind string) ([]string, error) {
	var changed []string
	if in.Subtitles != nil {
		if kind != "story" {
			return nil, fmt.Errorf("subtitles 只适用于故事配音作品，这个作品是 %s", kind)
		}
		if e := applyWorkSubtitles(d, *in.Subtitles); e != nil {
			return nil, e
		}
		changed = append(changed, "角色与台词")
	}
	for _, assignment := range in.SpeakerVoices {
		if voice := strings.TrimSpace(assignment.VoiceID); voice != "" && !w.voiceExists(voice) {
			return nil, fmt.Errorf("没有找到参考音色 %s，请先用 list_voices 查询", voice)
		}
	}
	if len(in.SpeakerVoices) > 0 {
		if kind != "story" || d.Subtitles == nil {
			return nil, fmt.Errorf("speakerVoices 只适用于已有角色的故事配音作品")
		}
		if e := applySpeakerVoices(d, in.SpeakerVoices); e != nil {
			return nil, e
		}
		changed = append(changed, "角色音色")
	}
	if len(in.SpeakerSettings) > 0 {
		patched, e := w.applySpeakerSettings(d, in.SpeakerSettings, w.Store.Read().Characters)
		if e != nil {
			return nil, e
		}
		changed = append(changed, patched...)
	}
	return changed, nil
}

// applyWorkSubtitles 整体替换故事配音的角色与台词：每个角色继承作品当前的声音设置。
func applyWorkSubtitles(d *schema.Draft, in workSubtitles) error {
	if len(in.Speakers) == 0 || len(in.Cues) == 0 {
		return fmt.Errorf("subtitles 需要 speakers 与 cues，且都不能为空")
	}
	names := make([]string, len(in.Speakers))
	for i, s := range in.Speakers {
		names[i] = strings.TrimSpace(s.Name)
		if names[i] == "" || schema.TextLen(names[i]) > 60 {
			return fmt.Errorf("角色名不能为空且不超过 60 字：speakers[%d]", i)
		}
	}
	index := func(speaker string) (int, error) {
		if i := slices.Index(names, strings.TrimSpace(speaker)); i >= 0 {
			return i, nil
		}
		var ordinal int
		if _, e := fmt.Sscanf(strings.TrimSpace(speaker), "%d", &ordinal); e == nil && ordinal >= 1 && ordinal <= len(names) {
			return ordinal - 1, nil
		}
		return -1, fmt.Errorf("台词的 speaker %q 不在角色列表里", speaker)
	}
	var joined strings.Builder
	for i, cue := range in.Cues {
		text := strings.TrimSpace(cue.Text)
		if text == "" {
			return fmt.Errorf("台词不能为空：cues[%d]", i)
		}
		if _, e := index(cue.Speaker); e != nil {
			return e
		}
		joined.WriteString(text)
		if i < len(in.Cues)-1 {
			joined.WriteString("\n")
		}
	}
	if schema.TextLen(joined.String()) > 12000 {
		return fmt.Errorf("台词总长超过 12000 字")
	}
	settings := d.SynthesisSettings
	document := schema.SubtitleDocument{}
	for i, name := range names {
		speaker := schema.SubtitleSpeaker{ID: schema.NewID(), SourceName: name, Settings: &settings}
		if voice := strings.TrimSpace(in.Speakers[i].VoiceID); voice != "" {
			speaker.Settings.VoiceID = stringPtr(voice)
		}
		document.Speakers = append(document.Speakers, speaker)
	}
	// 台词时间先按每句 2 秒顺排（与界面新建台词一致），用户随后可在时间线上调整。
	for i, cue := range in.Cues {
		speaker, _ := index(cue.Speaker)
		document.Cues = append(document.Cues, schema.SubtitleCue{ID: schema.NewID(), SpeakerID: document.Speakers[speaker].ID, Text: strings.TrimSpace(cue.Text), Start: int64(i) * 2000, End: int64(i+1) * 2000})
	}
	d.Subtitles, d.Text = &document, joined.String()
	return nil
}

// applySpeakerVoices 只改角色音色，不动台词；speaker 按角色名或 1 开始的序号定位。
func applySpeakerVoices(d *schema.Draft, assignments []workSpeakerVoice) error {
	for _, assignment := range assignments {
		matched := false
		for i := range d.Subtitles.Speakers {
			speaker := &d.Subtitles.Speakers[i]
			ordinal := 0
			if _, e := fmt.Sscanf(strings.TrimSpace(assignment.Speaker), "%d", &ordinal); e == nil && ordinal == i+1 || speaker.SourceName == strings.TrimSpace(assignment.Speaker) {
				if speaker.Settings == nil {
					settings := d.SynthesisSettings
					speaker.Settings = &settings
				}
				if voice := strings.TrimSpace(assignment.VoiceID); voice != "" {
					speaker.Settings.VoiceID = stringPtr(voice)
				} else {
					speaker.Settings.VoiceID = nil
				}
				matched = true
			}
		}
		if !matched {
			return fmt.Errorf("speakerVoices 里的 %q 不在角色列表里", assignment.Speaker)
		}
	}
	return nil
}
