package workbench

import (
	"context"
	"os"
	"slices"
	"strings"
	"time"
	"yovoice/internal/audio"
	"yovoice/internal/diag"
	"yovoice/internal/domain"
	"yovoice/internal/engine"
	"yovoice/internal/msg"
)

type synthesisPart struct {
	draft   domain.Draft
	model   domain.InstalledModel
	voice   string
	emotion string
	segment *domain.GenerationSegment
}

// prepareSynthesis 在启动前检查所有句子，避免生成到一半才发现角色缺少模型或音色。
func (w *Workbench) prepareSynthesis(d domain.Draft, state domain.State) ([]synthesisPart, error) {
	drafts, err := d.SubtitleDrafts()
	if err != nil {
		return nil, err
	}
	parts := make([]synthesisPart, 0, len(drafts))
	for index, draft := range drafts {
		if d.Subtitles != nil && strings.TrimSpace(draft.Text) == "" {
			continue
		}
		if err = domain.Validate(draft); err != nil {
			return nil, err
		}
		modelIndex := slices.IndexFunc(state.Models, func(m domain.InstalledModel) bool { return m.ID == draft.ModelID })
		if modelIndex < 0 {
			return nil, msg.Err(msg.ErrModelRequired, nil)
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
			part.segment = &domain.GenerationSegment{CueID: cue.ID, SpeakerID: cue.SpeakerID, SpeakerName: name, Index: index, Placement: "ripple"}
		}
		if draft.RequiresVoice() {
			part.voice, err = w.MediaFile("voices", value(draft.VoiceID))
			if err != nil {
				return nil, msg.Err(msg.ErrVoiceRequired, nil)
			}
		}
		if draft.EmotionVoiceID != nil {
			part.emotion, _ = w.MediaFile("voices", *draft.EmotionVoiceID)
		}
		if _, err = engine.BuildRequest(draft, part.voice, part.emotion); err != nil {
			return nil, err
		}
		parts = append(parts, part)
	}
	if len(parts) == 0 {
		return nil, msg.Err(msg.ErrTextRequired, nil)
	}
	return parts, nil
}

// generateSegments 逐句落盘。取消或失败保留已经完成的句子，不创建合并文件。
func (w *Workbench) generateSegments(ctx context.Context, state domain.State, parts []synthesisPart, targetClipID string) error {
	batch := domain.NewID()
	for index, part := range parts {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := w.Store.Update(func(s *domain.State) {
			if s.Activity != nil {
				s.Activity.CueID = part.segment.CueID
			}
		}, false); err != nil {
			return err
		}
		id := domain.NewID()
		path, err := w.Store.MediaPath("outputs", id+".wav")
		if err != nil {
			return err
		}
		diag.Log(w.Store.Root, "segment.started", "project_id", part.draft.ID, "batch_id", batch, "cue_id", part.segment.CueID, "generation_id", id, "model_id", part.model.ID, "index", index)
		err = w.engine.Generate(ctx, *state.RuntimePath, part.model, state.Preferences.Backend, part.draft, part.voice, part.emotion, path, func(_ msg.Code, _ msg.Params) {
			w.progress(msg.ActivitySubtitle, msg.Params{"n": index + 1, "total": len(parts)}, int64(index), int64(len(parts)))
		})
		if err != nil {
			_ = os.Remove(path)
			return err
		}
		duration, err := audio.Duration(path)
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
		g := domain.Generation{ID: id, Title: string(title), FileName: id + ".wav", CreatedAt: time.Now().UTC(), Duration: duration, Settings: snapshot, Segment: part.segment}
		if err = w.Store.Update(func(s *domain.State) { s.History = append([]domain.Generation{g}, s.History...) }, true); err != nil {
			_ = os.Remove(path)
			return err
		}
		diag.Log(w.Store.Root, "segment.saved", "project_id", part.draft.ID, "batch_id", batch, "cue_id", part.segment.CueID, "generation_id", id, "duration", duration)
	}
	return nil
}
