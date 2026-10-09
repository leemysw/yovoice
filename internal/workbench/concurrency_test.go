package workbench

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"testing"
	"time"
	"yovoice/internal/schema"
)

// 导入音频只在提交时短暂写入状态，接收和转码期间不阻塞作品保存等编辑。
func TestLongImportDoesNotBlockEdits(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	reader, writer := io.Pipe()
	imported := make(chan error, 1)
	go func() {
		_, err := w.ImportVoiceFrom(context.Background(), reader, "慢速上传")
		imported <- err
	}()
	d := schema.DefaultDraft()
	d.Title = "导入期间保存"
	saved := make(chan error, 1)
	go func() { saved <- w.SaveDraft(d) }()
	select {
	case err := <-saved:
		must(t, err)
	case <-time.After(5 * time.Second):
		t.Fatal("导入期间保存被阻塞")
	}
	must(t, w.SetModelDirectory(filepath.Join(t.TempDir(), "models")))
	_, err = writer.Write(wav())
	must(t, err)
	must(t, writer.Close())
	must(t, <-imported)
	if voices := w.Store.Read().Voices; len(voices) != 1 || voices[0].Name != "慢速上传" {
		t.Fatal("导入结果不正确", voices)
	}
}

// 并发保存时间线引用与删除生成音频时，作品不能引用已删除的音频。
func TestConcurrentSaveAndDeleteKeepReferences(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	d := schema.DefaultDraft()
	must(t, w.SaveDraft(d))
	for range 100 {
		id := schema.NewID()
		must(t, os.WriteFile(filepath.Join(w.Store.Root, "outputs", id+".wav"), wav(), 0600))
		must(t, w.Store.Update(func(s *schema.State) {
			s.History = append(s.History, schema.Generation{ID: id, Title: "片段", FileName: id + ".wav", Duration: 1, Settings: d})
		}, true))
		next := d
		next.Timeline = &schema.AudioTimeline{Tracks: []schema.AudioLane{{ID: "lane", Name: "旁白", Clips: []schema.AudioClip{{ID: "clip-" + id, GenerationID: id, Duration: 1}}}}}
		var wg sync.WaitGroup
		wg.Add(2)
		go func() { defer wg.Done(); _ = w.SaveDraft(next) }()
		go func() { defer wg.Done(); _ = w.DeleteMedia("outputs", id) }()
		wg.Wait()
		state := w.Store.Read()
		draft := state.Drafts[slices.IndexFunc(state.Drafts, func(v schema.Draft) bool { return v.ID == d.ID })]
		referenced := draft.Timeline != nil && len(draft.Timeline.Tracks[0].Clips) == 1 && draft.Timeline.Tracks[0].Clips[0].GenerationID == id
		exists := slices.ContainsFunc(state.History, func(g schema.Generation) bool { return g.ID == id })
		if referenced && !exists {
			t.Fatal("作品引用了已删除的音频")
		}
		// 解除引用，下一轮从无引用状态开始。
		must(t, w.SaveDraft(d))
	}
}
