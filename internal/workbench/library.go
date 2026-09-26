package workbench

import (
	"context"
	"encoding/json"
	"os"
	"slices"
	"strings"
	"time"
)

// libraryCall 管理角色与参考素材；试听只复用推理流程，不写入作品历史。
func (w *Workbench) libraryCall(method string, data json.RawMessage) (any, error) {
	if method == "character.preview" {
		var c Character
		if err := json.Unmarshal(data, &c); err != nil {
			return nil, err
		}
		if !validID(c.ID) || textLen(c.DemoText) > 2000 {
			return nil, Err(MsgErrCharacterInvalid, nil)
		}
		id := newID()
		return id, w.generateAudio(Draft{ID: c.ID, Title: c.Name, Text: c.DemoText, SynthesisSettings: c.Settings}, id)
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	var p struct {
		ID            string `json:"id"`
		Name          string `json:"name"`
		ReferenceText string `json:"referenceText"`
	}
	if err := json.Unmarshal(data, &p); err != nil {
		return nil, err
	}
	if !validID(p.ID) {
		return nil, Err(MsgErrCharacterInvalid, nil)
	}
	state := w.Store.Read()
	switch method {
	case "character.save":
		var c Character
		if err := json.Unmarshal(data, &c); err != nil {
			return nil, err
		}
		c.Name = strings.TrimSpace(c.Name)
		if c.Name == "" || textLen(c.Name) > 120 || textLen(c.DemoText) > 2000 {
			return nil, Err(MsgErrCharacterInvalid, nil)
		}
		// 保存配置无需安装模型，生成时再检查运行环境和所需参考音频。
		text := c.DemoText
		if strings.TrimSpace(text) == "" {
			text = "试听"
		}
		if err := Validate(Draft{ID: c.ID, Title: c.Name, Text: text, SynthesisSettings: c.Settings}); err != nil {
			return nil, err
		}
		for _, id := range []*string{c.Settings.VoiceID, c.Settings.EmotionVoiceID} {
			if id != nil && !slices.ContainsFunc(state.Voices, func(v Voice) bool { return v.ID == *id }) {
				return nil, Err(MsgErrVoiceRequired, nil)
			}
		}
		index := slices.IndexFunc(state.Characters, func(v Character) bool { return v.ID == c.ID })
		c.CreatedAt = time.Now().UTC()
		var old *CharacterPreview
		if index >= 0 {
			c.CreatedAt = state.Characters[index].CreatedAt
			old = state.Characters[index].Preview
		}
		c.UpdatedAt = time.Now().UTC()
		var copied string
		if c.Preview != nil {
			// 只接受服务端已知的试听 ID，不信任客户端提供的路径和参数快照。
			var found *CharacterPreview
			for _, v := range state.Previews {
				if v.ID == c.Preview.ID {
					found = &v
					break
				}
			}
			for _, v := range state.Characters {
				if v.Preview != nil && v.Preview.ID == c.Preview.ID {
					found = v.Preview
					break
				}
			}
			if found == nil {
				return nil, Err(MsgErrAudioMissing, nil)
			}
			if old != nil && old.ID == found.ID {
				c.Preview = old
			} else {
				src, err := w.Store.MediaPath("outputs", found.FileName)
				if err != nil {
					return nil, err
				}
				b, err := os.ReadFile(src)
				if err != nil {
					return nil, err
				}
				next := *found
				next.ID = newID()
				next.FileName = "character-" + next.ID + ".wav"
				copied, err = w.Store.MediaPath("outputs", next.FileName)
				if err != nil {
					return nil, err
				}
				if err = os.WriteFile(copied, b, 0600); err != nil {
					return nil, err
				}
				c.Preview = &next
			}
		}
		err := w.Store.Update(func(s *State) {
			if index < 0 {
				s.Characters = append(s.Characters, c)
			} else {
				s.Characters[index] = c
			}
		}, true)
		if err != nil {
			if copied != "" {
				_ = os.Remove(copied)
			}
			return nil, err
		}
		if old != nil && (c.Preview == nil || old.ID != c.Preview.ID) {
			w.removePreviewFile(old)
		}
		return c, nil
	case "character.delete":
		index := slices.IndexFunc(state.Characters, func(c Character) bool { return c.ID == p.ID })
		if index < 0 {
			return nil, Err(MsgErrCharacterInvalid, nil)
		}
		if err := w.Store.Update(func(s *State) { s.Characters = slices.Delete(s.Characters, index, index+1) }, true); err != nil {
			return nil, err
		}
		w.removePreviewFile(state.Characters[index].Preview)
	case "character.discardPreview":
		if w.cancel != nil {
			return nil, Err(MsgErrBusy, nil)
		}
		if err := w.Store.Update(func(s *State) {
			s.Previews = slices.DeleteFunc(s.Previews, func(v CharacterPreview) bool { return v.ID == p.ID })
		}, true); err != nil {
			return nil, err
		}
		for _, v := range state.Previews {
			if v.ID == p.ID {
				w.removePreviewFile(&v)
			}
		}
	case "voice.fromGeneration":
		index := slices.IndexFunc(state.History, func(g Generation) bool { return g.ID == p.ID })
		if index < 0 {
			return nil, Err(MsgErrAudioMissing, nil)
		}
		if strings.TrimSpace(p.Name) == "" || textLen(p.Name) > 100 || textLen(p.ReferenceText) > 2000 {
			return nil, Err(MsgErrCharacterInvalid, nil)
		}
		path, err := w.Store.MediaPath("outputs", state.History[index].FileName)
		if err != nil {
			return nil, err
		}
		return w.importVoice(context.Background(), path, p.Name, p.ReferenceText, p.ID)
	case "voice.update":
		if strings.TrimSpace(p.Name) == "" || textLen(p.Name) > 100 || textLen(p.ReferenceText) > 2000 {
			return nil, Err(MsgErrCharacterInvalid, nil)
		}
		index := slices.IndexFunc(state.Voices, func(v Voice) bool { return v.ID == p.ID })
		if index < 0 {
			return nil, Err(MsgErrAudioMissing, nil)
		}
		return true, w.Store.Update(func(s *State) {
			s.Voices[index].Name = strings.TrimSpace(p.Name)
			s.Voices[index].ReferenceText = p.ReferenceText
		}, true)
	}
	return true, nil
}

func (w *Workbench) removePreviewFile(p *CharacterPreview) {
	if p == nil {
		return
	}
	if path, err := w.Store.MediaPath("outputs", p.FileName); err == nil {
		_ = os.Remove(path)
	}
}
