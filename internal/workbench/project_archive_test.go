package workbench

import (
	"archive/zip"
	"os"
	"path/filepath"
	"testing"
	"yovoice/internal/domain"
	"yovoice/internal/store"
)

func TestProjectArchiveAndRecovery(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	d := domain.DefaultDraft()
	foreign := d
	foreign.ID = domain.NewID()
	g := domain.Generation{ID: domain.NewID(), FileName: "source.wav", Duration: 1, Settings: foreign}
	v := domain.Voice{ID: domain.NewID(), Name: "参考", FileName: "reference.wav", Duration: 1}
	c := domain.Character{ID: domain.NewID(), Name: "旁白", Settings: domain.SynthesisSettings{VoiceID: ptr(v.ID)}}
	d.CharacterID = c.ID
	d.VoiceID = ptr(v.ID)
	must(t, os.WriteFile(filepath.Join(w.Store.Root, "voices", v.FileName), wav(), 0600))
	must(t, os.WriteFile(filepath.Join(w.Store.Root, "outputs", g.FileName), wav(), 0600))
	must(t, w.Store.Update(func(s *domain.State) {
		s.History = []domain.Generation{g}
		s.Voices = []domain.Voice{v}
		s.Characters = []domain.Character{c}
	}, true))
	d.Timeline = &domain.AudioTimeline{Markers: []domain.AudioMarker{{ID: "scene", Name: "开场", Time: .1}}, Tracks: []domain.AudioLane{{ID: "lane", Name: "对白", Solo: true, GainDB: -3, Clips: []domain.AudioClip{{ID: "clip", GenerationID: g.ID, Duration: .8, Offset: .1, FadeIn: .1}}}}}
	must(t, w.SaveDraft(d))
	archive := filepath.Join(t.TempDir(), "project.yovoice")
	must(t, w.ExportProject(d.ID, archive))
	copy, err := w.ImportProject(archive)
	must(t, err)
	if copy.ID == d.ID || copy.Timeline.Tracks[0].Clips[0].GenerationID == g.ID || copy.Timeline.Tracks[0].GainDB != -3 || copy.Timeline.Markers[0].Name != "开场" {
		t.Fatal("工程副本身份或编辑丢失")
	}
	state := w.Store.Read()
	if state.History[0].Settings.ID != copy.ID || copy.CharacterID == c.ID || value(copy.VoiceID) == v.ID || value(state.Characters[len(state.Characters)-1].Settings.VoiceID) != value(copy.VoiceID) {
		t.Fatal("工程副本引用未隔离")
	}
	id := copy.Timeline.Tracks[0].Clips[0].GenerationID
	file, err := w.MediaFile("outputs", id)
	must(t, err)
	if _, err = os.Stat(file); err != nil {
		t.Fatal(err)
	}
	// 备份保留上一次成功保存的工程，主文件损坏后仍可打开。
	copy.Title = "第二次保存"
	must(t, w.SaveDraft(copy))
	must(t, os.WriteFile(filepath.Join(w.Store.Root, "state.json"), []byte("broken"), 0600))
	recovered, err := store.New(w.Store.Root)
	must(t, err)
	if len(recovered.Read().Drafts) < 2 {
		t.Fatal("备份未恢复工程")
	}
	corrupt, _ := filepath.Glob(filepath.Join(w.Store.Root, "state.corrupt-*.json"))
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
