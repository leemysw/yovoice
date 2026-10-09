package domain

import (
	"fmt"
	"strings"
	"yovoice/internal/msg"
)

// performanceSettings 优先使用该句演绎的完整模型和参数。
func (s SynthesisSettings) PerformanceSettings(p *CharacterPerformance) SynthesisSettings {
	if p != nil {
		return p.Settings
	}
	return s
}

// subtitleDrafts 校验字幕关系，并展开每句的说话人和演绎参数。
func (d Draft) SubtitleDrafts() ([]Draft, error) {
	if d.Subtitles == nil {
		return []Draft{d}, nil
	}
	document := d.Subtitles
	bad := msg.Err(msg.ErrSubtitleInvalid, nil)
	if len(document.Cues) > 2000 || len(document.Speakers) == 0 || len(document.Speakers) > 100 {
		return nil, bad
	}
	speakers := map[string]SubtitleSpeaker{}
	for _, speaker := range document.Speakers {
		if speaker.ID == "" || len(speaker.ID) > 64 || TextLen(speaker.SourceName) > 120 {
			return nil, bad
		}
		if _, exists := speakers[speaker.ID]; exists {
			return nil, bad
		}
		speakers[speaker.ID] = speaker
	}
	drafts := make([]Draft, 0, len(document.Cues))
	texts := make([]string, 0, len(document.Cues))
	ids := map[string]bool{}
	for _, cue := range document.Cues {
		if cue.ID != "" {
			if len(cue.ID) > 64 || ids[cue.ID] {
				return nil, bad
			}
			ids[cue.ID] = true
		}
		speaker, exists := speakers[cue.SpeakerID]
		if !exists || cue.Start < 0 || cue.End <= cue.Start || cue.End > 86400000 {
			return nil, bad
		}
		next := d
		next.Subtitles = nil
		next.Text = cue.Text
		next.CharacterID = speaker.CharacterID
		if speaker.Settings != nil {
			next.SynthesisSettings = *speaker.Settings
		}
		if cue.Performance != nil && (cue.Performance.ID == "" || len(cue.Performance.ID) > 64 || TextLen(cue.Performance.Name) > 120) {
			return nil, bad
		}
		next.SynthesisSettings = next.SynthesisSettings.PerformanceSettings(cue.Performance)
		next.Performance = cue.Performance
		texts = append(texts, cue.Text)
		drafts = append(drafts, next)
	}
	if strings.Join(texts, "\n") != d.Text || TextLen(d.Text) > 12000 {
		return nil, bad
	}
	return drafts, nil
}

// ensureCueIDs 为旧作品补充可重复的身份，后续插入或删除台词不会错配生成结果。
func (d *Draft) EnsureCueIDs() {
	if d.Subtitles == nil {
		return
	}
	document := *d.Subtitles
	document.Cues = append([]SubtitleCue{}, document.Cues...)
	for index := range document.Cues {
		if document.Cues[index].ID == "" {
			document.Cues[index].ID = fmt.Sprintf("legacy-%s-%d", d.ID, index)
		}
	}
	d.Subtitles = &document
}
