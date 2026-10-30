package workbench

import (
	"context"
	"fmt"
	"slices"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// assistantPages 是 open_page 接受的页面。
var assistantPages = []string{"text", "story", "music", "sfx", "score", "characters", "voices", "history", "settings"}

func (w *Workbench) openWorkTool(ctx context.Context, req *mcp.CallToolRequest, in workIDInput) (*mcp.CallToolResult, any, error) {
	d, err := w.assistantWork(in.ID)
	if err != nil {
		return nil, nil, err
	}
	w.chatCard("open_work", fmt.Sprintf("打开《%s》", d.Title), fmt.Sprintf("Opened %q", d.Title), "done")
	w.chatNav(d.ID, "")
	return nil, map[string]any{"opened": true}, nil
}

// pageCardLabels 是 open_page 卡片摘要里的页面名。
var pageCardLabels = map[string][2]string{
	"text": {"语音生成页", "voice generation"}, "story": {"故事配音页", "story dubbing"}, "music": {"音乐生成页", "music generation"},
	"sfx": {"音效生成页", "sound effects generation"}, "score": {"编曲页", "arrangement"}, "characters": {"声音库页", "voice library"}, "voices": {"参考音色页", "reference library"},
	"history": {"历史页", "history"}, "settings": {"设置页", "settings"},
}

type pageInput struct {
	Page string `json:"page" jsonschema:"页面：text、story、music、sfx、score、characters 或 settings"`
}

func (w *Workbench) openPageTool(ctx context.Context, req *mcp.CallToolRequest, in pageInput) (*mcp.CallToolResult, any, error) {
	if !slices.Contains(assistantPages, in.Page) {
		return nil, nil, fmt.Errorf("page 必须是 %s 之一", strings.Join(assistantPages, ", "))
	}
	names := pageCardLabels[in.Page]
	w.chatCard("open_page", "切换到"+names[0], "Switched to "+names[1], "done")
	w.chatNav("", in.Page)
	return nil, map[string]any{"opened": true}, nil
}
