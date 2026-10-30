package workbench

import (
	"context"
	"os"
	"slices"
	"strings"
	"time"
	"yovoice/internal/audio"
	"yovoice/internal/catalog"
	"yovoice/internal/diag"
	"yovoice/internal/engine"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
)

type synthesisPart struct {
	draft   schema.Draft
	model   schema.InstalledModel
	voice   string
	emotion string
	segment *schema.GenerationSegment
}

// prepareSynthesis 在启动前检查所有句子，避免生成到一半才发现角色缺少模型或音色。
func (w *Workbench) prepareSynthesis(d schema.Draft, state schema.State) ([]synthesisPart, error) {
	drafts, err := d.SubtitleDrafts()
	if err != nil {
		return nil, err
	}
	parts := make([]synthesisPart, 0, len(drafts))
	for index, draft := range drafts {
		if d.Subtitles != nil && strings.TrimSpace(draft.Text) == "" {
			continue
		}
		if err = schema.Validate(draft); err != nil {
			return nil, err
		}
		modelIndex := slices.IndexFunc(state.Models, func(m schema.InstalledModel) bool { return m.ID == draft.ModelID })
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
			part.segment = &schema.GenerationSegment{CueID: cue.ID, SpeakerID: cue.SpeakerID, SpeakerName: name, Index: index, Placement: "ripple"}
		}
		if draft.RequiresVoice() {
			part.voice, err = w.MediaFile("voices", schema.Deref(draft.VoiceID))
			if err != nil {
				return nil, msg.Err(msg.ErrVoiceRequired, nil)
			}
		}
		if draft.EmotionVoiceID != nil {
			part.emotion, _ = w.MediaFile("voices", *draft.EmotionVoiceID)
		}
		// Stable Audio 改编时，起点版本的音频走参考音频的位置传给内核。
		if source, err := w.stableAudioSource(&draft, state); err != nil {
			return nil, err
		} else if source != "" {
			part.voice = source
		}
		part.draft = draft
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

// stableAudioSource 处理 Stable Audio 作品：生成结果没有人声，版本记为纯音乐；
// 改编时返回起点版本的音频路径，起点必须是同一作品已生成且文件仍在的版本。
func (w *Workbench) stableAudioSource(d *schema.Draft, state schema.State) (string, error) {
	m, err := catalog.Lookup(d.ModelID)
	if err != nil || m.Family != "stable_audio" {
		return "", nil
	}
	d.Instrumental = true
	if edit, _ := d.ModelOptions["stable_audio"]["edit"].(string); edit == "" || edit == "off" {
		return "", nil
	}
	for _, g := range state.History {
		if g.ID == d.SourceGenerationID && g.Settings.ID == d.ID && g.Segment == nil {
			if path, err := w.Store.MediaPath("outputs", g.FileName); err == nil {
				if _, err = os.Stat(path); err == nil {
					return path, nil
				}
			}
		}
	}
	return "", msg.Err(msg.ErrMusicSourceRequired, nil)
}

// generateSegments 逐句落盘。取消或失败保留已经完成的句子，不创建合并文件。
func (w *Workbench) generateSegments(ctx context.Context, state schema.State, parts []synthesisPart, targetClipID string) error {
	batch := schema.NewID()
	for index, part := range parts {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := w.Store.Update(func(s *schema.State) {
			if s.Activity != nil {
				s.Activity.CueID = part.segment.CueID
			}
		}, false); err != nil {
			return err
		}
		id := schema.NewID()
		file := outputFileName(id, time.Now(), part.draft.Text)
		path, err := w.Store.MediaPath("outputs", file)
		if err != nil {
			return err
		}
		diag.Log(w.Store.Root, "segment.started", "project_id", part.draft.ID, "batch_id", batch, "cue_id", part.segment.CueID, "generation_id", id, "model_id", part.model.ID, "index", index)
		_, err = w.engine.Generate(ctx, *state.RuntimePath, part.model, state.Preferences.Backend, performanceFirst(state), part.draft, part.voice, part.emotion, path, func(_ msg.Code, _ msg.Params) {
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
		g := schema.Generation{ID: id, Title: string(title), FileName: file, CreatedAt: time.Now().UTC(), Duration: duration, Settings: snapshot, Segment: part.segment, Check: w.checkAudio(path, "story", id)}
		if err = w.Store.Update(func(s *schema.State) { s.History = append([]schema.Generation{g}, s.History...) }, true); err != nil {
			_ = os.Remove(path)
			return err
		}
		diag.Log(w.Store.Root, "segment.saved", "project_id", part.draft.ID, "batch_id", batch, "cue_id", part.segment.CueID, "generation_id", id, "duration", duration)
	}
	return nil
}
