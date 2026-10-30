package workbench

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"yovoice/internal/diag"
	"yovoice/internal/schema"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func (w *Workbench) listWorksTool(ctx context.Context, req *mcp.CallToolRequest, in struct {
	Kind string `json:"kind,omitempty" jsonschema:"只列某类作品：text、story、music、sfx 或 score；留空列全部"`
}) (*mcp.CallToolResult, any, error) {
	drafts := w.Store.Read().Drafts
	works := make([]map[string]any, 0, len(drafts))
	for _, d := range drafts {
		kind := projectKind(d)
		if in.Kind != "" && in.Kind != kind {
			continue
		}
		works = append(works, map[string]any{"id": d.ID, "kind": kind, "title": d.Title, "updatedAt": d.UpdatedAt})
	}
	w.chatCard("list_works", fmt.Sprintf("查看了作品列表（%d 个）", len(works)), fmt.Sprintf("Viewed the works list (%d)", len(works)), "done")
	return nil, map[string]any{"works": works}, nil
}

// workContent 把作品转成给模型看的内容；时间线只保留选轨所需的摘要，不返回剪辑和素材明细。
func workContent(d schema.Draft) map[string]any {
	out := map[string]any{"id": d.ID, "kind": projectKind(d), "title": d.Title, "text": d.Text, "updatedAt": d.UpdatedAt}
	settings := map[string]any{"modelId": d.ModelID, "mode": d.Mode, "language": d.Language, "speed": d.Speed}
	for name, value := range map[string]any{"voiceId": d.VoiceID, "emotionVoiceId": d.EmotionVoiceID, "speaker": d.Speaker, "voiceMode": d.VoiceMode, "voiceDescription": d.VoiceDescription, "referenceText": d.ReferenceText, "lyrics": d.Lyrics, "instrumental": d.Instrumental, "synthesisLanguage": d.SynthesisLanguage, "abc": d.Abc, "seed": d.Seed, "temperature": d.Temperature} {
		if value != nil && value != "" && value != false {
			settings[name] = value
		}
	}
	out["settings"] = settings
	if d.Subtitles != nil {
		speakers := make([]map[string]any, 0, len(d.Subtitles.Speakers))
		for _, s := range d.Subtitles.Speakers {
			speaker := map[string]any{"id": s.ID, "name": s.SourceName}
			if s.CharacterID != "" {
				speaker["characterId"] = s.CharacterID
			}
			if s.Settings != nil {
				if s.Settings.VoiceID != nil && *s.Settings.VoiceID != "" {
					speaker["voiceId"] = *s.Settings.VoiceID
				}
				if s.Settings.ModelID != "" && s.Settings.ModelID != d.ModelID {
					speaker["modelId"] = s.Settings.ModelID
				}
			}
			speakers = append(speakers, speaker)
		}
		cues := make([]map[string]any, 0, len(d.Subtitles.Cues))
		for _, c := range d.Subtitles.Cues {
			cues = append(cues, map[string]any{"id": c.ID, "speakerId": c.SpeakerID, "text": c.Text})
		}
		out["speakers"] = speakers
		out["cues"] = cues
	}
	if d.Timeline != nil {
		tracks := make([]map[string]any, 0, len(d.Timeline.Tracks))
		for i, track := range d.Timeline.Tracks {
			end := 0.0
			for _, clip := range track.Clips {
				end = max(end, clip.Start+clip.Duration)
			}
			tracks = append(tracks, map[string]any{"index": i + 1, "id": track.ID, "name": track.Name, "locked": track.Locked, "end": end})
		}
		out["tracks"] = tracks
	}
	if d.Score != nil {
		out["score"] = d.Score
	}
	return out
}

// workIDInput 是以作品 ID 为参数的工具输入。
type workIDInput struct {
	ID string `json:"id" jsonschema:"作品 ID"`
}

func (w *Workbench) getWorkTool(ctx context.Context, req *mcp.CallToolRequest, in workIDInput) (*mcp.CallToolResult, any, error) {
	d, err := w.assistantWork(in.ID)
	if err != nil {
		return nil, nil, err
	}
	w.chatCard("get_work", fmt.Sprintf("读取了《%s》", d.Title), fmt.Sprintf("Read %q", d.Title), "done")
	return nil, workContent(d), nil
}

// assistantWork 按 ID 找到作品；找不到时给出与界面一致的错误。
func (w *Workbench) assistantWork(id string) (schema.Draft, error) {
	for _, d := range w.Store.Read().Drafts {
		if d.ID == id {
			return d, nil
		}
	}
	return schema.Draft{}, fmt.Errorf("没有找到作品 %s，请先用 list_works 查看现有的作品 ID", id)
}

// createWorkInput 的类型与 createDraft 的界面默认一致：语音用默认语音模型，音乐用 ACE-Step，音效用 Stable Audio SFX，编曲用音色库。
type createWorkInput struct {
	Kind  string `json:"kind" jsonschema:"作品类型：text、story、music、sfx 或 score"`
	Title string `json:"title,omitempty" jsonschema:"作品标题，留空由用户稍后命名"`
	Open  *bool  `json:"open,omitempty" jsonschema:"是否让界面打开新作品，默认 true；只是准备素材时传 false"`
}

func (w *Workbench) createWorkTool(ctx context.Context, req *mcp.CallToolRequest, in createWorkInput) (*mcp.CallToolResult, any, error) {
	if !slices.Contains([]string{"text", "story", "music", "sfx", "score"}, in.Kind) {
		return nil, nil, fmt.Errorf("kind 必须是 text、story、music、sfx 或 score")
	}
	d := schema.DefaultDraft()
	d.Text, d.Kind, d.Title = "", in.Kind, strings.TrimSpace(in.Title)
	if d.Title == "" {
		d.Title = "未命名作品"
	}
	s := w.Store.Read()
	d.ModelID = preferredModel(s, in.Kind, d.ModelID)
	switch in.Kind {
	case "score":
		d.Score = &schema.Score{Tempo: 100, TimeSignature: []int{4, 4}}
	}
	w.edit.Lock()
	err := w.saveDraft(d)
	w.edit.Unlock()
	if err != nil {
		return nil, nil, err
	}
	w.chatCard("create_work", fmt.Sprintf("新建了《%s》", d.Title), fmt.Sprintf("Created %q", d.Title), "done")
	w.chatUpdate(d.ID)
	if in.Open == nil || *in.Open {
		w.chatNav(d.ID, "")
	}
	diag.Log(w.Store.Root, "assistant.work_created", "project_id", d.ID, "kind", in.Kind)
	return nil, map[string]any{"id": d.ID, "kind": in.Kind, "title": d.Title}, nil
}
