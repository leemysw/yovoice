package workbench

import (
	"os"
	"path/filepath"
	"slices"
	"testing"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
)

// 分轨结果和片段不能再分；没装分轨或扒谱模型时给出对应提示，而不是笼统的识别模型提示。
func TestStemAndMidiValidation(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	song, stem, fresh := schema.NewID(), schema.NewID(), schema.NewID()
	must(t, w.Store.Update(func(s *schema.State) {
		s.History = append(s.History,
			schema.Generation{ID: song, Title: "Song", FileName: "song.wav", Duration: 30},
			schema.Generation{ID: fresh, Title: "Fresh", FileName: "fresh.wav", Duration: 30},
			schema.Generation{ID: stem, Title: "Song", FileName: "song-vocals.wav", Duration: 30, StemOf: song, Stem: "vocals"})
	}, true))
	if err = w.SeparateStems(stem); !isCode(err, msg.ErrStemSource) {
		t.Fatalf("分轨结果不应再分：%v", err)
	}
	if err = w.SeparateStems(song); err != nil {
		t.Fatalf("已分过轨的版本应直接返回：%v", err)
	}
	if err = w.SeparateStems(fresh); !isCode(err, msg.ErrStemModelRequired) {
		t.Fatalf("没装分轨模型时应提示下载：%v", err)
	}
	if err = w.TranscribeMIDI(fresh); !isCode(err, msg.ErrMidiModelRequired) {
		t.Fatalf("没装扒谱模型时应提示下载：%v", err)
	}
	if err = w.SeparateStems("../x"); err == nil {
		t.Fatal("无效 ID 应被拒绝")
	}
}

// 导出分轨：原混音和各轨按 DAW 顺序命名，放进新建的文件夹；同名文件夹已存在时另起一个。
func TestExportStems(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	song, vocals, drums, lone := schema.NewID(), schema.NewID(), schema.NewID(), schema.NewID()
	for _, name := range []string{"mix.wav", "vocals.wav", "drums.wav", "lone.wav"} {
		path, e := w.Store.MediaPath("outputs", name)
		must(t, e)
		must(t, os.WriteFile(path, []byte(name), 0600))
	}
	must(t, w.Store.Update(func(s *schema.State) {
		s.History = append(s.History,
			schema.Generation{ID: song, Title: "夜航 / Night: v2", FileName: "mix.wav"},
			schema.Generation{ID: drums, Title: "夜航", FileName: "drums.wav", StemOf: song, Stem: "drums"},
			schema.Generation{ID: vocals, Title: "夜航", FileName: "vocals.wav", StemOf: song, Stem: "vocals"},
			schema.Generation{ID: lone, Title: "Lone", FileName: "lone.wav"})
	}, true))
	dir := t.TempDir()
	folder, err := w.ExportStems(vocals, dir)
	must(t, err)
	if filepath.Base(folder) != "夜航 Night v2 Stems" {
		t.Fatalf("文件夹名不对：%s", folder)
	}
	entries, err := os.ReadDir(folder)
	must(t, err)
	var names []string
	for _, e := range entries {
		names = append(names, e.Name())
	}
	want := []string{"夜航 Night v2 - 00 Mix.wav", "夜航 Night v2 - 01 Vocals.wav", "夜航 Night v2 - 02 Drums.wav"}
	if !slices.Equal(names, want) {
		t.Fatalf("文件名不对：%v", names)
	}
	if b, _ := os.ReadFile(filepath.Join(folder, want[1])); string(b) != "vocals.wav" {
		t.Fatalf("内容不对：%s", b)
	}
	again, err := w.ExportStems(song, dir)
	must(t, err)
	if filepath.Base(again) != "夜航 Night v2 Stems (2)" {
		t.Fatalf("重复导出应另起文件夹：%s", again)
	}
	if _, err = w.ExportStems(lone, dir); !isCode(err, msg.ErrStemsMissing) {
		t.Fatalf("没有分轨时应提示：%v", err)
	}
	if _, err = w.ExportStems(song, "relative"); err == nil {
		t.Fatal("相对路径应被拒绝")
	}
}

func TestYueCandidates(t *testing.T) {
	for _, c := range []struct {
		value any
		want  int
	}{{nil, 1}, {float64(3), 3}, {float64(9), 4}, {float64(0), 1}, {"2", 1}} {
		d := schema.Draft{SynthesisSettings: schema.SynthesisSettings{ModelOptions: map[string]map[string]any{"yue2": {"candidates": c.value}}}}
		if got := yueCandidates(d); got != c.want {
			t.Fatalf("%v → %d", c.value, got)
		}
	}
}
