package workbench

import (
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
