package workbench

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"yovoice/internal/schema"
	"yovoice/internal/score"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// updateWorkInput 是作品补丁：只改给出的字段，全部经 SaveDraft 的校验落盘。
type updateWorkInput struct {
	ID              string               `json:"id" jsonschema:"作品 ID"`
	Title           *string              `json:"title,omitempty" jsonschema:"标题"`
	Text            *string              `json:"text,omitempty" jsonschema:"台词或正文（语音/故事）；音乐、音效作品是英文描述"`
	Lyrics          *string              `json:"lyrics,omitempty" jsonschema:"歌词，段落标记独占一行；纯音乐时只允许段落标记"`
	Instrumental    *bool                `json:"instrumental,omitempty" jsonschema:"纯音乐（无演唱）"`
	Language        *string              `json:"language,omitempty" jsonschema:"音乐作品的演唱语言 ISO 代码，如 zh、en"`
	ModelID         *string              `json:"modelId,omitempty" jsonschema:"模型 ID，先用 list_models 确认已安装"`
	VoiceID         *string              `json:"voiceId,omitempty" jsonschema:"参考音色 ID，先用 list_voices 查询；传空字符串表示清除"`
	Speed           *float64             `json:"speed,omitempty" jsonschema:"语速 0.5-2"`
	Seed            *int                 `json:"seed,omitempty" jsonschema:"随机种子"`
	Subtitles       *workSubtitles       `json:"subtitles,omitempty" jsonschema:"故事配音的角色与台词，整体替换"`
	SpeakerVoices   []workSpeakerVoice   `json:"speakerVoices,omitempty" jsonschema:"按角色分配参考音色"`
	Score           *scoreInput          `json:"score,omitempty" jsonschema:"完整乐谱（编曲），与写谱任务同一套校验"`
	Settings        *voiceSettingsInput  `json:"settings,omitempty" jsonschema:"右侧检查器的全部声音设置与高级参数，只改给出的项；与同名的顶层字段同时给出时以这里为准"`
	CharacterID     *string              `json:"characterId,omitempty" jsonschema:"套用声音库里的角色（list_characters）：作品改用该角色的声音设置；空字符串解除关联"`
	SpeakerSettings []workSpeakerSetting `json:"speakerSettings,omitempty" jsonschema:"故事配音：给指定角色套用声音库角色或单独改声音设置"`
	Abc             *string              `json:"abc,omitempty" jsonschema:"YuE2 音乐作品的旋律谱（原生 ABC 方言，见 yovoice-music skill），整体替换；空字符串清除"`
}

func (w *Workbench) updateWorkTool(ctx context.Context, req *mcp.CallToolRequest, in updateWorkInput) (*mcp.CallToolResult, any, error) {
	d, err := w.assistantWork(in.ID)
	if err != nil {
		return nil, nil, err
	}
	kind := projectKind(d)
	// 按内容、声音、故事配音、乐谱四组依次打补丁；任一组校验失败就整体放弃，不落盘。
	changed, err := patchWorkContent(&d, in)
	if err != nil {
		return nil, nil, err
	}
	patched, err := w.patchWorkVoice(&d, in, kind)
	if err != nil {
		return nil, nil, err
	}
	changed = append(changed, patched...)
	if patched, err = w.patchWorkStory(&d, in, kind); err != nil {
		return nil, nil, err
	}
	changed = append(changed, patched...)
	patched, melodyChanges, err := patchWorkScore(&d, in, kind)
	if err != nil {
		return nil, nil, err
	}
	changed = append(changed, patched...)
	if len(changed) == 0 {
		return nil, nil, fmt.Errorf("没有要修改的字段")
	}
	if (in.Settings != nil || in.CharacterID != nil || len(in.SpeakerSettings) > 0) && (kind == "text" || kind == "story") {
		if e := voiceSettingsError(d); e != nil {
			return nil, nil, e
		}
	}
	w.edit.Lock()
	err = w.saveDraft(d)
	w.edit.Unlock()
	if err != nil {
		return nil, nil, err
	}
	// 助手填入了谱：等待中的出谱或扒谱结果已经用掉，界面不再询问是否替换。
	if in.Abc != nil {
		if m := w.Store.Read().Melody; m != nil && m.ProjectID == d.ID {
			_ = w.DismissMelody(m.ID)
		}
	}
	w.chatCard("update_work", fmt.Sprintf("修改了《%s》的%s", d.Title, strings.Join(changed, "、")), fmt.Sprintf("Updated %q: %s", d.Title, strings.Join(changed, ", ")), "done")
	w.chatUpdate(d.ID)
	summary := map[string]any{"id": d.ID, "title": d.Title, "changed": changed}
	if in.Score != nil && d.Score != nil {
		notes := 0
		for _, track := range d.Score.Tracks {
			notes += len(track.Notes)
		}
		summary["tracks"], summary["notes"] = len(d.Score.Tracks), notes
	}
	if melodyChanges != nil {
		summary["melodyChanges"] = melodyChanges
	}
	return nil, summary, nil
}

// patchWorkContent 修改标题、文本、纯音乐、歌词与演唱语言，返回改动的字段名。
func patchWorkContent(d *schema.Draft, in updateWorkInput) ([]string, error) {
	var changed []string
	if in.Title != nil {
		d.Title = schema.TruncateRunes(strings.TrimSpace(*in.Title), 120)
		changed = append(changed, "标题")
	}
	if in.Text != nil {
		d.Text = *in.Text
		changed = append(changed, "文本")
	}
	if in.Instrumental != nil {
		d.Instrumental = *in.Instrumental
		changed = append(changed, "纯音乐")
	}
	if in.Lyrics != nil {
		d.Lyrics = schema.TruncateRunes(*in.Lyrics, 4000)
		if d.Instrumental {
			for _, line := range strings.Split(d.Lyrics, "\n") {
				line = strings.TrimSpace(line)
				if line == "" {
					continue
				}
				if !strings.HasPrefix(line, "[") || !strings.HasSuffix(line, "]") {
					return nil, fmt.Errorf("instrumental lyrics may contain section markers only (lines like [verse]), found %q", line)
				}
			}
		}
		changed = append(changed, "歌词")
	}
	if in.Language != nil {
		language := strings.TrimSpace(*in.Language)
		if language != "" && !slices.Contains(schema.MusicLanguages, language) {
			return nil, fmt.Errorf("不支持的演唱语言 %s，可用：%s", language, strings.Join(schema.MusicLanguages, ", "))
		}
		d.SynthesisLanguage = language
		changed = append(changed, "演唱语言")
	}
	return changed, nil
}

// patchWorkVoice 修改模型、音色、语速、种子，套用声音库角色，以及检查器里的声音设置与高级参数。
func (w *Workbench) patchWorkVoice(d *schema.Draft, in updateWorkInput, kind string) ([]string, error) {
	var changed []string
	if in.ModelID != nil {
		model := strings.TrimSpace(*in.ModelID)
		if model != "" {
			if e := w.assistantModelCheck(model, kind); e != nil {
				return nil, e
			}
		}
		d.ModelID = model
		changed = append(changed, "模型")
	}
	if in.VoiceID != nil {
		if voice := strings.TrimSpace(*in.VoiceID); voice != "" && !w.voiceExists(voice) {
			return nil, fmt.Errorf("没有找到参考音色 %s，请先用 list_voices 查询", voice)
		}
		d.VoiceID = stringPtr(*in.VoiceID)
		changed = append(changed, "音色")
	}
	if in.Speed != nil {
		d.Speed = *in.Speed
		changed = append(changed, "语速")
	}
	if in.Seed != nil {
		d.Seed = in.Seed
		changed = append(changed, "种子")
	}
	if in.CharacterID != nil {
		if kind == "music" || kind == "sfx" || kind == "score" {
			return nil, fmt.Errorf("characterId 只适用于语音和故事配音作品，这个作品是 %s", kind)
		}
		if id := strings.TrimSpace(*in.CharacterID); id == "" {
			d.CharacterID = ""
		} else {
			characters := w.Store.Read().Characters
			index := slices.IndexFunc(characters, func(c schema.Character) bool { return c.ID == id })
			if index < 0 {
				return nil, fmt.Errorf("没有找到角色 %s，请先用 list_characters 查看", id)
			}
			applyCharacterToWork(d, characters[index])
		}
		changed = append(changed, "角色")
	}
	if in.Settings != nil {
		patched, e := w.applyVoiceSettings(&d.SynthesisSettings, *in.Settings, kind)
		if e != nil {
			return nil, e
		}
		changed = append(changed, patched...)
	}
	return changed, nil
}

// patchWorkScore 修改编曲乐谱与 YuE2 旋律谱；改谱时额外返回按小节比较的前后差异。
func patchWorkScore(d *schema.Draft, in updateWorkInput, kind string) ([]string, *score.ABCChanges, error) {
	var changed []string
	var melodyChanges *score.ABCChanges
	if in.Score != nil {
		if kind != "score" {
			return nil, nil, fmt.Errorf("score 只适用于编曲作品，这个作品是 %s", kind)
		}
		built, e := buildScore(*in.Score)
		if e != nil {
			return nil, nil, e
		}
		d.Score = &built
		changed = append(changed, "乐谱")
	}
	if in.Abc != nil {
		if kind != "music" {
			return nil, nil, fmt.Errorf("abc 只适用于音乐作品，这个作品是 %s", kind)
		}
		abc := strings.TrimSpace(*in.Abc)
		before, _ := score.ParseABC(d.Abc)
		if abc != "" {
			if len(abc) > score.ABCMaxLength {
				return nil, nil, fmt.Errorf("旋律谱超过 %d 字节上限", score.ABCMaxLength)
			}
			// 与界面导入同一套方言校验：不合法时把具体小节的问题交回助手修正。
			after, e := score.ParseABC(abc)
			if e != nil {
				return nil, nil, fmt.Errorf("invalid ABC score: %v", e)
			}
			abc += "\n"
			// 改谱时按小节比较前后两版，供助手如实说明改了哪些小节。
			if before != nil && strings.TrimSpace(d.Abc) != "" {
				changes := score.CompareABC(before, after)
				melodyChanges = &changes
			}
		}
		d.Abc = abc
		changed = append(changed, "旋律谱")
	}
	return changed, melodyChanges, nil
}

func stringPtr(s string) *string { return &s }
