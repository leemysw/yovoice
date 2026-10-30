package workbench

import (
	"context"
	"os"
	"slices"
	"strings"
	"time"
	"yovoice/internal/audio"
	"yovoice/internal/diag"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
)

func (w *Workbench) Generate(d schema.Draft) error { return w.generateAudio(d, "", "", "") }

// GenerateCue 重新生成字幕中的一句，可指定替换的时间线片段。
func (w *Workbench) GenerateCue(d schema.Draft, cueID, clipID string) error {
	if cueID == "" {
		return msg.Err(msg.ErrSubtitleInvalid, nil)
	}
	return w.generateAudio(d, "", cueID, clipID)
}

// Synthesize 同步生成并返回历史记录：结果不新建作品，避免远程服务的状态文件无限增长。
// ctx 结束时取消推理，并等待操作收尾后才返回。
func (w *Workbench) Synthesize(ctx context.Context, d schema.Draft) (schema.Generation, error) {
	if err := ctx.Err(); err != nil {
		return schema.Generation{}, err
	}
	done, err := w.startGeneration(d, "", "", "", false)
	if err != nil {
		return schema.Generation{}, err
	}
	select {
	case <-done:
	case <-ctx.Done():
		w.cancelOperation(done)
		<-done
		return schema.Generation{}, ctx.Err()
	}
	if err := ctx.Err(); err != nil {
		return schema.Generation{}, err
	}
	// 本机接口与桌面界面共用引擎：本次生成结束后界面可能立刻开始新的操作并改写 Activity，
	// 因此先按本次作品 ID 查找结果，只有找不到时才用 Activity 解释失败原因。
	state := w.Store.Read()
	for _, g := range state.History {
		if g.Settings.ID == d.ID {
			// 自动修剪无所属作品的 API 历史记录，最多保留 50 条
			w.pruneOrphanHistory(50)
			return g, nil
		}
	}
	if activity := state.Activity; activity != nil && activity.Status == "failed" && activity.ErrorCode != nil {
		// 原样返回结构化错误码，远程客户端无需读取服务端日志即可区分原因。
		return schema.Generation{}, msg.Err(*activity.ErrorCode, activity.ErrorParams)
	}
	return schema.Generation{}, msg.Err(msg.ErrGenerateFailed, nil)
}

// pruneOrphanHistory 只保留最新的 max 条孤儿历史（接口生成不建作品），时间线仍在使用的版本不计入也不删除。
// 与 CleanupResiduals 一致，24 小时内的结果始终保留，远程客户端可能稍后才下载音频。
func (w *Workbench) pruneOrphanHistory(max int) {
	w.edit.Lock()
	defer w.edit.Unlock()
	orphans := orphanGenerations(w.Store.Read())
	if len(orphans) <= max {
		return
	}
	cutoff := time.Now().Add(-orphanHistoryGrace)
	ids := map[string]bool{}
	for _, g := range orphans[max:] {
		if g.CreatedAt.Before(cutoff) {
			ids[g.ID] = true
		}
	}
	_ = w.removeGenerations(ids, nil)
}

// textVersionLimit 是语音生成作品保留的版本数：语音生成定位为快速合成，够反复抽卡挑选即可，不堆积历史。
const textVersionLimit = 10

// pruneTextVersions 删除语音作品中超出上限的旧版本及其音频；时间线仍在使用的版本保留且不占名额。
func (w *Workbench) pruneTextVersions(draftID string, max int) {
	w.edit.Lock()
	defer w.edit.Unlock()
	s := w.Store.Read()
	used := timelineGenerations(s, "")
	ids, kept := map[string]bool{}, 0
	for _, g := range s.History {
		if g.Settings.ID != draftID || g.Segment != nil || used[g.ID] {
			continue
		}
		if kept++; kept > max {
			ids[g.ID] = true
		}
	}
	_ = w.removeGenerations(ids, nil)
}

func (w *Workbench) generateAudio(d schema.Draft, previewID, cueID, clipID string) error {
	_, err := w.startGeneration(d, previewID, cueID, clipID, previewID == "")
	return err
}

// startGeneration 在编辑锁内完成检查、保存与启动，推理开始后素材删除会因任务运行而被拒绝。
func (w *Workbench) startGeneration(d schema.Draft, previewID, cueID, clipID string, saveDraft bool) (done <-chan struct{}, err error) {
	w.edit.Lock()
	defer w.edit.Unlock()
	diag.Log(w.Store.Root, "generation.requested", "project_id", d.ID, "model_id", d.ModelID, "cue_id", cueID, "clip_id", clipID, "preview_id", previewID)
	defer func() {
		if err != nil {
			diag.Log(w.Store.Root, "generation.rejected", "project_id", d.ID, "error", diag.Error(err))
		}
	}()
	if d.Kind == "score" {
		return w.startScore(d, saveDraft)
	}
	d.Normalize()
	original := d
	if cueID != "" {
		if d.Subtitles == nil {
			return nil, msg.Err(msg.ErrSubtitleInvalid, nil)
		}
		i := slices.IndexFunc(d.Subtitles.Cues, func(c schema.SubtitleCue) bool { return c.ID == cueID })
		if i < 0 {
			return nil, msg.Err(msg.ErrSubtitleInvalid, nil)
		}
		if clipID != "" {
			found := false
			if d.Timeline != nil {
				for _, lane := range d.Timeline.Tracks {
					for _, clip := range lane.Clips {
						if clip.ID == clipID {
							if lane.Locked {
								return nil, msg.Err(msg.ErrTimelineInvalid, nil)
							}
							found = true
						}
					}
				}
			}
			if !found {
				return nil, msg.Err(msg.ErrTimelineInvalid, nil)
			}
		}
		document := *d.Subtitles
		document.Cues = []schema.SubtitleCue{document.Cues[i]}
		d.Subtitles = &document
		d.Text = document.Cues[0].Text
	}
	s := w.Store.Read()
	parts, e := w.prepareSynthesis(d, s)
	if e != nil {
		return nil, e
	}

	if !RuntimeReady(s) {
		return nil, msg.Err(msg.ErrRuntimeRequired, nil)
	}
	for _, part := range parts {
		if e = modelEngineReady(s, part.model.ID); e != nil {
			return nil, e
		}
		if installing(s, part.model.ID) {
			return nil, msg.Err(msg.ErrBusy, nil)
		}
	}
	if saveDraft {
		if e = w.saveDraft(original); e != nil {
			return nil, e
		}
	}
	return w.start("generate", msg.ActivityGenerate, nil, nil, func(ctx context.Context) error {
		if e := w.ensureKokoro(ctx, s, parts); e != nil {
			return e
		}
		if d.Subtitles != nil && previewID == "" {
			return w.generateSegments(ctx, s, parts, clipID)
		}
		id := schema.NewID()
		file := outputFileName(id, time.Now(), outputSummary(d.Text, d.Title))
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
		generatedScore := ""
		if generatedScore, e = w.engine.Generate(ctx, *s.RuntimePath, part.model, s.Preferences.Backend, performanceFirst(s), part.draft, part.voice, part.emotion, path, func(code msg.Code, params msg.Params) { w.progress(code, params, 0, 1) }); e != nil {
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
			e = w.Store.Update(func(s *schema.State) {
				s.Previews = append(s.Previews, schema.CharacterPreview{ID: id, FileName: file, Duration: duration, Settings: d.SynthesisSettings, Text: d.Text})
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
		// YuE2 自己规划或纯音乐转谱时附带这次实际所用的旋律谱，存进这一版，之后可以载入编辑。
		if generatedScore != "" {
			snapshot.Abc = generatedScore
		}
		g := schema.Generation{ID: id, Title: d.Title, FileName: file, CreatedAt: time.Now().UTC(), Duration: duration, Settings: snapshot, Check: w.checkAudio(path, projectKind(d), id)}
		if e = w.Store.Update(func(s *schema.State) { s.History = append([]schema.Generation{g}, s.History...) }, true); e != nil {
			_ = os.Remove(path)
			return e
		}
		keep = true
		// 作品还没有谱时，把 YuE2 这次自己写的谱交给界面填入旋律谱，和“先写旋律谱”的结果一样处理。
		if generatedScore != "" && strings.TrimSpace(d.Abc) == "" {
			_ = w.offerMelody(d.ID, "plan", generatedScore, false)
		}
		diag.Log(w.Store.Root, "generation.saved", "project_id", d.ID, "generation_id", id, "model_id", part.model.ID, "duration", duration)
		if d.Kind == "" || d.Kind == "text" {
			w.pruneTextVersions(d.ID, textVersionLimit)
		}
		return nil
	}, previewID, d.ID)
}
