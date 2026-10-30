package workbench

import (
	"math"
	"os"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
)

func (w *Workbench) MediaFile(kind, id string) (string, error) {
	if !schema.ValidID(id) {
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
	w.edit.Lock()
	defer w.edit.Unlock()
	if _, e := w.MediaFile(kind, id); e != nil {
		return e
	}
	name = strings.TrimSpace(name)
	if schema.TextLen(name) < 1 || schema.TextLen(name) > 120 || strings.ContainsFunc(name, unicode.IsControl) {
		return msg.Err(msg.ErrNameLength, nil)
	}
	return w.Store.Update(func(s *schema.State) {
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

// 校准歌词最多记录的行数，与正文长度上限同一量级。
const maxLyricTimes = 2000

// SetLyricTimes 保存播放页校准的歌词时间：每行的开始秒数，按顺序不减，不超过音频时长；空列表清除校准和逐字对齐，恢复自动定位。
func (w *Workbench) SetLyricTimes(id string, times []float64) error {
	w.edit.Lock()
	defer w.edit.Unlock()
	if _, e := w.MediaFile("outputs", id); e != nil {
		return e
	}
	i := slices.IndexFunc(w.Store.Read().History, func(g schema.Generation) bool { return g.ID == id })
	if i < 0 {
		return msg.Err(msg.ErrAudioMissing, nil)
	}
	duration := w.Store.Read().History[i].Duration
	if len(times) > maxLyricTimes {
		return msg.Err(msg.ErrRequestInvalid, nil)
	}
	for j, t := range times {
		if math.IsNaN(t) || t < 0 || t > duration+1 || (j > 0 && t < times[j-1]) {
			return msg.Err(msg.ErrRequestInvalid, nil)
		}
	}
	return w.Store.Update(func(s *schema.State) {
		for i := range s.History {
			if s.History[i].ID == id {
				// 手动校准比之前的逐字对齐新，两者只留一份；清除时一并清掉。
				s.History[i].LyricTimes = slices.Clone(times)
				s.History[i].LyricWords = nil
				if len(times) == 0 {
					s.History[i].LyricTimes = nil
				}
			}
		}
	}, true)
}

// 手动编辑的逐字时间最多记录的字数，单字长度上限防止把整段正文塞进一个字。
const maxLyricWords, maxLyricWordRunes = 20000, 64

// SetLyricWords 保存播放页逐字编辑的时间：每个字的开始与结束秒数，开始不减，结束不早于开始，不超过音频时长。
// 与对齐模型的结果一样写进 LyricWords 并替换逐行校准。
func (w *Workbench) SetLyricWords(id string, words []schema.LyricWord) error {
	w.edit.Lock()
	defer w.edit.Unlock()
	if _, e := w.MediaFile("outputs", id); e != nil {
		return e
	}
	i := slices.IndexFunc(w.Store.Read().History, func(g schema.Generation) bool { return g.ID == id })
	if i < 0 {
		return msg.Err(msg.ErrAudioMissing, nil)
	}
	duration := w.Store.Read().History[i].Duration
	if len(words) == 0 || len(words) > maxLyricWords {
		return msg.Err(msg.ErrRequestInvalid, nil)
	}
	for j, word := range words {
		if word.Word == "" || utf8.RuneCountInString(word.Word) > maxLyricWordRunes || math.IsNaN(word.Start) || math.IsNaN(word.End) || word.Start < 0 || word.End < word.Start || word.End > duration+1 || (j > 0 && word.Start < words[j-1].Start) {
			return msg.Err(msg.ErrRequestInvalid, nil)
		}
	}
	return w.Store.Update(func(s *schema.State) {
		for i := range s.History {
			if s.History[i].ID == id {
				s.History[i].LyricWords, s.History[i].LyricTimes = slices.Clone(words), nil
			}
		}
	}, true)
}
func (w *Workbench) DeleteMedia(kind, id string) error {
	w.edit.Lock()
	defer w.edit.Unlock()
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
		for _, v := range s.History {
			if v.ID == id {
				file = v.FileName
			}
		}
	default:
		return msg.Err(msg.ErrAudioKindInvalid, nil)
	}
	if file == "" {
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
				if slices.ContainsFunc(track.Clips, func(c schema.AudioClip) bool { return c.GenerationID == id }) {
					return msg.Err(msg.ErrTimelineInUse, nil)
				}
			}
		}
	}
	path, pathErr := w.Store.MediaPath(kind, file)
	var removed string
	exists := false
	if pathErr == nil {
		if _, statErr := os.Lstat(path); statErr == nil {
			exists = true
			removed = path + ".deleted"
			if e := os.Rename(path, removed); e != nil {
				if delErr := os.Remove(path); delErr == nil {
					exists = false
				} else {
					return e
				}
			}
		}
	}
	e := w.Store.Update(func(s *schema.State) {
		if kind == "outputs" {
			s.History = slices.DeleteFunc(s.History, func(v schema.Generation) bool { return v.ID == id })
			// 一并清掉指向这条生成的记录：时间轴的已采纳标记、由它保存出的声音的来源。
			for i := range s.Drafts {
				if t := s.Drafts[i].Timeline; t != nil {
					t.AcceptedGenerations = slices.DeleteFunc(t.AcceptedGenerations, func(g string) bool { return g == id })
				}
			}
			for i := range s.Voices {
				if s.Voices[i].SourceGenerationID == id {
					s.Voices[i].SourceGenerationID = ""
				}
			}
		} else {
			s.Voices = slices.DeleteFunc(s.Voices, func(v schema.Voice) bool { return v.ID == id })
			// 可见引用已在前面阻止删除，这里清理的是被说话人设置覆盖的隐藏引用，避免留下悬空 ID。
			for i := range s.Drafts {
				s.Drafts[i].EachSettings(func(settings *schema.SynthesisSettings) { clearVoice(settings, id) })
			}
			for i := range s.History {
				if schema.Deref(s.History[i].Settings.VoiceID) == id {
					s.History[i].Settings.VoiceID = nil
				}
				if schema.Deref(s.History[i].Settings.EmotionVoiceID) == id {
					s.History[i].Settings.EmotionVoiceID = nil
				}
			}
		}
	}, true)
	if e != nil {
		if exists && removed != "" {
			_ = os.Rename(removed, path)
		}
		return e
	}
	if exists && removed != "" {
		// 同一文件仍被其他记录引用（例如复制作品共享的素材）时放回原处，否则删除。
		if w.Store.Read().MediaRefs()[kind][file] {
			_ = os.Rename(removed, path)
		} else {
			_ = os.Remove(removed)
		}
	}
	return nil
}
