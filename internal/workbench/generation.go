package workbench

import (
	"context"
	"os"
	"slices"
	"time"
)

func (w *Workbench) generate(d Draft) error { return w.generateAudio(d, "", "", "") }

func (w *Workbench) generateAudio(d Draft, previewID, cueID, clipID string) (err error) {
	diagnostic(w.Store.Root, "generation.requested", "project_id", d.ID, "model_id", d.ModelID, "cue_id", cueID, "clip_id", clipID, "preview_id", previewID)
	defer func() {
		if err != nil {
			diagnostic(w.Store.Root, "generation.rejected", "project_id", d.ID, "error", diagnosticError(err))
		}
	}()
	d.ensureCueIDs()
	original := d
	if cueID != "" {
		if d.Subtitles == nil {
			return Err(MsgErrSubtitleInvalid, nil)
		}
		i := slices.IndexFunc(d.Subtitles.Cues, func(c SubtitleCue) bool { return c.ID == cueID })
		if i < 0 {
			return Err(MsgErrSubtitleInvalid, nil)
		}
		if clipID != "" {
			found := false
			if d.Timeline != nil {
				for _, lane := range d.Timeline.Tracks {
					for _, clip := range lane.Clips {
						if clip.ID == clipID {
							if lane.Locked {
								return Err(MsgErrTimelineInvalid, nil)
							}
							found = true
						}
					}
				}
			}
			if !found {
				return Err(MsgErrTimelineInvalid, nil)
			}
		}
		document := *d.Subtitles
		document.Cues = []SubtitleCue{document.Cues[i]}
		d.Subtitles = &document
		d.Text = document.Cues[0].Text
	}
	s := w.Store.Read()
	parts, e := w.prepareSynthesis(d, s)
	if e != nil {
		return e
	}

	if s.RuntimePath == nil || value(s.RuntimeBackend) != s.Preferences.Backend {
		return Err(MsgErrRuntimeRequired, nil)
	}
	if previewID == "" {
		if e = w.SaveDraft(original); e != nil {
			return e
		}
	}
	return w.begin("generate", MsgActivityGenerate, nil, nil, func(ctx context.Context) error {
		if d.Subtitles != nil && previewID == "" {
			return w.generateSegments(ctx, s, parts, clipID)
		}
		id := newID()
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
		if e = w.engine.Generate(ctx, *s.RuntimePath, part.model, s.Preferences.Backend, part.draft, part.voice, part.emotion, path, func(code MessageCode, params MessageParams) { w.progress(code, params, 0, 1) }); e != nil {
			return e
		}
		duration, e := Duration(path)
		if e != nil {
			return e
		}
		if e = ctx.Err(); e != nil {
			return e
		}
		if previewID != "" {
			e = w.Store.Update(func(s *State) {
				s.Previews = append(s.Previews, CharacterPreview{ID: id, FileName: file, Duration: duration, Settings: d.SynthesisSettings, Text: d.Text})
			}, true)
			keep = e == nil
			if keep {
				diagnostic(w.Store.Root, "preview.saved", "preview_id", id, "model_id", part.model.ID, "duration", duration)
			}
			return e
		}
		g := Generation{ID: id, Title: d.Title, FileName: file, CreatedAt: time.Now().UTC(), Duration: duration, Settings: d}
		if e = w.Store.Update(func(s *State) { s.History = append([]Generation{g}, s.History...) }, true); e != nil {
			_ = os.Remove(path)
			return e
		}
		keep = true
		diagnostic(w.Store.Root, "generation.saved", "project_id", d.ID, "generation_id", id, "model_id", part.model.ID, "duration", duration)
		return nil
	}, previewID, d.ID)
}
