package workbench

import (
	"context"
	"fmt"
	"os"
	"slices"
	"time"
	"yovoice/internal/audio"
	"yovoice/internal/diag"
	"yovoice/internal/domain"
	"yovoice/internal/msg"
)

func (w *Workbench) Generate(d domain.Draft) error { return w.generateAudio(d, "", "", "") }

// GenerateCue 重新生成字幕中的一句，可指定替换的时间线片段。
func (w *Workbench) GenerateCue(d domain.Draft, cueID, clipID string) error {
	if cueID == "" {
		return msg.Err(msg.ErrSubtitleInvalid, nil)
	}
	return w.generateAudio(d, "", cueID, clipID)
}

// Synthesize 同步生成并返回历史记录：结果不新建作品，避免远程服务的状态文件无限增长。
// ctx 结束时取消推理，并等待操作收尾后才返回。
func (w *Workbench) Synthesize(ctx context.Context, d domain.Draft) (domain.Generation, error) {
	if err := ctx.Err(); err != nil {
		return domain.Generation{}, err
	}
	if err := w.startGeneration(d, "", "", "", false); err != nil {
		return domain.Generation{}, err
	}
	done := w.Done()
	select {
	case <-done:
	case <-ctx.Done():
		w.Cancel()
		<-done
		return domain.Generation{}, ctx.Err()
	}
	if err := ctx.Err(); err != nil {
		return domain.Generation{}, err
	}
	state := w.Store.Read()
	if activity := state.Activity; activity == nil || activity.Status != "completed" {
		// 保留稳定错误码，远程客户端无需读取服务端日志即可区分原因。
		if activity != nil && activity.ErrorCode != nil {
			return domain.Generation{}, fmt.Errorf("语音生成失败：%s", errorText(*activity.ErrorCode, activity.ErrorParams))
		}
		return domain.Generation{}, fmt.Errorf("语音生成失败，请检查服务端日志")
	}
	for _, g := range state.History {
		if g.Settings.ID == d.ID {
			return g, nil
		}
	}
	return domain.Generation{}, fmt.Errorf("生成结果未找到")
}

func errorText(code msg.Code, params msg.Params) string {
	if detail, ok := params["detail"]; ok {
		return fmt.Sprintf("%s (%v)", code, detail)
	}
	return string(code)
}

func (w *Workbench) generateAudio(d domain.Draft, previewID, cueID, clipID string) error {
	return w.startGeneration(d, previewID, cueID, clipID, previewID == "")
}

func (w *Workbench) startGeneration(d domain.Draft, previewID, cueID, clipID string, saveDraft bool) (err error) {
	diag.Log(w.Store.Root, "generation.requested", "project_id", d.ID, "model_id", d.ModelID, "cue_id", cueID, "clip_id", clipID, "preview_id", previewID)
	defer func() {
		if err != nil {
			diag.Log(w.Store.Root, "generation.rejected", "project_id", d.ID, "error", diag.Error(err))
		}
	}()
	d.EnsureCueIDs()
	original := d
	if cueID != "" {
		if d.Subtitles == nil {
			return msg.Err(msg.ErrSubtitleInvalid, nil)
		}
		i := slices.IndexFunc(d.Subtitles.Cues, func(c domain.SubtitleCue) bool { return c.ID == cueID })
		if i < 0 {
			return msg.Err(msg.ErrSubtitleInvalid, nil)
		}
		if clipID != "" {
			found := false
			if d.Timeline != nil {
				for _, lane := range d.Timeline.Tracks {
					for _, clip := range lane.Clips {
						if clip.ID == clipID {
							if lane.Locked {
								return msg.Err(msg.ErrTimelineInvalid, nil)
							}
							found = true
						}
					}
				}
			}
			if !found {
				return msg.Err(msg.ErrTimelineInvalid, nil)
			}
		}
		document := *d.Subtitles
		document.Cues = []domain.SubtitleCue{document.Cues[i]}
		d.Subtitles = &document
		d.Text = document.Cues[0].Text
	}
	s := w.Store.Read()
	parts, e := w.prepareSynthesis(d, s)
	if e != nil {
		return e
	}

	if s.RuntimePath == nil || value(s.RuntimeBackend) != s.Preferences.Backend {
		return msg.Err(msg.ErrRuntimeRequired, nil)
	}
	if saveDraft {
		if e = w.SaveDraft(original); e != nil {
			return e
		}
	}
	return w.begin("generate", msg.ActivityGenerate, nil, nil, func(ctx context.Context) error {
		if d.Subtitles != nil && previewID == "" {
			return w.generateSegments(ctx, s, parts, clipID)
		}
		id := domain.NewID()
		file := id + ".wav"
		if previewID != "" {
			id = previewID
			file = "audition-" + id + ".wav"
		}
		path, e := w.Store.MediaPath("outputs", file)
		if e != nil {
			return e
		}
		keep := false
		defer func() {
			if !keep {
				_ = os.Remove(path)
			}
		}()
		part := parts[0]
		if e = w.engine.Generate(ctx, *s.RuntimePath, part.model, s.Preferences.Backend, part.draft, part.voice, part.emotion, path, func(code msg.Code, params msg.Params) { w.progress(code, params, 0, 1) }); e != nil {
			return e
		}
		duration, e := audio.Duration(path)
		if e != nil {
			return e
		}
		if e = ctx.Err(); e != nil {
			return e
		}
		if previewID != "" {
			e = w.Store.Update(func(s *domain.State) {
				s.Previews = append(s.Previews, domain.CharacterPreview{ID: id, FileName: file, Duration: duration, Settings: d.SynthesisSettings, Text: d.Text})
			}, true)
			keep = e == nil
			if keep {
				diag.Log(w.Store.Root, "preview.saved", "preview_id", id, "model_id", part.model.ID, "duration", duration)
			}
			return e
		}
		// 与逐句生成一致，快照不携带时间轴，避免历史记录随剪辑反复膨胀。
		snapshot := d
		snapshot.Timeline = nil
		g := domain.Generation{ID: id, Title: d.Title, FileName: file, CreatedAt: time.Now().UTC(), Duration: duration, Settings: snapshot}
		if e = w.Store.Update(func(s *domain.State) { s.History = append([]domain.Generation{g}, s.History...) }, true); e != nil {
			_ = os.Remove(path)
			return e
		}
		keep = true
		diag.Log(w.Store.Root, "generation.saved", "project_id", d.ID, "generation_id", id, "model_id", part.model.ID, "duration", duration)
		return nil
	}, previewID, d.ID)
}
