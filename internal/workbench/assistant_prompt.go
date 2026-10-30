package workbench

import (
	"fmt"
	"slices"
	"sort"
	"strings"
	"time"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
)

// pageLabels 是界面页面在上下文前缀里的描述。
var pageLabels = map[string]string{
	"text":       "voice generation（语音生成）",
	"story":      "story dubbing（故事配音）",
	"music":      "music generation（音乐生成）",
	"sfx":        "sound effects generation（音效生成）",
	"score":      "arrangement（编曲）",
	"characters": "voice library（声音库）",
	"voices":     "reference audio library（参考音色库）",
	"history":    "history（历史生成）",
	"settings":   "settings（设置）",
}

// chatMessageText 组装发给助手的一条用户消息：界面上下文前缀与用户正文。
// 上下文只带摘要（选中内容、当前台词、最近一次生成的结果与错误码、缺失的模型、记住的偏好），不带作品全文。
func (w *Workbench) chatMessageText(next chatMessage) string {
	var b strings.Builder
	context := next.context
	s := w.Store.Read()
	line := func(format string, args ...any) { b.WriteString(fmt.Sprintf(format, args...) + "\n") }
	b.WriteString("<ui_context>\n")
	if label, ok := pageLabels[context.Page]; ok {
		line("page: %s", label)
	}
	if id := strings.TrimSpace(context.WorkID); id != "" {
		title, kind := strings.TrimSpace(context.WorkTitle), strings.TrimSpace(context.WorkKind)
		var work *schema.Draft
		for i := range s.Drafts {
			if s.Drafts[i].ID == id {
				work = &s.Drafts[i]
				title, kind = work.Title, projectKind(*work)
				break
			}
		}
		if title != "" {
			line("current work: %q (id %s, kind %s)", title, id, kind)
		} else {
			line("current work id: %s (kind %s)", id, kind)
		}
		if work != nil {
			w.workContext(&b, s, *work)
		}
	}
	if cue := context.Cue; cue != nil && cue.Index > 0 {
		line("selected line: #%d of %d, speaker %q: %q", cue.Index, cue.Total, clipLine(cue.Speaker, 40), clipLine(cue.Text, 300))
	}
	if selection := strings.TrimSpace(context.Selection); selection != "" {
		line("selected text: %q", clipLine(selection, 600))
	}
	// 播放位置只对打开的作品有意义。
	if context.Playhead > 0 && strings.TrimSpace(context.WorkID) != "" {
		seconds := int(context.Playhead)
		line("playhead: %d:%02d", seconds/60, seconds%60)
	}
	if !RuntimeReady(s) {
		line("inference engine: not installed or outdated (Settings › Engine)")
	}
	if len(s.AssistantMemory) > 0 {
		b.WriteString("remembered preferences:\n")
		for _, memo := range s.AssistantMemory {
			line("- [%s] %s", memo.ID, memo.Text)
		}
	}
	if context.Locale != "" {
		line("ui_locale: %s", context.Locale)
	}
	b.WriteString("</ui_context>\n\n")
	b.WriteString(next.text)
	return b.String()
}

// workContext 写入当前作品的状态：所用模型是否已安装、正在进行或最近结束的生成、最新一版的时长。
func (w *Workbench) workContext(b *strings.Builder, s schema.State, d schema.Draft) {
	if d.ModelID != "" {
		if !slices.ContainsFunc(s.Models, func(m schema.InstalledModel) bool { return m.ID == d.ModelID }) {
			fmt.Fprintf(b, "work model: %s (not installed)\n", d.ModelID)
		} else {
			fmt.Fprintf(b, "work model: %s\n", d.ModelID)
		}
	}
	if a := s.Activity; a != nil && a.ProjectID == d.ID {
		switch {
		case a.Status == "running":
			fmt.Fprintf(b, "generation: running (%s)\n", codeKey(a.Code))
		case a.ErrorCode != nil:
			fmt.Fprintf(b, "last generation: %s, error %s %s\n", a.Status, codeKey(*a.ErrorCode), paramsText(a.ErrorParams))
		default:
			fmt.Fprintf(b, "last generation: %s\n", a.Status)
		}
	}
	for _, g := range s.History {
		if g.Settings.ID == d.ID {
			fmt.Fprintf(b, "latest take: %q, %.1fs, %d min ago (id %s)\n", g.Title, g.Duration, int(time.Since(g.CreatedAt).Minutes()), g.ID)
			break
		}
	}
}

// paramsText 把错误参数拼成简短文本；长参数截断，避免把日志细节整段带进上下文。
func paramsText(params msg.Params) string {
	if len(params) == 0 {
		return ""
	}
	keys := make([]string, 0, len(params))
	for key := range params {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		parts = append(parts, fmt.Sprintf("%s=%s", key, clipLine(fmt.Sprint(params[key]), 120)))
	}
	return "(" + strings.Join(parts, ", ") + ")"
}

// clipLine 先把空白折叠成单个空格再按字符截断，供提示词里的单行摘要使用。
func clipLine(text string, limit int) string {
	return schema.Clip(strings.Join(strings.Fields(text), " "), limit)
}
