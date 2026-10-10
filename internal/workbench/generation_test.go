package workbench

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"yovoice/internal/catalog"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
)

// 历史快照不携带时间轴，作品自身的时间轴保持不变。
func TestGenerationSnapshotOmitsTimeline(t *testing.T) {
	wb, err := New(t.TempDir())
	must(t, err)
	defer wb.Close()
	executable, err := os.Executable()
	must(t, err)
	model := filepath.Join(wb.Store.Root, "models", "fake.gguf")
	must(t, os.WriteFile(model, []byte("test"), 0600))
	reference := filepath.Join(t.TempDir(), "reference.wav")
	must(t, os.WriteFile(reference, wav(), 0600))
	voice, err := wb.ImportVoice(context.Background(), reference, "")
	must(t, err)
	must(t, wb.Store.Update(func(s *schema.State) {
		s.Models = []schema.InstalledModel{{ID: "index-2.5-q8", Path: model}}
		s.RuntimePath = &executable
		s.RuntimeBackend = ptr("cpu")
		s.RuntimeVersion = ptr(catalog.EngineVersion)
		s.Preferences.Backend = "cpu"
	}, true))
	d := schema.DefaultDraft()
	d.VoiceID = &voice.ID
	d.Timeline = &schema.AudioTimeline{Tracks: []schema.AudioLane{{ID: "lane", Name: "旁白", Clips: []schema.AudioClip{}}}}
	must(t, wb.Generate(d))
	done := wb.Done()
	<-done
	state := wb.Store.Read()
	if state.Activity == nil || state.Activity.Status != "completed" || len(state.History) != 1 {
		t.Fatalf("%+v", state.Activity)
	}
	if state.History[0].Settings.Timeline != nil {
		t.Fatal("历史快照不应携带时间轴")
	}
	if state.Drafts[0].ID != d.ID || state.Drafts[0].Timeline == nil {
		t.Fatal("作品时间轴应保留")
	}
}

// 音乐模型需要较新的内核：仅满足应用最低版本时拒绝生成并提示更新，升级后完成闭环。
func TestMusicGenerationRequiresEngineVersion(t *testing.T) {
	wb, err := New(t.TempDir())
	must(t, err)
	defer wb.Close()
	executable, err := os.Executable()
	must(t, err)
	model := filepath.Join(wb.Store.Root, "models", "ace-step.gguf")
	must(t, os.WriteFile(model, []byte("test"), 0600))
	install := func(version string) {
		must(t, wb.Store.Update(func(s *schema.State) {
			s.Models = []schema.InstalledModel{{ID: "ace-step-1.5-turbo-bf16", Path: model}}
			s.RuntimePath = &executable
			s.RuntimeBackend = ptr("cpu")
			s.RuntimeVersion = ptr(version)
			s.Preferences.Backend = "cpu"
		}, true))
	}
	d := schema.DefaultDraft()
	d.Kind, d.ModelID, d.Text, d.Lyrics = "music", "ace-step-1.5-turbo-bf16", "city pop, chill", "[verse]\n晚风"
	install(catalog.EngineMinimum)
	if catalog.EngineMinimum != "v0.9.1" {
		var ce *msg.CallError
		if err := wb.Generate(d); !errors.As(err, &ce) || ce.Code != msg.ErrEngineUpgradeRequired {
			t.Fatalf("旧内核应提示更新：%v", err)
		}
	}
	install(catalog.EngineVersion)
	must(t, wb.Generate(d))
	<-wb.Done()
	state := wb.Store.Read()
	if state.Activity == nil || state.Activity.Status != "completed" || len(state.History) != 1 || state.History[0].Settings.Lyrics != d.Lyrics || state.Drafts[0].Kind != "music" {
		t.Fatalf("%+v", state.Activity)
	}
}
