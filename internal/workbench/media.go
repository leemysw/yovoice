package workbench

import (
	"fmt"
	"os"
	"slices"
	"strings"
	"unicode"
	"yovoice/internal/domain"
	"yovoice/internal/msg"
)

func (w *Workbench) MediaFile(kind, id string) (string, error) {
	if !domain.ValidID(id) {
		return "", msg.Err(msg.ErrAudioIDInvalid, nil)
	}
	s := w.Store.Read()
	var file string
	switch kind {
	case "voices":
		for _, v := range s.Voices {
			if v.ID == id {
				file = v.FileName
			}
		}
	case "outputs":
		for _, c := range s.Characters {
			if c.Preview != nil && c.Preview.ID == id {
				file = c.Preview.FileName
			}
		}
		for _, p := range s.Previews {
			if p.ID == id {
				file = p.FileName
			}
		}
		for _, v := range s.History {
			if v.ID == id {
				file = v.FileName
			}
		}
	default:
		return "", msg.Err(msg.ErrAudioKindInvalid, nil)
	}
	if file == "" {
		return "", msg.Err(msg.ErrAudioMissing, nil)
	}
	return w.Store.MediaPath(kind, file)
}
func (w *Workbench) RenameMedia(kind, id, name string) error {
	if _, e := w.MediaFile(kind, id); e != nil {
		return e
	}
	name = strings.TrimSpace(name)
	if domain.TextLen(name) < 1 || domain.TextLen(name) > 120 || strings.ContainsFunc(name, unicode.IsControl) {
		return msg.Err(msg.ErrNameLength, nil)
	}
	return w.Store.Update(func(s *domain.State) {
		if kind == "voices" {
			for i := range s.Voices {
				if s.Voices[i].ID == id {
					s.Voices[i].Name = name
				}
			}
		} else {
			for i := range s.History {
				if s.History[i].ID == id {
					s.History[i].Title = name
				}
			}
		}
	}, true)
}
func (w *Workbench) DeleteMedia(kind, id string) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	path, e := w.MediaFile(kind, id)
	if e != nil {
		return e
	}
	s := w.Store.Read()
	if kind == "outputs" && !slices.ContainsFunc(s.History, func(g domain.Generation) bool { return g.ID == id }) {
		return msg.Err(msg.ErrAudioMissing, nil)
	}
	if kind == "voices" {
		users := s.VoiceUsers(id)
		if len(users) > 0 {
			return msg.Err(msg.ErrVoiceReferenced, msg.Params{"names": strings.Join(users, "、")})
		}
	}
	if kind == "voices" && s.Activity != nil && s.Activity.Kind == "generate" && s.Activity.Status == "running" {
		return msg.Err(msg.ErrVoiceBusyDelete, nil)
	}
	if kind == "outputs" {
		for _, draft := range s.Drafts {
			if draft.Timeline == nil {
				continue
			}
			for _, track := range draft.Timeline.Tracks {
				if slices.ContainsFunc(track.Clips, func(c domain.AudioClip) bool { return c.GenerationID == id }) {
					return msg.Err(msg.ErrTimelineInUse, nil)
				}
			}
		}
	}
	removed := path + ".deleted"
	_, e = os.Stat(path)
	exists := e == nil
	if e != nil && !os.IsNotExist(e) {
		return e
	}
	if exists {
		if e = os.Rename(path, removed); e != nil {
			return e
		}
	}
	e = w.Store.Update(func(s *domain.State) {
		if kind == "outputs" {
			s.History = slices.DeleteFunc(s.History, func(v domain.Generation) bool { return v.ID == id })
		} else {
			s.Voices = slices.DeleteFunc(s.Voices, func(v domain.Voice) bool { return v.ID == id })
			for i := range s.Drafts {
				if value(s.Drafts[i].VoiceID) == id {
					s.Drafts[i].VoiceID = nil
				}
				if value(s.Drafts[i].EmotionVoiceID) == id {
					s.Drafts[i].EmotionVoiceID = nil
				}
			}
		}
	}, true)
	if e != nil {
		if exists {
			if restore := os.Rename(removed, path); restore != nil {
				return msg.Err(msg.ErrUnknown, msg.Params{"detail": fmt.Sprintf("%v; restore failed: %v", e, restore)})
			}
		}
		return e
	}
	if exists {
		return os.Remove(removed)
	}
	return nil
}
