package workbench

import (
	"context"
	"fmt"
	"os"
	"strings"
	"yovoice/internal/catalog"
	"yovoice/internal/schema"
	"yovoice/internal/score"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// 助手的旋律谱工具：让 YuE2 出谱、从歌曲扒谱、做不需要模型的转谱。出谱与扒谱占用推理引擎，
// 结果与界面一样先放在会话状态里，助手经 get_generation_status 读到后用 update_work 填入作品。

func (w *Workbench) registerMusicTools(server *mcp.Server) {
	mcp.AddTool(server, &mcp.Tool{Name: "plan_melody", Description: "让 YuE2 按音乐作品当前的风格与歌词写出旋律谱（只出谱、不生成音频），立即返回。完成后用 get_generation_status 读取 melody.abc，确认后用 update_work 的 abc 填入作品。纯音乐作品可以不填歌词。"}, w.planMelodyTool)
	mcp.AddTool(server, &mcp.Tool{Name: "cover_melody", Description: "用 SheetSage2 从本地歌曲文件扒出旋律谱（去掉原曲和弦），用于翻唱或纯音乐改编，立即返回；需要已安装 SheetSage2。完成后用 get_generation_status 读取 melody.abc，再用 update_work 的 abc 填入作品。"}, w.coverMelodyTool)
	mcp.AddTool(server, &mcp.Tool{Name: "transform_melody", Description: "对音乐作品当前的旋律谱做不需要模型的改写并直接保存：stripChords 去掉和弦（按谱生成时伴奏自由编配）；tempo 改速度；instrumental 把人声旋律移到器乐声部（纯音乐用，和弦、速度、调不变）。返回改后的概要与按小节的改动。"}, w.transformMelodyTool)
}

// melodyWork 取出使用 YuE2 的音乐作品。
func (w *Workbench) melodyWork(id string) (schema.Draft, error) {
	d, err := w.assistantWork(id)
	if err != nil {
		return d, err
	}
	if m, e := catalog.Lookup(d.ModelID); projectKind(d) != "music" || e != nil || m.Family != "yue2" {
		return d, fmt.Errorf("旋律谱只适用于使用 YuE2（modelId 以 yue2- 开头）的音乐作品")
	}
	return d, nil
}

func (w *Workbench) planMelodyTool(ctx context.Context, req *mcp.CallToolRequest, in workIDInput) (*mcp.CallToolResult, any, error) {
	d, err := w.melodyWork(in.ID)
	if err != nil {
		return nil, nil, err
	}
	w.chatCard("plan_melody", fmt.Sprintf("正在为《%s》写旋律谱…", d.Title), fmt.Sprintf("Writing a melody score for %q…", d.Title), "running")
	if err = w.PlanMelody(d); err != nil {
		return nil, nil, err
	}
	return nil, map[string]any{"started": true, "hint": "出谱在后台进行，用 get_generation_status 查询；完成后 melody.abc 是写好的谱"}, nil
}

type coverMelodyInput struct {
	ID   string `json:"id" jsonschema:"音乐作品 ID（使用 YuE2）"`
	Path string `json:"path" jsonschema:"歌曲文件的本地绝对路径（mp3、wav、flac、m4a 等，10 分钟以内）"`
}

type transformMelodyInput struct {
	ID    string `json:"id" jsonschema:"音乐作品 ID（使用 YuE2）"`
	Op    string `json:"op" jsonschema:"stripChords、tempo 或 instrumental"`
	Tempo int    `json:"tempo,omitempty" jsonschema:"改速度时的四分音符速度，30-300"`
}

func (w *Workbench) coverMelodyTool(ctx context.Context, req *mcp.CallToolRequest, in coverMelodyInput) (*mcp.CallToolResult, any, error) {
	d, err := w.melodyWork(in.ID)
	if err != nil {
		return nil, nil, err
	}
	file, err := os.Open(in.Path)
	if err != nil {
		return nil, nil, fmt.Errorf("读不到歌曲文件：%v", err)
	}
	defer file.Close()
	w.chatCard("cover_melody", fmt.Sprintf("正在从歌曲提取《%s》的旋律谱…", d.Title), fmt.Sprintf("Extracting a melody score for %q…", d.Title), "running")
	if err = w.CoverMelody(d.ID, file); err != nil {
		return nil, nil, err
	}
	return nil, map[string]any{"started": true, "hint": "扒谱在后台进行，用 get_generation_status 查询；完成后 melody.abc 是扒出的谱"}, nil
}

func (w *Workbench) transformMelodyTool(ctx context.Context, req *mcp.CallToolRequest, in transformMelodyInput) (*mcp.CallToolResult, any, error) {
	d, err := w.melodyWork(in.ID)
	if err != nil {
		return nil, nil, err
	}
	if strings.TrimSpace(d.Abc) == "" {
		return nil, nil, fmt.Errorf("作品还没有旋律谱：先用 plan_melody 出谱或 cover_melody 扒谱")
	}
	before, _ := score.ParseABC(d.Abc)
	out, err := TransformMelody(d.Abc, in.Op, in.Tempo)
	if err != nil {
		return nil, nil, err
	}
	d.Abc = out
	w.edit.Lock()
	err = w.saveDraft(d)
	w.edit.Unlock()
	if err != nil {
		return nil, nil, err
	}
	label := map[string][2]string{"stripChords": {"去掉了和弦", "removed the chords"}, "tempo": {fmt.Sprintf("改为 %d BPM", in.Tempo), fmt.Sprintf("set the tempo to %d BPM", in.Tempo)}, "instrumental": {"把人声旋律转给了乐器", "gave the vocal melody to instruments"}}[in.Op]
	w.chatCard("transform_melody", fmt.Sprintf("《%s》的旋律谱%s", d.Title, label[0]), fmt.Sprintf("%q score: %s", d.Title, label[1]), "done")
	w.chatUpdate(d.ID)
	after, _ := score.ParseABC(out)
	summary := map[string]any{"id": d.ID, "melody": melodySummary(InspectMelody(out))}
	if before != nil && after != nil {
		summary["melodyChanges"] = score.CompareABC(before, after)
	}
	return nil, summary, nil
}

// melodySummary 是给助手看的谱面概要。
func melodySummary(in MelodyInspection) map[string]any {
	if in.Issue != nil {
		return map[string]any{"issue": in.Issue}
	}
	vocal := false
	if in.Score != nil {
		for _, track := range in.Score.Tracks {
			vocal = vocal || track.ID == "vocal"
		}
	}
	return map[string]any{"key": in.Key, "tempo": in.Tempo, "meter": in.Meter, "bars": in.Bars, "seconds": in.Seconds, "chords": in.Chords, "vocalMelody": vocal}
}
