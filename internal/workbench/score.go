package workbench

import (
	"context"
	"os"
	"slices"
	"time"
	"yovoice/internal/audio"
	"yovoice/internal/diag"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
	"yovoice/internal/score"
)

// startScore 渲染编曲作品：不经过推理引擎，只需要已安装的音色库。要求调用方持有编辑锁。
func (w *Workbench) startScore(d schema.Draft, saveDraft bool) (<-chan struct{}, error) {
	if e := schema.Validate(d); e != nil {
		return nil, e
	}
	s := w.Store.Read()
	i := slices.IndexFunc(s.Models, func(m schema.InstalledModel) bool { return m.ID == d.ModelID })
	if i < 0 {
		return nil, msg.Err(msg.ErrModelRequired, nil)
	}
	soundFont := s.Models[i].Path
	if _, e := os.Stat(soundFont); e != nil {
		return nil, msg.Err(msg.ErrModelMoved, nil)
	}
	if saveDraft {
		if e := w.saveDraft(d); e != nil {
			return nil, e
		}
	}
	return w.start("generate", msg.ActivityGenerate, nil, nil, func(ctx context.Context) error {
		sf, e := score.LoadSoundFont(soundFont)
		if e != nil {
			return msg.Err(msg.ErrModelMoved, nil)
		}
		id := schema.NewID()
		file := id + ".wav"
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
		e = score.Render(ctx, sf, *d.Score, path, "", func(done, total int) {
			w.progress(msg.ActivityRendering, msg.Params{"done": done, "total": total}, int64(done), int64(total))
		})
		if e != nil {
			return e
		}
		duration, e := audio.Duration(path)
		if e != nil {
			return e
		}
		if e = ctx.Err(); e != nil {
			return e
		}
		g := schema.Generation{ID: id, Title: d.Title, FileName: file, CreatedAt: time.Now().UTC(), Duration: duration, Settings: d}
		if e = w.Store.Update(func(s *schema.State) { s.History = append([]schema.Generation{g}, s.History...) }, true); e != nil {
			return e
		}
		keep = true
		diag.Log(w.Store.Root, "score.rendered", "project_id", d.ID, "generation_id", id, "tracks", len(d.Score.Tracks), "duration", duration)
		return nil
	}, "", d.ID)
}
