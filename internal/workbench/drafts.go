package workbench

import (
	"encoding/json"
	"slices"
	"time"
	"yovoice/internal/diag"
	"yovoice/internal/domain"
	"yovoice/internal/msg"
)

func (w *Workbench) SaveDraft(d domain.Draft) (err error) {
	started := time.Now()
	stage := "validate_kind"
	defer func() {
		diag.Log(w.Store.Root, "draft.save", "project_id", d.ID, "model_id", d.ModelID, "text_length", domain.TextLen(d.Text), "stage", stage, "elapsed_ms", time.Since(started).Milliseconds(), "error", diag.Error(err))
	}()
	d.EnsureCueIDs()
	if d.Kind != "" && d.Kind != "text" && d.Kind != "story" && d.Kind != "subtitle" {
		return msg.Err(msg.ErrDraftLimits, nil)
	}
	stage = "validate_assets"
	if err := w.validateTimelineAssets(d.Timeline); err != nil {
		return err
	}
	stage = "validate_timeline"
	if err := domain.ValidateTimeline(d.Timeline, w.Store.Read().History); err != nil {
		return err
	}
	stage = "validate_subtitles"
	if _, err := d.SubtitleDrafts(); err != nil {
		return err
	}
	stage = "validate_limits"
	if !domain.ValidID(d.ID) || domain.TextLen(d.Text) > 12000 || domain.TextLen(d.Title) > 120 || domain.TextLen(d.EmotionText) > 500 || domain.TextLen(d.VoiceDescription) > 500 || domain.TextLen(d.ReferenceText) > 2000 {
		return msg.Err(msg.ErrDraftLimits, nil)
	}
	stage = "persist"
	return w.Store.Update(func(s *domain.State) {
		i := slices.IndexFunc(s.Drafts, func(v domain.Draft) bool { return v.ID == d.ID })
		// 打开作品会触发保存，只有内容变化才更新排序时间。
		if i >= 0 {
			d.CreatedAt = s.Drafts[i].CreatedAt
			d.UpdatedAt = s.Drafts[i].UpdatedAt
			before, _ := json.Marshal(s.Drafts[i])
			after, _ := json.Marshal(d)
			if string(before) == string(after) {
				return
			}
		}
		now := time.Now()
		d.UpdatedAt = &now
		if i < 0 {
			d.CreatedAt = &now
			s.Drafts = append([]domain.Draft{d}, s.Drafts...)
		} else {
			s.Drafts[i] = d
		}
	}, true)
}

func (w *Workbench) DeleteDraft(id string) error {
	if !domain.ValidID(id) {
		return msg.Err(msg.ErrDraftIDInvalid, nil)
	}
	return w.Store.Update(func(s *domain.State) {
		s.Drafts = slices.DeleteFunc(s.Drafts, func(d domain.Draft) bool { return d.ID == id })
	}, true)
}
