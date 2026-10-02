package workbench

import (
	"context"
	"fmt"
	"os"
	"slices"
	"strings"
	"time"
)

// performanceSettings 优先使用该句演绎的完整模型和参数。
func (s SynthesisSettings) performanceSettings(p *CharacterPerformance) SynthesisSettings {
	if p != nil {
		return p.Settings
	}
	return s
}

// subtitleDrafts 校验字幕关系，并展开每句的说话人和演绎参数。
func (d Draft) subtitleDrafts() ([]Draft, error) {
	if d.Subtitles == nil {
		return []Draft{d}, nil
	}
	document := d.Subtitles
	bad := Err(MsgErrSubtitleInvalid, nil)
	if len(document.Cues) > 2000 || len(document.Speakers) == 0 || len(document.Speakers) > 100 {
		return nil, bad
	}
	speakers := map[string]SubtitleSpeaker{}
	for _, speaker := range document.Speakers {
		if speaker.ID == "" || len(speaker.ID) > 64 || textLen(speaker.SourceName) > 120 {
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
		if cue.Performance != nil && (cue.Performance.ID == "" || len(cue.Performance.ID) > 64 || textLen(cue.Performance.Name) > 120) {
			return nil, bad
		}
		next.SynthesisSettings = next.SynthesisSettings.performanceSettings(cue.Performance)
		next.Performance = cue.Performance
		texts = append(texts, cue.Text)
		drafts = append(drafts, next)
	}
	if strings.Join(texts, "\n") != d.Text || textLen(d.Text) > 12000 {
		return nil, bad
	}
	return drafts, nil
}

type synthesisPart struct {
	draft   Draft
	model   InstalledModel
	voice   string
	emotion string
	segment *GenerationSegment
}

// prepareSynthesis 在启动前检查所有句子，避免生成到一半才发现角色缺少模型或音色。
func (w *Workbench) prepareSynthesis(d Draft, state State) ([]synthesisPart, error) {
	drafts, err := d.subtitleDrafts()
	if err != nil {
		return nil, err
	}
	parts := make([]synthesisPart, 0, len(drafts))
	for index, draft := range drafts {
		if d.Subtitles != nil && strings.TrimSpace(draft.Text) == "" {
			continue
		}
		if err = Validate(draft); err != nil {
			return nil, err
		}
		modelIndex := slices.IndexFunc(state.Models, func(m InstalledModel) bool { return m.ID == draft.ModelID })
		if modelIndex < 0 {
			return nil, Err(MsgErrModelRequired, nil)
		}
		part := synthesisPart{draft: draft, model: state.Models[modelIndex]}
		if d.Subtitles != nil {
			cue := d.Subtitles.Cues[index]
			name := ""
			for _, speaker := range d.Subtitles.Speakers {
				if speaker.ID == cue.SpeakerID {
					name = speaker.SourceName
				}
			}
			part.segment = &GenerationSegment{CueID: cue.ID, SpeakerID: cue.SpeakerID, SpeakerName: name, Index: index, Placement: "ripple"}
		}
		if draft.RequiresVoice() {
			part.voice, err = w.MediaFile("voices", value(draft.VoiceID))
			if err != nil {
				return nil, Err(MsgErrVoiceRequired, nil)
			}
		}
		if draft.EmotionVoiceID != nil {
			part.emotion, _ = w.MediaFile("voices", *draft.EmotionVoiceID)
		}
		if _, err = BuildRequest(draft, part.voice, part.emotion); err != nil {
			return nil, err
		}
		parts = append(parts, part)
	}
	if len(parts) == 0 {
		return nil, Err(MsgErrTextRequired, nil)
	}
	return parts, nil
}

// generateSegments 逐句落盘。取消或失败保留已经完成的句子，不创建合并文件。
func (w *Workbench) generateSegments(ctx context.Context, state State, parts []synthesisPart, targetClipID string) error {
	batch := newID()
	for index, part := range parts {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := w.Store.Update(func(s *State) {
			if s.Activity != nil {
				s.Activity.CueID = part.segment.CueID
			}
		}, false); err != nil {
			return err
		}
		id := newID()
		path, err := w.Store.MediaPath("outputs", id+".wav")
		if err != nil {
			return err
		}
		diagnostic(w.Store.Root, "segment.started", "project_id", part.draft.ID, "batch_id", batch, "cue_id", part.segment.CueID, "generation_id", id, "model_id", part.model.ID, "index", index)
		err = w.engine.Generate(ctx, *state.RuntimePath, part.model, state.Preferences.Backend, part.draft, part.voice, part.emotion, path, func(_ MessageCode, _ MessageParams) {
			w.progress(MsgActivitySubtitle, MessageParams{"n": index + 1, "total": len(parts)}, int64(index), int64(len(parts)))
		})
		if err != nil {
			_ = os.Remove(path)
			return err
		}
		duration, err := Duration(path)
		if err == nil {
			err = ctx.Err()
		}
		if err != nil {
			_ = os.Remove(path)
			return err
		}
		part.segment.BatchID = batch
		if targetClipID != "" {
			part.segment.TargetClipID = targetClipID
		}
		title := []rune(part.draft.Text)
		if len(title) > 60 {
			title = title[:60]
		}
		// 快照不携带旧时间轴，避免历史版本之间递归堆积。
		snapshot := part.draft
		snapshot.Timeline = nil
		snapshot.Kind = "text"
		g := Generation{ID: id, Title: string(title), FileName: id + ".wav", CreatedAt: time.Now().UTC(), Duration: duration, Settings: snapshot, Segment: part.segment}
		if err = w.Store.Update(func(s *State) { s.History = append([]Generation{g}, s.History...) }, true); err != nil {
			_ = os.Remove(path)
			return err
		}
		diagnostic(w.Store.Root, "segment.saved", "project_id", part.draft.ID, "batch_id", batch, "cue_id", part.segment.CueID, "generation_id", id, "duration", duration)
	}
	return nil
}

// ensureCueIDs 为旧作品补充可重复的身份，后续插入或删除台词不会错配生成结果。
func (d *Draft) ensureCueIDs() {
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
