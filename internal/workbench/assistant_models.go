package workbench

import (
	"fmt"
	"slices"
	"time"
	"yovoice/internal/catalog"
	"yovoice/internal/schema"
)

// modelKind 返回模型适用的作品类型：music、sfx、score 或 text（语音与故事共用）；扒谱和歌词对齐模型不用于生成，返回空。
func modelKind(id string) string {
	m, err := catalog.Lookup(id)
	if err != nil {
		return ""
	}
	switch m.Family {
	case "ace_step", "yue2":
		return "music"
	case "stable_audio":
		if m.Variant == "sfx" {
			return "sfx"
		}
		return "music"
	case "soundfont":
		return "score"
	case "sheetsage2", "lyric_align":
		return ""
	}
	return "text"
}

// preferredModel 为新作品挑模型：沿用最近一次同类作品用过且已安装的模型，否则用第一个已安装的同类模型，都没有时用 fallback。
func preferredModel(s schema.State, kind, fallback string) string {
	if kind == "story" {
		kind = "text"
	}
	installed := map[string]bool{}
	for _, m := range s.Models {
		installed[m.ID] = true
	}
	recent, latest := "", time.Time{}
	for _, d := range s.Drafts {
		if d.UpdatedAt == nil || !installed[d.ModelID] || modelKind(d.ModelID) != kind || !d.UpdatedAt.After(latest) {
			continue
		}
		recent, latest = d.ModelID, *d.UpdatedAt
	}
	if recent != "" {
		return recent
	}
	for _, m := range s.Models {
		if modelKind(m.ID) == kind {
			return m.ID
		}
	}
	switch kind {
	case "music":
		return "ace-step-1.5-turbo-bf16"
	case "sfx":
		return "stable-audio-3-small-sfx-q8"
	case "score":
		return "musescore-general-sf2"
	}
	return fallback
}

// voiceExists 判断参考音色 ID 是否已上传。
func (w *Workbench) voiceExists(id string) bool {
	return slices.ContainsFunc(w.Store.Read().Voices, func(v schema.Voice) bool { return v.ID == id })
}

// assistantModelCheck 校验模型存在、类型匹配且已安装；未安装的模型让用户去设置里下载。
func (w *Workbench) assistantModelCheck(model, kind string) error {
	definition, e := catalog.Lookup(model)
	if e != nil {
		return fmt.Errorf("未知模型 %s，请用 list_models 查询可用模型", model)
	}
	if kind == "story" {
		kind = "text"
	}
	compatible := modelKind(model) == kind || definition.Family == "stable_audio" && (kind == "sfx" && definition.Variant == "medium" || kind == "music" && definition.Variant == "sfx")
	if !compatible {
		return fmt.Errorf("模型 %s（%s）不适用于%s作品", model, definition.Family, kind)
	}
	for _, installed := range w.Store.Read().Models {
		if installed.ID == model {
			return nil
		}
	}
	return fmt.Errorf("模型 %s 尚未安装：用 propose_action（install_model）提议下载，用户确认后才会开始", model)
}
