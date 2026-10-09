package workbench

import (
	"context"
	"os"
	"slices"
	"strings"
	"time"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
)

// PreviewCharacter 生成角色试听；试听只复用推理流程，不写入作品历史。
func (w *Workbench) PreviewCharacter(c schema.Character) (string, error) {
	if !schema.ValidID(c.ID) || schema.TextLen(c.DemoText) > 2000 {
		return "", msg.Err(msg.ErrCharacterInvalid, nil)
	}
	id := schema.NewID()
	return id, w.generateAudio(schema.Draft{ID: c.ID, Title: c.Name, Text: c.DemoText, SynthesisSettings: c.Settings}, id, "", "")
}

// SaveCharacter 保存角色与演绎方式；试听只接受服务端已知的音频。
func (w *Workbench) SaveCharacter(c schema.Character) (schema.Character, error) {
	if !schema.ValidID(c.ID) {
		return schema.Character{}, msg.Err(msg.ErrCharacterInvalid, nil)
	}
	w.edit.Lock()
	defer w.edit.Unlock()
	state := w.Store.Read()
	c.Name = strings.TrimSpace(c.Name)
	if c.Name == "" || schema.TextLen(c.Name) > 120 || schema.TextLen(c.DemoText) > 2000 {
		return schema.Character{}, msg.Err(msg.ErrCharacterInvalid, nil)
	}
	// 保存配置无需安装模型，生成时再检查运行环境和所需参考音频。
	text := c.DemoText
	if strings.TrimSpace(text) == "" {
		text = "试听"
	}
	if err := schema.Validate(schema.Draft{ID: c.ID, Title: c.Name, Text: text, SynthesisSettings: c.Settings}); err != nil {
		return schema.Character{}, err
	}
	for _, id := range []*string{c.Settings.VoiceID, c.Settings.EmotionVoiceID} {
		if id != nil && !slices.ContainsFunc(state.Voices, func(v schema.Voice) bool { return v.ID == *id }) {
			return schema.Character{}, msg.Err(msg.ErrVoiceRequired, nil)
		}
	}
	if len(c.Performances) > 32 {
		return schema.Character{}, msg.Err(msg.ErrCharacterInvalid, nil)
	}
	ids := map[string]bool{}
	names := map[string]bool{}
	for i := range c.Performances {
		p := &c.Performances[i]
		p.Name = strings.TrimSpace(p.Name)
		name := strings.ToLower(p.Name)
		if !schema.ValidID(p.ID) || p.Name == "" || schema.TextLen(p.Name) > 120 || ids[p.ID] || names[name] {
			return schema.Character{}, msg.Err(msg.ErrCharacterInvalid, nil)
		}
		ids[p.ID], names[name] = true, true
		p.Settings = c.Settings.PerformanceSettings(p)
		if err := schema.Validate(schema.Draft{ID: c.ID, Title: c.Name, Text: text, SynthesisSettings: p.Settings}); err != nil {
			return schema.Character{}, err
		}
		for _, id := range []*string{p.Settings.VoiceID, p.Settings.EmotionVoiceID} {
			if id != nil && !slices.ContainsFunc(state.Voices, func(v schema.Voice) bool { return v.ID == *id }) {
				return schema.Character{}, msg.Err(msg.ErrVoiceRequired, nil)
			}
		}
	}
	index := slices.IndexFunc(state.Characters, func(v schema.Character) bool { return v.ID == c.ID })
	c.CreatedAt = time.Now().UTC()
	var old *schema.CharacterPreview
	if index >= 0 {
		c.CreatedAt = state.Characters[index].CreatedAt
		old = state.Characters[index].Preview
	}
	c.UpdatedAt = time.Now().UTC()
	var copied string
	if c.Preview != nil {
		// 只接受服务端已知的试听 ID，不信任客户端提供的路径和参数快照。
		var found *schema.CharacterPreview
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
			return schema.Character{}, msg.Err(msg.ErrAudioMissing, nil)
		}
		if old != nil && old.ID == found.ID {
			c.Preview = old
		} else {
			src, err := w.Store.MediaPath("outputs", found.FileName)
			if err != nil {
				return schema.Character{}, err
			}
			b, err := os.ReadFile(src)
			if err != nil {
				return schema.Character{}, err
			}
			next := *found
			next.ID = schema.NewID()
			next.FileName = "character-" + next.ID + ".wav"
			copied, err = w.Store.MediaPath("outputs", next.FileName)
			if err != nil {
				return schema.Character{}, err
			}
			if err = os.WriteFile(copied, b, 0600); err != nil {
				return schema.Character{}, err
			}
			c.Preview = &next
		}
	}
	err := w.Store.Update(func(s *schema.State) {
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
		return schema.Character{}, err
	}
	if old != nil && (c.Preview == nil || old.ID != c.Preview.ID) {
		w.removePreviewFile(old)
	}
	return c, nil
}

func (w *Workbench) DeleteCharacter(id string) error {
	if !schema.ValidID(id) {
		return msg.Err(msg.ErrCharacterInvalid, nil)
	}
	w.edit.Lock()
	defer w.edit.Unlock()
	state := w.Store.Read()
	index := slices.IndexFunc(state.Characters, func(c schema.Character) bool { return c.ID == id })
	if index < 0 {
		return msg.Err(msg.ErrCharacterInvalid, nil)
	}
	if err := w.Store.Update(func(s *schema.State) { s.Characters = slices.Delete(s.Characters, index, index+1) }, true); err != nil {
		return err
	}
	w.removePreviewFile(state.Characters[index].Preview)
	return nil
}

// DiscardPreview 删除未保存的角色试听。
func (w *Workbench) DiscardPreview(id string) error {
	if !schema.ValidID(id) {
		return msg.Err(msg.ErrCharacterInvalid, nil)
	}
	w.edit.Lock()
	defer w.edit.Unlock()
	state := w.Store.Read()
	w.mu.Lock()
	busy := w.cancel != nil
	w.mu.Unlock()
	if busy {
		return msg.Err(msg.ErrBusy, nil)
	}
	if err := w.Store.Update(func(s *schema.State) {
		s.Previews = slices.DeleteFunc(s.Previews, func(v schema.CharacterPreview) bool { return v.ID == id })
	}, true); err != nil {
		return err
	}
	for _, v := range state.Previews {
		if v.ID == id {
			w.removePreviewFile(&v)
		}
	}
	return nil
}

// VoiceFromGeneration 将生成结果保存为参考音色，并记录来源。
func (w *Workbench) VoiceFromGeneration(id, name, referenceText string) (schema.Voice, error) {
	if !schema.ValidID(id) {
		return schema.Voice{}, msg.Err(msg.ErrCharacterInvalid, nil)
	}
	w.edit.Lock()
	defer w.edit.Unlock()
	state := w.Store.Read()
	index := slices.IndexFunc(state.History, func(g schema.Generation) bool { return g.ID == id })
	if index < 0 {
		return schema.Voice{}, msg.Err(msg.ErrAudioMissing, nil)
	}
	if strings.TrimSpace(name) == "" || schema.TextLen(name) > 100 || schema.TextLen(referenceText) > 2000 {
		return schema.Voice{}, msg.Err(msg.ErrCharacterInvalid, nil)
	}
	path, err := w.Store.MediaPath("outputs", state.History[index].FileName)
	if err != nil {
		return schema.Voice{}, err
	}
	return w.importVoice(context.Background(), path, name, referenceText, id)
}

func (w *Workbench) UpdateVoice(id, name, referenceText string) error {
	if !schema.ValidID(id) {
		return msg.Err(msg.ErrCharacterInvalid, nil)
	}
	w.edit.Lock()
	defer w.edit.Unlock()
	state := w.Store.Read()
	if strings.TrimSpace(name) == "" || schema.TextLen(name) > 100 || schema.TextLen(referenceText) > 2000 {
		return msg.Err(msg.ErrCharacterInvalid, nil)
	}
	index := slices.IndexFunc(state.Voices, func(v schema.Voice) bool { return v.ID == id })
	if index < 0 {
		return msg.Err(msg.ErrAudioMissing, nil)
	}
	return w.Store.Update(func(s *schema.State) {
		s.Voices[index].Name = strings.TrimSpace(name)
		s.Voices[index].ReferenceText = referenceText
	}, true)
}

func (w *Workbench) removePreviewFile(p *schema.CharacterPreview) {
	if p == nil {
		return
	}
	if path, err := w.Store.MediaPath("outputs", p.FileName); err == nil {
		_ = os.Remove(path)
	}
}
