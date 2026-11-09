package workbench

import (
	"math"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"yovoice/internal/audio"
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
	if err = w.SeparateStems(stem, false); !isCode(err, msg.ErrStemSource) {
		t.Fatalf("分轨结果不应再分：%v", err)
	}
	if err = w.SeparateStems(song, false); err != nil {
		t.Fatalf("已分过轨的版本应直接返回：%v", err)
	}
	if err = w.SeparateStems(song, true); !isCode(err, msg.ErrStemModelRequired) {
		t.Fatalf("重新分离应真正执行，没装模型时提示下载：%v", err)
	}
	if err = w.SeparateStems(fresh, false); !isCode(err, msg.ErrStemModelRequired) {
		t.Fatalf("没装分轨模型时应提示下载：%v", err)
	}
	if err = w.TranscribeMIDI(fresh); !isCode(err, msg.ErrMidiModelRequired) {
		t.Fatalf("没装扒谱模型时应提示下载：%v", err)
	}
	if err = w.SeparateStems("../x", false); err == nil {
		t.Fatal("无效 ID 应被拒绝")
	}
}

// 删除分轨：原版本和别的版本保留，分轨记录和文件一并删掉；分轨在时间线上时整体拒绝，重新分离也一样。
func TestDeleteStems(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	song, vocals, drums, other := schema.NewID(), schema.NewID(), schema.NewID(), schema.NewID()
	paths := map[string]string{}
	for _, name := range []string{"mix.wav", "vocals.wav", "drums.wav", "other.wav"} {
		path, e := w.Store.MediaPath("outputs", name)
		must(t, e)
		must(t, os.WriteFile(path, []byte(name), 0600))
		paths[name] = path
	}
	draft := schema.DefaultDraft()
	draft.Timeline = &schema.AudioTimeline{Tracks: []schema.AudioLane{{ID: schema.NewID(), Clips: []schema.AudioClip{{ID: schema.NewID(), GenerationID: drums}}}}, AcceptedGenerations: []string{vocals}}
	must(t, w.Store.Update(func(s *schema.State) {
		s.Drafts = append(s.Drafts, draft)
		s.History = append(s.History,
			schema.Generation{ID: song, Title: "Song", FileName: "mix.wav", Duration: 30},
			schema.Generation{ID: vocals, Title: "Song", FileName: "vocals.wav", StemOf: song, Stem: "vocals"},
			schema.Generation{ID: drums, Title: "Song", FileName: "drums.wav", StemOf: song, Stem: "drums"},
			schema.Generation{ID: other, Title: "Other", FileName: "other.wav"})
	}, true))
	if err = w.DeleteStems(song); !isCode(err, msg.ErrTimelineInUse) {
		t.Fatalf("分轨在时间线上时应拒绝删除：%v", err)
	}
	if err = w.SeparateStems(song, true); !isCode(err, msg.ErrTimelineInUse) {
		t.Fatalf("分轨在时间线上时应拒绝重新分离：%v", err)
	}
	if _, e := os.Stat(paths["vocals.wav"]); e != nil || len(w.Store.Read().History) != 4 {
		t.Fatal("拒绝时不应动任何分轨")
	}
	must(t, w.Store.Update(func(s *schema.State) { s.Drafts[len(s.Drafts)-1].Timeline.Tracks[0].Clips = nil }, true))
	must(t, w.DeleteStems(song))
	s := w.Store.Read()
	var ids []string
	for _, g := range s.History {
		ids = append(ids, g.ID)
	}
	if !slices.Equal(ids, []string{song, other}) {
		t.Fatalf("应只删分轨：%v", ids)
	}
	for name, path := range paths {
		_, e := os.Stat(path)
		if gone := os.IsNotExist(e); gone != (name == "vocals.wav" || name == "drums.wav") {
			t.Fatalf("%s 文件状态不对：%v", name, e)
		}
	}
	if accepted := s.Drafts[len(s.Drafts)-1].Timeline.AcceptedGenerations; len(accepted) != 0 {
		t.Fatalf("已采纳标记应一并清掉：%v", accepted)
	}
	must(t, w.DeleteStems(song))
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

// 分轨整理：分过人声时人声轨换成 BS-RoFormer 的结果；“其他”= 原曲减其余各轨，六轨相加还原原曲。
func TestCompleteStems(t *testing.T) {
	dir := t.TempDir()
	const rate, n = 8000, 4000
	wave := func(scale, freq float64) []float32 {
		out := make([]float32, n)
		for i := range out {
			out[i] = float32(scale * math.Sin(float64(i)*freq))
		}
		return out
	}
	mix := wave(.6, .01)
	files := map[string][]float32{"drums": wave(.1, .2), "bass": wave(.1, .02), "vocals": wave(.1, .05), "guitar": wave(.05, .07), "piano": wave(.05, .09), "other": wave(.01, .3)}
	for name, samples := range files {
		must(t, audio.WriteMono(filepath.Join(dir, name+".wav"), samples, rate))
	}
	must(t, audio.WriteMono(filepath.Join(dir, "mix.wav"), mix, rate))
	clean := wave(.2, .05)
	vocals := filepath.Join(t.TempDir(), "roformer-vocals.wav")
	must(t, audio.WriteMono(vocals, clean, rate))
	must(t, completeStems(filepath.Join(dir, "mix.wav"), dir, vocals, StemNames))
	read := func(name string) []float32 {
		channels, _, e := audio.Read(filepath.Join(dir, name+".wav"))
		must(t, e)
		return channels[0]
	}
	if got := read("vocals"); math.Abs(float64(got[100]-clean[100])) > 1e-3 {
		t.Fatal("人声轨应换成 BS-RoFormer 的结果")
	}
	sum := make([]float64, n)
	for _, stem := range StemNames {
		for i, v := range read(stem) {
			sum[i] += float64(v)
		}
	}
	for i := range mix {
		if math.Abs(sum[i]-float64(mix[i])) > 4.0/32768 {
			t.Fatalf("frame %d: 各轨之和 %f ≠ 原曲 %f", i, sum[i], mix[i])
		}
	}
}
