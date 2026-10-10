package workbench

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"yovoice/internal/catalog"
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
