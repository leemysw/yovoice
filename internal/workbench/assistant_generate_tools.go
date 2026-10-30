package workbench

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"yovoice/internal/catalog"
	"yovoice/internal/schema"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// generateWorkInput 的动作名按作品类型显示（语音/音乐/音效/渲染）。
type generateWorkInput struct {
	ID           string `json:"id" jsonschema:"作品 ID"`
	WithoutScore bool   `json:"withoutScore,omitempty" jsonschema:"仅当用户明确说不看谱、直接生成时为 true：YuE2 生成时自己写谱，生成后填入作品"`
	CueID        string `json:"cueId,omitempty" jsonschema:"故事配音只重新生成这一句（inspect_audio 给出的 cueId），新版本在时间轴上原地替换旧版本"`
}

// needsScoreReview 判断 YuE2 作品是否选了按旋律谱生成（或纯音乐）但还没有谱：这时助手应先出谱让用户确认。
func needsScoreReview(d schema.Draft) bool {
	if m, e := catalog.Lookup(d.ModelID); projectKind(d) != "music" || e != nil || m.Family != "yue2" || strings.TrimSpace(d.Abc) != "" {
		return false
	}
	mode, _ := d.ModelOptions["yue2"]["cot"].(string)
	return d.Instrumental || mode != "off"
}

func (w *Workbench) generateWorkTool(ctx context.Context, req *mcp.CallToolRequest, in generateWorkInput) (*mcp.CallToolResult, any, error) {
	d, err := w.assistantWork(in.ID)
	if err != nil {
		return nil, nil, err
	}
	if !in.WithoutScore && needsScoreReview(d) {
		return nil, nil, fmt.Errorf("这首歌选的是按旋律谱生成，但作品还没有谱。先用 plan_melody 写谱，get_generation_status 读到 melody.abc 后用 update_work 填入作品，然后请用户在旋律谱里查看、点“试听”听一遍，用户确认后再 generate_work；用户明确说不看谱直接生成时才传 withoutScore=true")
	}
	action, actionEN := "生成语音", "generate voice"
	switch projectKind(d) {
	case "music":
		action, actionEN = "生成音乐", "generate music"
	case "sfx":
		action, actionEN = "生成音效", "generate sound effects"
	case "score":
		action, actionEN = "渲染配乐", "render the arrangement"
	}
	if in.CueID != "" {
		if projectKind(d) != "story" || d.Subtitles == nil || !slices.ContainsFunc(d.Subtitles.Cues, func(c schema.SubtitleCue) bool { return c.ID == in.CueID }) {
			return nil, nil, fmt.Errorf("cueId 只用于故事配音，且必须是这个作品里的一句；先用 inspect_audio 或 get_work 查看")
		}
		w.chatCard("generate_work", fmt.Sprintf("正在重新生成《%s》的一句…", d.Title), fmt.Sprintf("Regenerating one line of %q…", d.Title), "running")
		if err = w.GenerateCue(d, in.CueID, cueClip(w.Store.Read(), d, in.CueID)); err != nil {
			return nil, nil, err
		}
		return nil, map[string]any{"started": true, "hint": "这一句在后台重新生成，用 get_generation_status 查询，完成后再用 inspect_audio 检查"}, nil
	}
	w.chatCard("generate_work", fmt.Sprintf("正在%s《%s》…", action, d.Title), fmt.Sprintf("%s for %q…", actionEN, d.Title), "running")
	if err = w.Generate(d); err != nil {
		return nil, nil, err
	}
	return nil, map[string]any{"started": true, "hint": "生成在后台进行，用 get_generation_status 查询进度与结果"}, nil
}

func (w *Workbench) getGenerationStatusTool(ctx context.Context, req *mcp.CallToolRequest, in workIDInput) (*mcp.CallToolResult, any, error) {
	d, err := w.assistantWork(in.ID)
	if err != nil {
		return nil, nil, err
	}
	s := w.Store.Read()
	out := map[string]any{"id": d.ID}
	if a := s.Activity; a != nil && a.ProjectID == d.ID {
		progress := map[string]any{"status": a.Status}
		if a.Status == "running" {
			progress["description"] = a.Code
		}
		if a.ErrorCode != nil {
			progress["errorCode"], progress["errorParams"] = *a.ErrorCode, a.ErrorParams
		}
		out["activity"] = progress
	}
	// 出谱或扒谱的结果等待填入作品：给出谱面与概要，助手确认后用 update_work 的 abc 写入。
	if m := s.Melody; m != nil && m.ProjectID == d.ID {
		melody := melodySummary(InspectMelody(m.Abc))
		melody["source"], melody["truncated"], melody["abc"] = m.Source, m.Truncated, m.Abc
		out["melody"] = melody
	}
	for _, g := range s.History {
		if g.Settings.ID == d.ID {
			latest := map[string]any{"id": g.ID, "title": g.Title, "duration": g.Duration, "createdAt": g.CreatedAt}
			// 带上体检结果，助手不用另外调用就能知道这一版有没有截断、爆音等问题。
			if g.Check != nil {
				latest["check"] = checkSummary(*g.Check)
			}
			out["latest"] = latest
			break
		}
	}
	w.chatCard("get_generation_status", fmt.Sprintf("查看了《%s》的生成进度", d.Title), fmt.Sprintf("Checked generation status of %q", d.Title), "done")
	return nil, out, nil
}
