package main

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"yovoice/internal/schema"
	"yovoice/internal/store"
	"yovoice/internal/testkit"
)

// Agent 写好乐谱 JSON 后经 CLI 渲染混音与分轨，并能与 MIDI 互转。
func TestScoreCommands(t *testing.T) {
	dir := t.TempDir()
	data := filepath.Join(dir, "data")
	s := schema.Score{Tempo: 100, TimeSignature: []int{4, 4}, Tracks: []schema.ScoreTrack{
		{ID: "piano", Name: "钢琴", Role: "piano", Notes: []schema.ScoreNote{{Bar: 1, Beat: 1, Pitch: 62, Length: 1, Velocity: 90}, {Bar: 2, Beat: 3, Pitch: 65, Length: 2, Velocity: 80}}},
		{ID: "kick", Name: "底鼓", Role: "drums", Drums: true, Notes: []schema.ScoreNote{{Bar: 1, Beat: 1, Pitch: 36, Length: .5, Velocity: 100}}},
	}}
	raw, _ := json.Marshal(s)
	input := filepath.Join(dir, "score.json")
	testkit.Must(t, os.WriteFile(input, raw, 0600))
	run := func(args ...string) (map[string]any, error) {
		var out, progress bytes.Buffer
		err := run(context.Background(), append(args, "--data-dir", data), &out, &progress)
		var result map[string]any
		if err == nil {
			testkit.Must(t, json.Unmarshal(out.Bytes(), &result))
		}
		return result, err
	}
	if _, err := run("score", "render", input, "--output", filepath.Join(dir, "a.wav")); err == nil || !strings.Contains(err.Error(), "models download musescore-general-sf2") {
		t.Fatalf("未装音色库应提示下载：%v", err)
	}
	font := filepath.Join(dir, "test.sf2")
	testkit.Must(t, os.WriteFile(font, testkit.SoundFont(), 0600))
	st, err := store.New(data)
	testkit.Must(t, err)
	testkit.Must(t, st.Update(func(s *schema.State) { s.Models = []schema.InstalledModel{{ID: "musescore-general-sf2", Path: font}} }, true))
	result, err := run("score", "render", input, "--output", filepath.Join(dir, "mix.wav"), "--stems", filepath.Join(dir, "stems"))
	testkit.Must(t, err)
	if result["bars"] != float64(2) || result["duration"] != 4.8 {
		t.Fatal(result)
	}
	stems, _ := os.ReadDir(filepath.Join(dir, "stems"))
	if len(stems) != 2 || stems[0].Name() != "01-piano.wav" || stems[1].Name() != "02-kick.wav" {
		t.Fatal(stems)
	}
	if _, err := os.Stat(filepath.Join(dir, "mix.wav.part")); !os.IsNotExist(err) {
		t.Fatal("临时文件应清理")
	}
	if _, err := run("score", "render", input, "--output", filepath.Join(dir, "mix.wav")); err == nil || !strings.Contains(err.Error(), "已存在") {
		t.Fatalf("不应覆盖已有输出：%v", err)
	}
	stem := filepath.Join(dir, "stems", "02-kick.wav")
	original, err := os.ReadFile(stem)
	testkit.Must(t, err)
	testkit.Must(t, os.Remove(filepath.Join(dir, "stems", "01-piano.wav")))
	s.Tracks[1].Notes[0].Pitch = 38
	raw, err = json.Marshal(s)
	testkit.Must(t, err)
	testkit.Must(t, os.WriteFile(input, raw, 0600))
	if _, err := run("score", "render", input, "--output", filepath.Join(dir, "refused.wav"), "--stems", filepath.Join(dir, "stems")); err == nil || !strings.Contains(err.Error(), "已存在") {
		t.Errorf("不应覆盖已有分轨：%v", err)
	}
	current, err := os.ReadFile(stem)
	testkit.Must(t, err)
	if !bytes.Equal(original, current) {
		t.Error("已有分轨被修改")
	}
	for _, name := range []string{"refused.wav", "refused.wav.part", "stems/01-piano.wav"} {
		if _, err := os.Lstat(filepath.Join(dir, name)); !os.IsNotExist(err) {
			t.Errorf("拒绝渲染后不应留下 %s：%v", name, err)
		}
	}
	s.Tracks[1].Notes[0].Pitch = 36
	raw, err = json.Marshal(s)
	testkit.Must(t, err)
	testkit.Must(t, os.WriteFile(input, raw, 0600))
	_, err = run("score", "midi", input, "--output", filepath.Join(dir, "song.mid"))
	testkit.Must(t, err)
	_, err = run("score", "from-midi", filepath.Join(dir, "song.mid"), "--output", filepath.Join(dir, "back.json"))
	testkit.Must(t, err)
	var back schema.Score
	b, _ := os.ReadFile(filepath.Join(dir, "back.json"))
	testkit.Must(t, json.Unmarshal(b, &back))
	if back.Tempo != 100 || len(back.Tracks) != 2 || back.Tracks[0].Notes[1] != s.Tracks[0].Notes[1] {
		t.Fatalf("%+v", back)
	}
	_, err = run("score", "render", filepath.Join(dir, "song.mid"), "--output", filepath.Join(dir, "from-midi.wav"))
	testkit.Must(t, err)
}
