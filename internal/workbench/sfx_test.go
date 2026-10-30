package workbench

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
	"yovoice/internal/assistant/fakeocho"
	"yovoice/internal/catalog"
	"yovoice/internal/schema"
)

// 音效草稿可校验、保存并随作品包往返；旧 music+SFX 不迁移。
func TestSFXDraftSaveAndArchive(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	d := schema.DefaultDraft()
	d.Kind, d.ModelID, d.Title, d.Text = "sfx", "stable-audio-3-small-sfx-q8", "雨天", "rain on a tin roof"
	must(t, schema.Validate(d))
	medium := d
	medium.ModelID = "stable-audio-3-medium-q8"
	must(t, schema.Validate(medium))
	must(t, w.SaveDraft(d))
	saved := w.Store.Read().Drafts[0]
	if saved.Kind != "sfx" || !saved.Instrumental || saved.ModelOptions["stable_audio"]["duration_seconds"] != float64(5) {
		t.Fatalf("音效默认值未保存：%+v", saved)
	}
	if projectKind(saved) != "sfx" {
		t.Fatal("音效作品分类丢失")
	}
	for _, model := range []string{"stable-audio-3-small-music-q8", "index-2.5-q8"} {
		invalid := saved
		invalid.ModelID = model
		if err := schema.Validate(invalid); err == nil {
			t.Fatal("音效作品不应接受非 SFX 模型", model)
		}
	}

	legacy := schema.DefaultDraft()
	legacy.Kind, legacy.ModelID, legacy.Text = "music", "stable-audio-3-small-sfx-q8", "thunder"
	must(t, schema.Validate(legacy))
	must(t, w.SaveDraft(legacy))
	for _, draft := range w.Store.Read().Drafts {
		if draft.ID == legacy.ID && (draft.Kind != "music" || draft.Instrumental || draft.ModelOptions != nil) {
			t.Fatalf("旧 music+SFX 被迁移：%+v", draft)
		}
	}

	g := schema.Generation{ID: schema.NewID(), Title: saved.Title, FileName: "sfx.wav", Duration: 1, Settings: saved}
	must(t, os.WriteFile(filepath.Join(w.Store.Root, "outputs", g.FileName), wav(), 0600))
	must(t, w.Store.Update(func(s *schema.State) { s.History = []schema.Generation{g} }, true))
	archive := filepath.Join(t.TempDir(), "sfx.yovoice")
	must(t, w.ExportProject(saved.ID, archive))
	imported, err := w.ImportProject(archive)
	must(t, err)
	if imported.Kind != "sfx" || imported.ModelID != saved.ModelID || !imported.Instrumental || imported.ModelOptions["stable_audio"]["duration_seconds"] != float64(5) {
		t.Fatalf("作品包往返丢失音效设置：%+v", imported)
	}
	state := w.Store.Read()
	if len(state.History) == 0 || state.History[0].Settings.ID != imported.ID || state.History[0].Settings.Kind != "sfx" {
		t.Fatalf("作品包历史未保留音效类型：%+v", state.History)
	}
}

// 真实生成路径复用 Stable Audio，并在作品和历史快照中保留 sfx 与五秒默认值。
func TestSFXGenerationHistory(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	executable, err := os.Executable()
	must(t, err)
	model := filepath.Join(w.Store.Root, "models", "sfx.gguf")
	must(t, os.WriteFile(model, []byte("test"), 0600))
	must(t, w.Store.Update(func(s *schema.State) {
		s.Models = []schema.InstalledModel{{ID: "stable-audio-3-small-sfx-q8", Path: model}}
		s.RuntimePath = &executable
		s.RuntimeBackend = ptr("cpu")
		s.RuntimeVersion = ptr(catalog.EngineVersion)
		s.Preferences.Backend = "cpu"
	}, true))
	d := schema.DefaultDraft()
	d.Kind, d.ModelID, d.Title, d.Text = "sfx", "stable-audio-3-small-sfx-q8", "脚步", "footsteps on gravel"
	must(t, w.Generate(d))
	<-w.Done()
	state := w.Store.Read()
	if state.Activity == nil || state.Activity.Status != "completed" || len(state.History) != 1 {
		t.Fatalf("音效生成未完成：%+v", state.Activity)
	}
	settings := state.History[0].Settings
	if settings.Kind != "sfx" || !settings.Instrumental || settings.ModelOptions["stable_audio"]["duration_seconds"] != float64(5) || state.Drafts[0].Kind != "sfx" {
		t.Fatalf("音效生成历史映射不对：%+v", settings)
	}
}

// 助手的新建、列表、读取、更新、生成和页面跳转均使用 sfx 分类。
func TestAssistantSFXWork(t *testing.T) {
	w := assistantWorkbench(t, fakeocho.Plan{})
	ctx := context.Background()
	_, created, err := w.createWorkTool(ctx, toolReq, createWorkInput{Kind: "sfx", Title: "环境音", Open: boolPtr(false)})
	must(t, err)
	id := created.(map[string]any)["id"].(string)
	d, err := w.assistantWork(id)
	must(t, err)
	if d.Kind != "sfx" || d.ModelID != "stable-audio-3-small-sfx-q8" || !d.Instrumental || d.ModelOptions["stable_audio"]["duration_seconds"] != float64(5) {
		t.Fatalf("助手新建音效默认值不对：%+v", d)
	}
	_, listed, err := w.listWorksTool(ctx, toolReq, struct {
		Kind string `json:"kind,omitempty" jsonschema:"只列某类作品：text、story、music、sfx 或 score；留空列全部"`
	}{Kind: "sfx"})
	must(t, err)
	works := listed.(map[string]any)["works"].([]map[string]any)
	if len(works) != 1 || works[0]["id"] != id || works[0]["kind"] != "sfx" {
		t.Fatalf("助手音效列表不对：%+v", works)
	}
	_, content, err := w.getWorkTool(ctx, toolReq, workIDInput{ID: id})
	must(t, err)
	if content.(map[string]any)["kind"] != "sfx" {
		t.Fatalf("助手读取分类不对：%+v", content)
	}
	text := "a door creaks open"
	_, _, err = w.updateWorkTool(ctx, toolReq, updateWorkInput{ID: id, Text: &text})
	must(t, err)
	if _, _, err = w.updateWorkTool(ctx, toolReq, updateWorkInput{ID: id, ModelID: strPtr("stable-audio-3-small-music-q8")}); err == nil {
		t.Fatal("音效作品不应改用音乐模型")
	}
	_, _, err = w.openPageTool(ctx, toolReq, pageInput{Page: "sfx"})
	must(t, err)
	if nav := w.Store.Read().AssistantLive.Nav; nav == nil || nav.Page != "sfx" || pageCardLabels["sfx"][0] == "" || pageLabels["sfx"] == "" {
		t.Fatal("助手音效页面未接入")
	}

	executable := selfExecutable(t)
	model := filepath.Join(w.Store.Root, "models", "sfx.gguf")
	must(t, os.WriteFile(model, []byte("test"), 0600))
	must(t, w.Store.Update(func(s *schema.State) {
		s.Models = []schema.InstalledModel{{ID: "stable-audio-3-small-sfx-q8", Path: model}}
		s.RuntimePath = &executable
		s.RuntimeBackend = ptr("cpu")
		s.RuntimeVersion = ptr(catalog.EngineVersion)
		s.Preferences.Backend = "cpu"
	}, true))
	must(t, w.assistantModelCheck("stable-audio-3-small-sfx-q8", "music"))
	d, err = w.assistantWork(id)
	must(t, err)
	if d.Text != text {
		t.Fatal("助手更新音效描述失败")
	}
	_, _, err = w.generateWorkTool(ctx, toolReq, generateWorkInput{ID: id})
	must(t, err)
	<-w.Done()
	state := w.Store.Read()
	if state.Activity == nil || state.Activity.Status != "completed" || len(state.History) != 1 || state.History[0].Settings.Kind != "sfx" {
		t.Fatalf("助手音效生成未完成：%+v", state.Activity)
	}
}

func TestPreferredSFXModel(t *testing.T) {
	if modelKind("stable-audio-3-small-sfx-q8") != "sfx" || modelKind("stable-audio-3-small-music-q8") != "music" {
		t.Fatal("Stable Audio variant 分类不对")
	}
	if got := preferredModel(schema.State{}, "sfx", ""); got != "stable-audio-3-small-sfx-q8" {
		t.Fatal("无已下载模型时音效默认模型不对", got)
	}
	s := schema.State{Models: []schema.InstalledModel{{ID: "stable-audio-3-small-music-q8"}, {ID: "stable-audio-3-small-sfx-f16"}, {ID: "stable-audio-3-small-sfx-q8"}}}
	if got := preferredModel(s, "sfx", ""); got != "stable-audio-3-small-sfx-f16" {
		t.Fatal("应优先选择已下载 SFX 模型", got)
	}
	now := time.Now()
	s.Drafts = []schema.Draft{{Kind: "sfx", SynthesisSettings: schema.SynthesisSettings{ModelID: "stable-audio-3-small-sfx-q8"}, UpdatedAt: &now}}
	if got := preferredModel(s, "sfx", ""); got != "stable-audio-3-small-sfx-q8" {
		t.Fatal("应沿用最近音效作品的已下载模型", got)
	}
}
