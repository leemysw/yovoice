package workbench

import (
	"math"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
	"yovoice/internal/audio"
	"yovoice/internal/catalog"
	"yovoice/internal/schema"
	"yovoice/internal/store"
)

func TestCharacterAndVoiceLifecycle(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	d := schema.DefaultDraft()
	id := schema.NewID()
	file := filepath.Join(w.Store.Root, "outputs", id+".wav")
	must(t, os.WriteFile(file, wav(), 0600))
	must(t, w.Store.Update(func(s *schema.State) {
		s.History = append(s.History, schema.Generation{ID: id, Title: "片段", FileName: id + ".wav", CreatedAt: time.Now(), Duration: 1, Settings: d})
	}, true))
	v, err := w.VoiceFromGeneration(id, "旁白音色", "校正后的原文", nil)
	must(t, err)
	if v.SourceGenerationID != id || v.ReferenceText != "校正后的原文" {
		t.Fatal(v)
	}
	must(t, w.DeleteMedia("outputs", id))
	voicePath, err := w.MediaFile("voices", v.ID)
	must(t, err)
	if _, err := os.Stat(voicePath); err != nil {
		t.Fatal("删除历史破坏了音色", err)
	}
	d.VoiceID = &v.ID
	c := schema.Character{ID: schema.NewID(), Name: "旁白", Settings: d.SynthesisSettings, DemoText: "试听台词"}
	c, err = w.SaveCharacter(c)
	must(t, err)
	if err := w.DeleteMedia("voices", v.ID); err == nil {
		t.Fatal("允许删除被角色引用的音色")
	}
	// 用已有协议测试进程完成实际任务调度，验证试听隔离与保存快照。
	executable, err := os.Executable()
	must(t, err)
	modelPath := filepath.Join(w.Store.Root, "model.gguf")
	must(t, os.WriteFile(modelPath, []byte("test"), 0600))
	must(t, w.Store.Update(func(s *schema.State) {
		s.Models = []schema.InstalledModel{{ID: d.ModelID, Path: modelPath}}
		s.RuntimePath = &executable
		s.RuntimeBackend = ptr("cpu")
		s.RuntimeVersion = ptr(catalog.EngineVersion)
	}, true))
	before := w.Store.Read().Drafts
	previewID, err := w.PreviewCharacter(c)
	must(t, err)
	done := w.Done()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("试听超时")
	}
	state := w.Store.Read()
	if state.Activity.Status != "completed" || len(state.Previews) != 1 {
		t.Fatal(state.Activity)
	}
	if len(state.History) != 0 || !reflect.DeepEqual(before, state.Drafts) {
		t.Fatal("试听污染了作品或历史")
	}
	c.Preview = &state.Previews[0]
	c.DemoText = "编辑中的新台词"
	c, err = w.SaveCharacter(c)
	must(t, err)
	if c.Preview.Text != "试听台词" || c.Preview.ID == previewID {
		t.Fatal("试听快照未独立保存", c)
	}
	must(t, w.DiscardPreview(previewID))
	savedPath, err := w.MediaFile("outputs", c.Preview.ID)
	must(t, err)
	if _, err := os.Stat(savedPath); err != nil {
		t.Fatal(err)
	}
	copy := c
	copy.ID = schema.NewID()
	copy.Name = "旁白副本"
	copy, err = w.SaveCharacter(copy)
	must(t, err)
	must(t, w.DeleteCharacter(c.ID))
	copyPath, err := w.MediaFile("outputs", copy.Preview.ID)
	must(t, err)
	if _, err := os.Stat(copyPath); err != nil {
		t.Fatal("删除原角色破坏了副本试听", err)
	}
	restored, err := store.New(w.Store.Root)
	must(t, err)
	if len(restored.Read().Characters) != 1 || restored.Read().Characters[0].Preview.Text != "试听台词" {
		t.Fatal("角色未恢复")
	}
	// 取消重生成不得修改已经保存的试听。
	copy.DemoText = "等待取消"
	_, err = w.PreviewCharacter(copy)
	must(t, err)
	done = w.Done()
	w.Cancel()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("取消超时")
	}
	if w.Store.Read().Characters[0].Preview.ID != copy.Preview.ID {
		t.Fatal("取消覆盖了原试听")
	}
	must(t, w.DeleteCharacter(copy.ID))
	must(t, w.DeleteMedia("voices", v.ID))
}

func TestVoiceFromGenerationExcerpt(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	id := schema.NewID()
	path := filepath.Join(w.Store.Root, "outputs", id+".wav")
	// 原音频超过参考音频上限；节选必须按用户范围保存，不能重新自动选段。
	must(t, audio.WriteMono(path, make([]float32, 16000*65), 16000))
	must(t, w.Store.Update(func(s *schema.State) {
		s.History = append(s.History, schema.Generation{ID: id, FileName: id + ".wav", Duration: 65})
	}, true))
	for _, span := range [][]float64{{}, {0}, {0, 61}, {-1, 2}, {64, 66}, {5, 4}, {0, .5}, {0, math.NaN()}, {0, math.Inf(1)}} {
		if _, err := w.VoiceFromGeneration(id, "节选", "", span); err == nil {
			t.Fatalf("接受了无效范围 %v", span)
		}
	}
	if len(w.Store.Read().Voices) != 0 {
		t.Fatal("失败的选段留下参考音频")
	}
	v, err := w.VoiceFromGeneration(id, "节选", "节选原文", []float64{60, 65})
	must(t, err)
	if v.Duration != 5 || v.Source != "generation" || v.SourceGenerationID != id || v.ReferenceText != "节选原文" {
		t.Fatal(v)
	}
	must(t, w.DeleteMedia("outputs", id))
	file, err := w.MediaFile("voices", v.ID)
	must(t, err)
	duration, err := audio.Duration(file)
	must(t, err)
	if duration != 5 {
		t.Fatalf("删除来源后节选损坏: %v", duration)
	}
	entries, err := os.ReadDir(filepath.Join(w.Store.Root, "downloads"))
	must(t, err)
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), "audio-") {
			t.Fatal("选段临时文件未清理", entry.Name())
		}
	}
}
