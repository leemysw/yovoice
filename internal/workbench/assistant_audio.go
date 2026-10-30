package workbench

import (
	"context"
	"fmt"
	"slices"
	"yovoice/internal/schema"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// 助手的“耳朵”：读出生成结果的测量体检（响度、峰值与问题），让助手在交付前自己发现截断、爆音、长静音，
// 并只重新生成有问题的那几句。体检只做测量，不用模型。

// issueHints 是给助手看的问题说明与建议处理。
var issueHints = map[string]string{
	"clipping": "削波（爆音）：波形顶到满幅。重新生成通常能解决；反复出现时降低参考音频音量或换参考音频",
	"clicks":   "孤立的咔哒声：多为声码器瑕疵，重新生成这一句",
	"cutoff":   "结尾被截断：最后一个字没说完就停了，重新生成这一句；反复出现时检查文本结尾的标点",
	"silence":  "2 秒以上的静音（At–End）：模型可能卡住或漏读，重新生成这一句",
	"silent":   "整段几乎没有声音：生成失败，重新生成；反复出现时检查模型与参考音频",
	"quiet":    "音量过小：导出时选目标响度即可补偿，不必重新生成",
	"dc":       "直流偏移：波形整体偏离中线，影响不大，可忽略",
}

type inspectAudioInput struct {
	ID string `json:"id" jsonschema:"作品 ID 或生成记录 ID。作品：语音和音乐看最近一次生成，故事配音看每一句当前的版本"`
}

func (w *Workbench) registerAudioTools(server *mcp.Server) {
	mcp.AddTool(server, &mcp.Tool{Name: "inspect_audio", Description: "听不到声音时用它检查生成结果：给出整体响度（LUFS）、真峰值（dBTP）和测量出的问题（削波、咔哒声、结尾截断、长静音、无声、音量过小），附带时间位置和处理建议。生成完成后、向用户交付前调用；故事配音只列出有问题的句子，可用 generate_work 的 cueId 只重新生成这几句。"}, w.inspectAudioTool)
}

// checkSummary 把体检结果整理成助手读的结构：问题附说明。
func checkSummary(check schema.AudioCheck) map[string]any {
	issues := make([]map[string]any, 0, len(check.Issues))
	for _, issue := range check.Issues {
		item := map[string]any{"code": issue.Code, "hint": issueHints[issue.Code]}
		if issue.At > 0 || issue.End > 0 {
			item["at"] = issue.At
		}
		if issue.End > 0 {
			item["end"] = issue.End
		}
		if issue.Count > 0 {
			item["count"] = issue.Count
		}
		issues = append(issues, item)
	}
	return map[string]any{"loudness": check.Loudness, "peak": check.Peak, "issues": issues}
}

// currentCueVersions 返回故事配音每一句当前的生成版本（最新的那个），按台词顺序。
func currentCueVersions(s schema.State, d schema.Draft) []schema.Generation {
	if d.Subtitles == nil {
		return nil
	}
	latest := map[string]schema.Generation{}
	for _, g := range s.History {
		if g.Settings.ID != d.ID || g.Segment == nil {
			continue
		}
		if _, seen := latest[g.Segment.CueID]; !seen {
			latest[g.Segment.CueID] = g
		}
	}
	var out []schema.Generation
	for _, cue := range d.Subtitles.Cues {
		if g, ok := latest[cue.ID]; ok {
			out = append(out, g)
		}
	}
	return out
}

func (w *Workbench) inspectAudioTool(ctx context.Context, req *mcp.CallToolRequest, in inspectAudioInput) (*mcp.CallToolResult, any, error) {
	s := w.Store.Read()
	var targets []schema.Generation
	title := ""
	if i := slices.IndexFunc(s.History, func(g schema.Generation) bool { return g.ID == in.ID }); i >= 0 {
		targets, title = []schema.Generation{s.History[i]}, s.History[i].Title
	} else {
		d, err := w.assistantWork(in.ID)
		if err != nil {
			return nil, nil, fmt.Errorf("没有找到作品或生成记录 %s", in.ID)
		}
		title = d.Title
		if projectKind(d) == "story" {
			targets = currentCueVersions(s, d)
		} else if i := slices.IndexFunc(s.History, func(g schema.Generation) bool { return g.Settings.ID == d.ID }); i >= 0 {
			targets = []schema.Generation{s.History[i]}
		}
		if len(targets) == 0 {
			return nil, nil, fmt.Errorf("《%s》还没有生成结果，先 generate_work 并等 get_generation_status 显示完成", d.Title)
		}
	}
	w.chatCard("inspect_audio", fmt.Sprintf("检查了《%s》的音频", title), fmt.Sprintf("Inspected the audio of %q", title), "done")
	if len(targets) == 1 && targets[0].Segment == nil {
		check, err := w.CheckGeneration(targets[0].ID)
		if err != nil {
			return nil, nil, err
		}
		out := checkSummary(check)
		out["generationId"], out["duration"] = targets[0].ID, targets[0].Duration
		return nil, out, nil
	}
	// 故事配音逐句检查，只列出有问题的句子，整体给出句数与问题句数。
	problems := []map[string]any{}
	for _, g := range targets {
		check, err := w.CheckGeneration(g.ID)
		if err != nil {
			problems = append(problems, map[string]any{"cueId": g.Segment.CueID, "generationId": g.ID, "error": err.Error()})
			continue
		}
		if len(check.Issues) == 0 {
			continue
		}
		item := checkSummary(check)
		item["cueId"], item["generationId"], item["text"] = g.Segment.CueID, g.ID, g.Title
		problems = append(problems, item)
	}
	return nil, map[string]any{"cues": len(targets), "problemCues": len(problems), "problems": problems}, nil
}

// cueClip 找到时间轴上正在使用某句当前版本的片段，重新生成时原地替换它。
func cueClip(s schema.State, d schema.Draft, cueID string) string {
	if d.Timeline == nil {
		return ""
	}
	current := map[string]bool{}
	for _, g := range s.History {
		if g.Settings.ID == d.ID && g.Segment != nil && g.Segment.CueID == cueID {
			current[g.ID] = true
		}
	}
	for _, lane := range d.Timeline.Tracks {
		for _, clip := range lane.Clips {
			if current[clip.GenerationID] && !lane.Locked {
				return clip.ID
			}
		}
	}
	return ""
}
