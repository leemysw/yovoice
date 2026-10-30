package workbench

import (
	"archive/zip"
	"os"
	"path/filepath"
	"testing"
	"yovoice/internal/schema"
	"yovoice/internal/store"
)

func TestProjectArchiveAndRecovery(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	d := schema.DefaultDraft()
	foreign := d
	foreign.ID = schema.NewID()
	g := schema.Generation{ID: schema.NewID(), FileName: "source.wav", Duration: 1, Settings: foreign}
	v := schema.Voice{ID: schema.NewID(), Name: "参考", FileName: "reference.wav", Duration: 1}
	c := schema.Character{ID: schema.NewID(), Name: "旁白", Settings: schema.SynthesisSettings{VoiceID: ptr(v.ID)}}
	d.CharacterID = c.ID
	d.VoiceID = ptr(v.ID)
	must(t, os.WriteFile(filepath.Join(w.Store.Root, "voices", v.FileName), wav(), 0600))
	must(t, os.WriteFile(filepath.Join(w.Store.Root, "outputs", g.FileName), wav(), 0600))
	must(t, w.Store.Update(func(s *schema.State) {
		s.History = []schema.Generation{g}
		s.Voices = []schema.Voice{v}
		s.Characters = []schema.Character{c}
	}, true))
	d.Timeline = &schema.AudioTimeline{Markers: []schema.AudioMarker{{ID: "scene", Name: "开场", Time: .1}}, Tracks: []schema.AudioLane{{ID: "lane", Name: "对白", Solo: true, GainDB: -3, Clips: []schema.AudioClip{{ID: "clip", GenerationID: g.ID, Duration: .8, Offset: .1, FadeIn: .1}}}}}
	must(t, w.SaveDraft(d))
	archive := filepath.Join(t.TempDir(), "project.yovoice")
	must(t, w.ExportProject(d.ID, archive))
	copy, err := w.ImportProject(archive)
	must(t, err)
	if copy.ID == d.ID || copy.Timeline.Tracks[0].Clips[0].GenerationID == g.ID || copy.Timeline.Tracks[0].GainDB != -3 || copy.Timeline.Markers[0].Name != "开场" {
		t.Fatal("工程副本身份或编辑丢失")
	}
	state := w.Store.Read()
	if state.History[0].Settings.ID != copy.ID {
		t.Fatal("工程副本版本未隔离")
	}
	// 内容完全相同的参考音频与角色直接复用，重复导入不会堆积副本。
	if copy.CharacterID != c.ID || schema.Deref(copy.VoiceID) != v.ID || len(state.Voices) != 1 || len(state.Characters) != 1 {
		t.Fatal("重复导入产生了重复的音色或角色", len(state.Voices), len(state.Characters))
	}
	if voices, _ := os.ReadDir(filepath.Join(w.Store.Root, "voices")); len(voices) != 1 {
		t.Fatal("复用音色仍写入了重复文件", len(voices))
	}
	// 角色内容有差异时仍导入为独立副本。
	edited := state.Characters[0]
	edited.DemoText = "改过的示例"
	must(t, w.Store.Update(func(s *schema.State) { s.Characters[0] = edited }, true))
	other, err := w.ImportProject(archive)
	must(t, err)
	state = w.Store.Read()
	if other.CharacterID == c.ID || len(state.Characters) != 2 || schema.Deref(other.VoiceID) != v.ID || schema.Deref(state.Characters[1].Settings.VoiceID) != v.ID {
		t.Fatal("有差异的角色未独立导入")
	}
	id := copy.Timeline.Tracks[0].Clips[0].GenerationID
	file, err := w.MediaFile("outputs", id)
	must(t, err)
	if _, err = os.Stat(file); err != nil {
		t.Fatal(err)
	}
	// 每次打开都会刷新备份，状态库损坏后从备份恢复工程。
	copy.Title = "第二次保存"
	must(t, w.SaveDraft(copy))
	_, err = store.New(w.Store.Root)
	must(t, err)
	must(t, os.WriteFile(filepath.Join(w.Store.Root, store.DatabaseFile), []byte("broken"), 0600))
	recovered, err := store.New(w.Store.Root)
	must(t, err)
	if len(recovered.Read().Drafts) < 3 {
		t.Fatal("备份未恢复工程")
	}
	corrupt, _ := filepath.Glob(filepath.Join(w.Store.Root, "yovoice.corrupt-*.db"))
	if len(corrupt) != 1 {
		t.Fatal("损坏原件未保留")
	}
	// 路径穿越、重复文件和不完整工程不能导入，也不能产生草稿。
	invalid := filepath.Join(t.TempDir(), "bad.yovoice")
	f, err := os.Create(invalid)
	must(t, err)
	z := zip.NewWriter(f)
	entry, _ := z.Create("../escape")
	_, err = entry.Write([]byte("bad"))
	must(t, err)
	must(t, z.Close())
	must(t, f.Close())
	before := len(w.Store.Read().Drafts)
	if _, err = w.ImportProject(invalid); err == nil {
		t.Fatal("接受非法归档")
	}
	if len(w.Store.Read().Drafts) != before {
		t.Fatal("失败导入创建了草稿")
	}
}
