package score

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"math"
	"os"
	"path/filepath"
	"testing"
	"yovoice/internal/audio"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
	"yovoice/internal/testkit"
)

func sample() schema.Score {
	s := schema.Score{Tempo: 120, TimeSignature: []int{4, 4}, Key: "D minor", Sections: []schema.ScoreSection{{Name: "前奏", Start: 1, End: 2}, {Name: "回落", Start: 3, End: 4, Tempo: 60}}}
	lead := schema.ScoreTrack{ID: "lead", Name: "钢琴", Role: "piano", Program: 0, Pan: -.3, Reverb: .2, Humanize: &schema.Humanize{Velocity: 6, TimingMs: 5}, Dynamics: []schema.ScoreRamp{{Start: 3, End: 4, From: 1, To: .3}}}
	drums := schema.ScoreTrack{ID: "drums", Name: "鼓", Role: "drums", Drums: true}
	for bar := 1; bar <= 4; bar++ {
		for beat := 1; beat <= 4; beat++ {
			lead.Notes = append(lead.Notes, schema.ScoreNote{Bar: bar, Beat: float64(beat), Pitch: 62 + beat, Length: 1, Velocity: 80})
			drums.Notes = append(drums.Notes, schema.ScoreNote{Bar: bar, Beat: float64(beat) + .5, Pitch: 42, Length: .25, Velocity: 60})
		}
	}
	s.Tracks = []schema.ScoreTrack{lead, drums}
	return s
}

func TestTimingFollowsSectionTempo(t *testing.T) {
	s := sample()
	// 前两小节 120 BPM 共 4 秒，后两小节 60 BPM 共 8 秒。
	if got := s.Seconds(3, 1); got != 4 {
		t.Fatal(got)
	}
	if got := s.Duration(); got != 12 {
		t.Fatal(got)
	}
	if got := s.Seconds(3, 2.5); got != 5.5 {
		t.Fatal(got)
	}
}

func TestValidateScore(t *testing.T) {
	s := sample()
	testkit.Must(t, schema.ValidateScore(&s))
	for name, broken := range map[string]func(*schema.Score){
		"拍号":   func(s *schema.Score) { s.TimeSignature = []int{4, 3} },
		"速度":   func(s *schema.Score) { s.Tempo = 10 },
		"拍位越界": func(s *schema.Score) { s.Tracks[0].Notes[0].Beat = 5 },
		"重复声部": func(s *schema.Score) { s.Tracks[1].ID = "lead" },
		"音高":   func(s *schema.Score) { s.Tracks[0].Notes[0].Pitch = 128 },
		"没有音符": func(s *schema.Score) { s.Tracks[0].Notes, s.Tracks[1].Notes = nil, nil },
		"过长":   func(s *schema.Score) { s.Tracks[0].Notes[0].Bar = 400; s.Tempo = 30 },
	} {
		c := sample()
		c.Tracks = []schema.ScoreTrack{c.Tracks[0], c.Tracks[1]}
		c.Tracks[0].Notes = append([]schema.ScoreNote{}, c.Tracks[0].Notes...)
		broken(&c)
		var ce *msg.CallError
		if err := schema.ValidateScore(&c); !errors.As(err, &ce) || ce.Code != msg.ErrScoreInvalid {
			t.Errorf("%s 应校验失败：%v", name, err)
		}
	}
}

func TestMIDIRoundTrip(t *testing.T) {
	s := sample()
	data, err := MIDI(s)
	testkit.Must(t, err)
	back, err := FromMIDI(data)
	testkit.Must(t, err)
	if back.Tempo != 120 || back.TimeSignature[0] != 4 || back.TimeSignature[1] != 4 || len(back.Tracks) != 2 {
		t.Fatalf("%+v", back)
	}
	if back.Tracks[0].Name != "钢琴" || !back.Tracks[1].Drums || len(back.Tracks[0].Notes) != 16 {
		t.Fatalf("%+v", back.Tracks)
	}
	// 回落段 60 BPM 的速度事件忽略后，音符仍按拍位置还原。
	if n := back.Tracks[0].Notes[9]; n.Bar != 3 || n.Beat != 2 || n.Pitch != 64 || n.Length != 1 || n.Velocity != 80 {
		t.Fatalf("%+v", n)
	}
	if n := back.Tracks[1].Notes[0]; n.Beat != 1.5 || n.Length != .25 {
		t.Fatalf("%+v", n)
	}
	var ce *msg.CallError
	if _, err := FromMIDI([]byte("not midi")); !errors.As(err, &ce) || ce.Code != msg.ErrMidiInvalid {
		t.Fatal(err)
	}
	if _, err := FromMIDI(data[:len(data)-10]); err == nil {
		t.Fatal("截断的 MIDI 应失败")
	}
}

func TestRenderAlignsTrackLevels(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.sf2")
	testkit.Must(t, os.WriteFile(path, testkit.SoundFont(), 0600))
	sf, err := LoadSoundFont(path)
	testkit.Must(t, err)
	s := sample()
	s.Tracks[1].Mute = true
	s.Tracks[0].Level = -18
	out, stems := filepath.Join(dir, "mix.wav"), filepath.Join(dir, "stems")
	testkit.Must(t, os.Mkdir(stems, 0700))
	calls := 0
	testkit.Must(t, Render(context.Background(), sf, s, out, stems, func(done, total int) { calls++ }))
	duration, err := audio.Duration(out)
	testkit.Must(t, err)
	if math.Abs(duration-(12+tailSeconds)) > .01 || calls != 1 {
		t.Fatal(duration, calls)
	}
	entries, _ := os.ReadDir(stems)
	if len(entries) != 1 || entries[0].Name() != "01-lead.wav" {
		t.Fatal(entries)
	}
	left, right := readWAV(t, filepath.Join(stems, "01-lead.wav"))
	if level := activeLevel(left, right); math.Abs(level+18) > .5 {
		t.Fatalf("声部电平 %.1f dB，应接近 -18", level)
	}
	// 渐弱段最后一拍明显轻于开头。
	head, tail := rms(left[:SampleRate]), rms(left[SampleRate*11:SampleRate*12])
	if tail > head*.6 {
		t.Fatal(head, tail)
	}
	// 同一份乐谱重复渲染结果一致（人性化偏移可复现）。
	again := filepath.Join(dir, "again.wav")
	testkit.Must(t, Render(context.Background(), sf, s, again, "", nil))
	a, _ := os.ReadFile(out)
	b, _ := os.ReadFile(again)
	if !bytes.Equal(a, b) {
		t.Fatal("渲染结果不可复现")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := Render(ctx, sf, s, filepath.Join(dir, "cancel.wav"), "", nil); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}

func readWAV(t *testing.T, path string) ([]float32, []float32) {
	data, err := os.ReadFile(path)
	testkit.Must(t, err)
	frames := (len(data) - 44) / 4
	left, right := make([]float32, frames), make([]float32, frames)
	for i := range frames {
		left[i] = float32(int16(binary.LittleEndian.Uint16(data[44+i*4:]))) / 32767
		right[i] = float32(int16(binary.LittleEndian.Uint16(data[46+i*4:]))) / 32767
	}
	return left, right
}

func rms(v []float32) float64 {
	sum := 0.0
	for _, x := range v {
		sum += float64(x) * float64(x)
	}
	return math.Sqrt(sum / float64(len(v)))
}
