package workbench

import (
	"fmt"
	"os"
	"slices"
	"strings"
	"unicode"
)

func (w *Workbench) MediaFile(kind, id string) (string, error) {
	if !validID(id) {
		return "", Err(MsgErrAudioIDInvalid, nil)
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
		return "", Err(MsgErrAudioKindInvalid, nil)
	}
	if file == "" {
		return "", Err(MsgErrAudioMissing, nil)
	}
	return w.Store.MediaPath(kind, file)
}
func (w *Workbench) rename(kind, id, name string) error {
	if _, e := w.MediaFile(kind, id); e != nil {
		return e
	}
	name = strings.TrimSpace(name)
	if textLen(name) < 1 || textLen(name) > 120 || strings.ContainsFunc(name, unicode.IsControl) {
		return Err(MsgErrNameLength, nil)
	}
	return w.Store.Update(func(s *State) {
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
func (w *Workbench) deleteMedia(kind, id string) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	path, e := w.MediaFile(kind, id)
	if e != nil {
		return e
	}
	s := w.Store.Read()
	if kind == "outputs" && !slices.ContainsFunc(s.History, func(g Generation) bool { return g.ID == id }) {
		return Err(MsgErrAudioMissing, nil)
	}
	if kind == "voices" {
		users := s.voiceUsers(id)
		if len(users) > 0 {
			return Err(MsgErrVoiceReferenced, MessageParams{"names": strings.Join(users, "、")})
		}
	}
	if kind == "voices" && s.Activity != nil && s.Activity.Kind == "generate" && s.Activity.Status == "running" {
		return Err(MsgErrVoiceBusyDelete, nil)
	}
	if kind == "outputs" {
		for _, draft := range s.Drafts {
			if draft.Timeline == nil {
				continue
			}
			for _, track := range draft.Timeline.Tracks {
				if slices.ContainsFunc(track.Clips, func(c AudioClip) bool { return c.GenerationID == id }) {
					return Err(MsgErrTimelineInUse, nil)
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
	e = w.Store.Update(func(s *State) {
		if kind == "outputs" {
			s.History = slices.DeleteFunc(s.History, func(v Generation) bool { return v.ID == id })
		} else {
			s.Voices = slices.DeleteFunc(s.Voices, func(v Voice) bool { return v.ID == id })
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
				return Err(MsgErrUnknown, MessageParams{"detail": fmt.Sprintf("%v; restore failed: %v", e, restore)})
			}
		}
		return e
	}
	if exists {
		return os.Remove(removed)
	}
	return nil
}
