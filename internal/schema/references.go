package schema

// VoiceUsers 检查素材的使用范围；已生成的历史版本为独立文件，不作为阻断。
func (s State) VoiceUsers(id string) []string {
	uses := func(settings SynthesisSettings) bool {
		return Deref(settings.VoiceID) == id || Deref(settings.EmotionVoiceID) == id
	}
	draftUses := func(d Draft) bool {
		for _, settings := range d.VisibleSettings() {
			if uses(settings) {
				return true
			}
		}
		return false
	}
	var names []string
	for _, c := range s.Characters {
		used := uses(c.Settings)
		for _, p := range c.Performances {
			used = used || uses(p.Settings)
		}
		if c.Preview != nil {
			used = used || uses(c.Preview.Settings)
		}
		if used {
			names = append(names, c.Name)
		}
	}
	for _, d := range s.Drafts {
		if draftUses(d) {
			names = append(names, d.Title)
		}
	}
	return names
}

// allSettings 包含台词演绎快照，用于素材引用保护和作品归档。
func (d Draft) AllSettings() []SynthesisSettings {
	settings := []SynthesisSettings{d.SynthesisSettings}
	if d.Performance != nil {
		settings = append(settings, d.Performance.Settings)
	}
	if d.Subtitles != nil {
		for _, s := range d.Subtitles.Speakers {
			if s.Settings != nil {
				settings = append(settings, *s.Settings)
			}
		}
		for _, c := range d.Subtitles.Cues {
			if c.Performance != nil {
				settings = append(settings, c.Performance.Settings)
			}
		}
	}
	return settings
}

// VisibleSettings 只返回界面上可见、可修改的设置。
// 字幕作品的每个说话人都有独立设置时，作品级设置与演绎快照不再生效且界面不展示，
// 若仍据此阻止删除素材，用户将找不到可修改的位置；删除素材时会顺带清理这些隐藏引用。
func (d Draft) VisibleSettings() []SynthesisSettings {
	if !d.BaseSettingsHidden() {
		return d.AllSettings()
	}
	settings := []SynthesisSettings{}
	for _, s := range d.Subtitles.Speakers {
		settings = append(settings, *s.Settings)
	}
	for _, c := range d.Subtitles.Cues {
		if c.Performance != nil {
			settings = append(settings, c.Performance.Settings)
		}
	}
	return settings
}

// BaseSettingsHidden 表示作品级设置已被所有说话人的独立设置覆盖。
func (d Draft) BaseSettingsHidden() bool {
	if d.Subtitles == nil || len(d.Subtitles.Speakers) == 0 {
		return false
	}
	for _, s := range d.Subtitles.Speakers {
		if s.Settings == nil {
			return false
		}
	}
	return true
}

// EachSettings 遍历作品内所有可写的合成设置（含隐藏设置），用于清理引用。
func (d *Draft) EachSettings(fn func(*SynthesisSettings)) {
	fn(&d.SynthesisSettings)
	if d.Performance != nil {
		fn(&d.Performance.Settings)
	}
	if d.Subtitles != nil {
		for i := range d.Subtitles.Speakers {
			if d.Subtitles.Speakers[i].Settings != nil {
				fn(d.Subtitles.Speakers[i].Settings)
			}
		}
		for i := range d.Subtitles.Cues {
			if d.Subtitles.Cues[i].Performance != nil {
				fn(&d.Subtitles.Cues[i].Performance.Settings)
			}
		}
	}
}

// EachSettings 遍历角色内所有合成设置。
func (c *Character) EachSettings(fn func(*SynthesisSettings)) {
	fn(&c.Settings)
	for i := range c.Performances {
		fn(&c.Performances[i].Settings)
	}
	if c.Preview != nil {
		fn(&c.Preview.Settings)
	}
}
