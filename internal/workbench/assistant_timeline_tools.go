package workbench

import (
	"context"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"yovoice/internal/schema"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type addTimelineAudioInput struct {
	ID           string   `json:"id" jsonschema:"目标 story 故事配音作品 ID"`
	GenerationID string   `json:"generationId" jsonschema:"来源整段生成版本 ID，不能是单句片段"`
	Track        string   `json:"track,omitempty" jsonschema:"目标轨道名称或 1 起始序号；留空新建“音效”轨"`
	Start        *float64 `json:"start,omitempty" jsonschema:"剪辑起点秒数，必须是非负有限数；留空追加到该轨末尾"`
}

// addTimelineAudioTool 把整段生成复制成作品独立素材，再以完整剪辑加入故事时间线。
func (w *Workbench) addTimelineAudioTool(ctx context.Context, req *mcp.CallToolRequest, in addTimelineAudioInput) (*mcp.CallToolResult, any, error) {
	d, err := w.assistantWork(in.ID)
	if err != nil {
		return nil, nil, err
	}
	if projectKind(d) != "story" {
		return nil, nil, fmt.Errorf("add_timeline_audio 只适用于 story 故事配音作品")
	}
	if in.Start != nil && !schema.InRange(*in.Start, 0, 86400) {
		return nil, nil, fmt.Errorf("start 必须是 0–86400 秒之间的有限数")
	}
	if d.Timeline == nil {
		d.Timeline = &schema.AudioTimeline{}
	}
	trackIndex := len(d.Timeline.Tracks)
	if track := strings.TrimSpace(in.Track); track == "" {
		d.Timeline.Tracks = append(d.Timeline.Tracks, schema.AudioLane{ID: schema.NewID(), Name: "音效"})
	} else {
		trackIndex = slices.IndexFunc(d.Timeline.Tracks, func(t schema.AudioLane) bool { return t.Name == track })
		if trackIndex < 0 {
			if ordinal, e := strconv.Atoi(track); e == nil && ordinal >= 1 && ordinal <= len(d.Timeline.Tracks) {
				trackIndex = ordinal - 1
			}
		}
		if trackIndex < 0 {
			return nil, nil, fmt.Errorf("没有找到轨道 %q，请用 get_work 查看轨道名称或 1 起始序号", track)
		}
	}
	track := &d.Timeline.Tracks[trackIndex]
	if track.Locked {
		return nil, nil, fmt.Errorf("轨道《%s》已锁定，不能添加音频", track.Name)
	}
	start := 0.0
	for _, clip := range track.Clips {
		start = max(start, clip.Start+clip.Duration)
	}
	if in.Start != nil {
		start = *in.Start
	}
	asset, err := w.ImportTimelineGeneration(ctx, in.GenerationID)
	if err != nil {
		return nil, nil, err
	}
	clip := schema.AudioClip{ID: schema.NewID(), AssetID: asset.ID, Start: start, Offset: 0, Duration: asset.Duration}
	d.Timeline.Assets = append(d.Timeline.Assets, asset)
	track = &d.Timeline.Tracks[trackIndex]
	track.Clips = append(track.Clips, clip)
	if err = w.SaveDraft(d); err != nil {
		return nil, nil, err
	}
	w.chatCard("add_timeline_audio", fmt.Sprintf("把《%s》加入《%s》的%s轨", asset.Name, d.Title, track.Name), fmt.Sprintf("Added %q to track %q in %q", asset.Name, track.Name, d.Title), "done")
	w.chatUpdate(d.ID)
	return nil, map[string]any{"id": d.ID, "generationId": in.GenerationID, "assetId": asset.ID, "clipId": clip.ID, "trackId": track.ID, "track": track.Name, "start": start, "duration": asset.Duration}, nil
}
