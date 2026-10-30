package workbench

import (
	"encoding/json"
	"slices"
	"time"
	"yovoice/internal/diag"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
	"yovoice/internal/score"
)

func (w *Workbench) SaveDraft(d schema.Draft) error {
	w.edit.Lock()
	defer w.edit.Unlock()
	return w.saveDraft(d)
}

// saveDraft 要求调用方持有编辑锁。
func (w *Workbench) saveDraft(d schema.Draft) (err error) {
	started := time.Now()
	stage := "validate_kind"
	defer func() {
		diag.Log(w.Store.Root, "draft.save", "project_id", d.ID, "model_id", d.ModelID, "text_length", schema.TextLen(d.Text), "stage", stage, "elapsed_ms", time.Since(started).Milliseconds(), "error", diag.Error(err))
	}()
	d.Normalize()
	if !schema.ValidKind(d.Kind) {
		return msg.Err(msg.ErrDraftLimits, nil)
	}
	stage = "validate_assets"
	if err := w.validateTimelineAssets(d.Timeline); err != nil {
		return err
	}
	stage = "validate_timeline"
	if err := schema.ValidateTimeline(d.Timeline, w.Store.Read().History); err != nil {
		return err
	}
	stage = "validate_subtitles"
	if _, err := d.SubtitleDrafts(); err != nil {
		return err
	}
	stage = "validate_limits"
	if !schema.ValidID(d.ID) || schema.TextLen(d.Text) > 12000 || schema.TextLen(d.Title) > 120 || schema.TextLen(d.EmotionText) > 500 || schema.TextLen(d.VoiceDescription) > 500 || schema.TextLen(d.ReferenceText) > 2000 || schema.TextLen(d.Lyrics) > 4000 || len(d.Abc) > score.ABCMaxLength || !schema.ScoreWithinLimits(d.Score) {
		return msg.Err(msg.ErrDraftLimits, nil)
	}
	// 内容未变化时直接返回、不写盘：打开作品或界面补存都会触发保存，
	// 若仍改写状态文件，数据目录不可写时连“没有任何修改”的退出都会失败。
	if sameDraft(w.Store.Read().Drafts, d) {
		stage = "unchanged"
		return nil
	}
	stage = "persist"
	return w.Store.Update(func(s *schema.State) {
		i := slices.IndexFunc(s.Drafts, func(v schema.Draft) bool { return v.ID == d.ID })
		// 打开作品会触发保存，只有内容变化才更新排序时间。
		if i >= 0 {
			d.CreatedAt = s.Drafts[i].CreatedAt
			d.UpdatedAt = s.Drafts[i].UpdatedAt
			if sameDraft(s.Drafts, d) {
				return
			}
		}
		now := time.Now()
		d.UpdatedAt = &now
		if i < 0 {
			d.CreatedAt = &now
			s.Drafts = append([]schema.Draft{d}, s.Drafts...)
		} else {
			s.Drafts[i] = d
		}
	}, true)
}

// sameDraft 判断作品内容与已保存版本一致；时间戳由服务端维护，不参与比较。
func sameDraft(drafts []schema.Draft, d schema.Draft) bool {
	i := slices.IndexFunc(drafts, func(v schema.Draft) bool { return v.ID == d.ID })
	if i < 0 {
		return false
	}
	d.CreatedAt, d.UpdatedAt = drafts[i].CreatedAt, drafts[i].UpdatedAt
	before, _ := json.Marshal(drafts[i])
	after, _ := json.Marshal(d)
	return string(before) == string(after)
}

func (w *Workbench) DeleteDraft(id string) error {
	if !schema.ValidID(id) {
		return msg.Err(msg.ErrDraftIDInvalid, nil)
	}
	w.edit.Lock()
	defer w.edit.Unlock()
	s := w.Store.Read()
	if s.Activity != nil && s.Activity.Kind == "generate" && s.Activity.Status == "running" && s.Activity.ProjectID == id {
		return msg.Err(msg.ErrBusy, nil)
	}
	// 其他作品时间线仍在使用的版本保留，其余历史版本随作品一起删除。
	referenced := timelineGenerations(s, id)
	deleteIDs := map[string]bool{}
	for _, g := range s.History {
		if g.Settings.ID == id && !referenced[g.ID] {
			deleteIDs[g.ID] = true
		}
	}
	var candidates []string
	for _, g := range s.History {
		if deleteIDs[g.ID] {
			candidates = append(candidates, g.FileName)
		}
	}
	for _, d := range s.Drafts {
		if d.ID == id && d.Timeline != nil {
			for _, asset := range d.Timeline.Assets {
				candidates = append(candidates, asset.FileName)
			}
		}
	}
	err := w.Store.Update(func(s *schema.State) {
		s.Drafts = slices.DeleteFunc(s.Drafts, func(d schema.Draft) bool { return d.ID == id })
		if len(deleteIDs) > 0 {
			s.History = slices.DeleteFunc(s.History, func(g schema.Generation) bool { return deleteIDs[g.ID] })
			for i := range s.Voices {
				if deleteIDs[s.Voices[i].SourceGenerationID] {
					s.Voices[i].SourceGenerationID = ""
				}
			}
		}
		// 作品专属的待取结果（出谱、已结束的 AI 写作）随作品一起丢弃，不再留给其他作品。
		if s.Melody != nil && s.Melody.ProjectID == id {
			s.Melody = nil
		}
		if s.AITask != nil && s.AITask.ProjectID == id && s.AITask.Status != "running" {
			s.AITask = nil
		}
	}, true)
	if err != nil {
		return err
	}
	// 只删除删除后已无任何记录使用的文件（例如复制作品后共享的导入素材仍保留）。
	w.deleteUnreferenced("outputs", candidates, nil)
	return nil
}
