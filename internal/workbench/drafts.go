package workbench

import (
	"encoding/json"
	"slices"
	"time"
)

func (w *Workbench) SaveDraft(d Draft) (err error) {
	started := time.Now()
	stage := "validate_kind"
	defer func() {
		diagnostic(w.Store.Root, "draft.save", "project_id", d.ID, "model_id", d.ModelID, "text_length", textLen(d.Text), "stage", stage, "elapsed_ms", time.Since(started).Milliseconds(), "error", diagnosticError(err))
	}()
	d.ensureCueIDs()
	if d.Kind != "" && d.Kind != "text" && d.Kind != "story" && d.Kind != "subtitle" {
		return Err(MsgErrDraftLimits, nil)
	}
	stage = "validate_assets"
	if err := w.validateTimelineAssets(d.Timeline); err != nil {
		return err
	}
	stage = "validate_timeline"
	if err := validateTimeline(d.Timeline, w.Store.Read().History); err != nil {
		return err
	}
	stage = "validate_subtitles"
	if _, err := d.subtitleDrafts(); err != nil {
		return err
	}
	stage = "validate_limits"
	if !validID(d.ID) || textLen(d.Text) > 12000 || textLen(d.Title) > 120 || textLen(d.EmotionText) > 500 || textLen(d.VoiceDescription) > 500 || textLen(d.ReferenceText) > 2000 {
		return Err(MsgErrDraftLimits, nil)
	}
	stage = "persist"
	return w.Store.Update(func(s *State) {
		i := slices.IndexFunc(s.Drafts, func(v Draft) bool { return v.ID == d.ID })
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
			s.Drafts = append([]Draft{d}, s.Drafts...)
		} else {
			s.Drafts[i] = d
		}
	}, true)
}
