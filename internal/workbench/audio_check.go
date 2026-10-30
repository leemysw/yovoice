package workbench

import (
	"yovoice/internal/audio"
	"yovoice/internal/diag"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
)

// checkAudio 体检刚生成的音频。测量失败不影响生成结果，只记日志并返回 nil。
// 人声（语音、故事配音）还检查截断、长静音和咔哒声；音乐与音效只查削波、无声、过小和直流偏移。
func (w *Workbench) checkAudio(path, kind, id string) *schema.AudioCheck {
	check, e := audio.Inspect(path, kind != "music" && kind != "sfx")
	if e != nil {
		diag.Log(w.Store.Root, "audio.check_failed", "generation_id", id, "error", diag.Error(e))
		return nil
	}
	if len(check.Issues) > 0 {
		codes := make([]string, len(check.Issues))
		for i, issue := range check.Issues {
			codes[i] = issue.Code
		}
		diag.Log(w.Store.Root, "audio.check_warning", "generation_id", id, "issues", codes, "loudness", check.Loudness, "peak", check.Peak)
	}
	return &check
}

// CheckGeneration 返回某个生成版本的体检结果；旧版本还没有结果时现场测量并保存。
func (w *Workbench) CheckGeneration(id string) (schema.AudioCheck, error) {
	s := w.Store.Read()
	for _, g := range s.History {
		if g.ID != id {
			continue
		}
		if g.Check != nil {
			return *g.Check, nil
		}
		path, e := w.MediaFile("outputs", id)
		if e != nil {
			return schema.AudioCheck{}, e
		}
		check := w.checkAudio(path, projectKind(g.Settings), id)
		if check == nil {
			return schema.AudioCheck{}, msg.Err(msg.ErrAudioFormat, nil)
		}
		w.edit.Lock()
		defer w.edit.Unlock()
		return *check, w.Store.Update(func(s *schema.State) {
			for i := range s.History {
				if s.History[i].ID == id {
					s.History[i].Check = check
				}
			}
		}, true)
	}
	return schema.AudioCheck{}, msg.Err(msg.ErrAudioMissing, nil)
}
