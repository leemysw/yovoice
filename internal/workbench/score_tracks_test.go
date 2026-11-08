package workbench

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
	"yovoice/internal/testkit"
)

// 分轨工作台逐轨试听：每条有音符的轨道单独渲染一段音频，空轨跳过；再次渲染时清掉上一批文件。
func TestRenderScoreTracks(t *testing.T) {
	wb, err := New(t.TempDir())
	must(t, err)
	defer wb.Close()
	sc := schema.Score{Tempo: 120, TimeSignature: []int{4, 4}, Tracks: []schema.ScoreTrack{
		{ID: "piano", Name: "钢琴", Role: "piano", Notes: []schema.ScoreNote{{Bar: 1, Beat: 1, Pitch: 62, Length: 2, Velocity: 90}}},
		{ID: "bass", Name: "贝斯", Role: "bass", Mute: true, Notes: []schema.ScoreNote{{Bar: 1, Beat: 1, Pitch: 40, Length: 1, Velocity: 90}}},
		{ID: "empty", Name: "空轨", Role: "pad", Notes: []schema.ScoreNote{}},
	}}
	var ce *msg.CallError
	if _, err := wb.RenderScoreTracks(context.Background(), sc); !errors.As(err, &ce) || ce.Code != msg.ErrMelodySoundFontRequired {
		t.Fatalf("未装音色库应提示下载：%v", err)
	}
	font := filepath.Join(wb.Store.Root, "models", "test.sf2")
	must(t, os.MkdirAll(filepath.Dir(font), 0700))
	must(t, os.WriteFile(font, testkit.SoundFont(), 0600))
	must(t, wb.Store.Update(func(s *schema.State) { s.Models = []schema.InstalledModel{{ID: "musescore-general-sf2", Path: font}} }, true))
	first, err := wb.RenderScoreTracks(context.Background(), sc)
	must(t, err)
	// 静音的轨道也单独渲染，由工作台决定是否播放；没有音符的轨道跳过。
	if len(first) != 2 || first[0].ID != "piano" || first[1].ID != "bass" || first[0].FileName == first[1].FileName {
		t.Fatalf("%+v", first)
	}
	for _, track := range first {
		path, err := wb.Store.MediaPath("outputs", track.FileName)
		must(t, err)
		if info, err := os.Stat(path); err != nil || info.Size() < 1000 {
			t.Fatalf("%s: %v", track.FileName, err)
		}
	}
	second, err := wb.RenderScoreTracks(context.Background(), sc)
	must(t, err)
	old, _ := wb.Store.MediaPath("outputs", first[0].FileName)
	if _, err := os.Stat(old); !os.IsNotExist(err) || second[0].FileName == first[0].FileName {
		t.Fatal("再次渲染应清掉上一批试听文件")
	}
}
