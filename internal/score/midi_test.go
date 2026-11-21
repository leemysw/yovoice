package score

import (
	"crypto/sha256"
	"fmt"
	"testing"
	"yovoice/internal/schema"
)

var midiExportSizes = []struct {
	name        string
	notes, bars int
	hash        string
}{
	{"realistic", 500, 32, "399302888d59055424bd63beaea731fda2d27b03bc8019d59ae47953d7fd5766"},
	{"medium", 5000, 128, "8ef66afe22c5d690d551bcb206ed38353054db784654844b81c2bf5d48e8e5e6"},
	{"large", 20000, 512, "ce8ed9692fd78f8e48b2ea06588eee5a3dfc608f53a62aa364fd284e337f4707"},
}

func midiExportScore(notes, bars int) schema.Score {
	s := schema.Score{Tempo: 240, TimeSignature: []int{4, 4}, Sections: []schema.ScoreSection{
		{Name: "前段", Start: 1, End: bars / 2},
		{Name: "后段", Start: bars/2 + 1, End: bars, Tempo: 220},
	}}
	for track := range 4 {
		s.Tracks = append(s.Tracks, schema.ScoreTrack{ID: fmt.Sprint(track), Name: fmt.Sprintf("声部 %d", track), Program: track * 16, Drums: track == 3})
	}
	for i := range notes {
		track := i % len(s.Tracks)
		position := i / len(s.Tracks)
		s.Tracks[track].Notes = append(s.Tracks[track].Notes, schema.ScoreNote{
			Bar: position%bars + 1, Beat: 1 + float64(position/bars%16)/4,
			Pitch: 48 + position%36, Length: .25, Velocity: 80 + i%32,
		})
	}
	return s
}

func TestMIDIExportHashes(t *testing.T) {
	for _, size := range midiExportSizes {
		t.Run(size.name, func(t *testing.T) {
			data, err := MIDI(midiExportScore(size.notes, size.bars))
			if err != nil {
				t.Fatal(err)
			}
			got := fmt.Sprintf("%x", sha256.Sum256(data))
			t.Logf("sha256: %s", got)
			if got != size.hash {
				t.Fatalf("sha256 = %s, want %s", got, size.hash)
			}
		})
	}
}

func TestMIDIInvalidScore(t *testing.T) {
	for name, s := range map[string]schema.Score{
		"empty":         {},
		"no notes":      {Tempo: 120, TimeSignature: []int{4, 4}, Tracks: []schema.ScoreTrack{{ID: "lead", Name: "钢琴"}}},
		"invalid tempo": {Tempo: 10, TimeSignature: []int{4, 4}},
	} {
		t.Run(name, func(t *testing.T) {
			if data, err := MIDI(s); err == nil || data != nil {
				t.Fatalf("MIDI = %x, %v; want nil data and error", data, err)
			}
		})
	}
}

func BenchmarkMIDI(b *testing.B) {
	for _, size := range midiExportSizes {
		b.Run(size.name, func(b *testing.B) {
			s := midiExportScore(size.notes, size.bars)
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				if _, err := MIDI(s); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
