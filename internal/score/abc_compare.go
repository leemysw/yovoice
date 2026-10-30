package score

import "slices"

// ABCChanges 是两版谱之间按音符事件比较的结果，小节号从 1 起。
type ABCChanges struct {
	Tempo  bool   `json:"tempo,omitempty"`
	Key    bool   `json:"key,omitempty"`
	Vocal  []int  `json:"vocal,omitempty"`
	Ins    []int  `json:"ins,omitempty"`
	Chords []int  `json:"chords,omitempty"`
	Bars   [2]int `json:"bars"`
}

// CompareABC 按小节比较音高、起点、时值与和弦，而不是比较字符；连音线写法不同但发声相同视为未改。
func CompareABC(before, after *ABCScore) ABCChanges {
	c := ABCChanges{Tempo: before.Tempo != after.Tempo, Key: !slices.Equal(before.Vocal().keys, after.Vocal().keys), Bars: [2]int{before.Bars(), after.Bars()}}
	bars := max(before.Bars(), after.Bars())
	type barEvents struct {
		notes  [2][]ABCNote
		chords []ABCChord
	}
	split := func(s *ABCScore, bar int) (out barEvents, ok bool) {
		if bar >= s.Bars() {
			return out, false
		}
		b := s.Vocal().Bars[bar]
		for vi, voice := range s.Voices {
			for _, n := range voice.Notes {
				if n.Start >= b.Start && n.Start < b.Start+b.Length {
					out.notes[vi] = append(out.notes[vi], ABCNote{Start: n.Start - b.Start, Length: n.Length, Pitch: n.Pitch})
				}
			}
		}
		for _, ch := range s.Vocal().Chords {
			if ch.At >= b.Start && ch.At < b.Start+b.Length {
				out.chords = append(out.chords, ABCChord{At: ch.At - b.Start, Name: ch.Name})
			}
		}
		return out, true
	}
	for bar := range bars {
		a, okA := split(before, bar)
		b, okB := split(after, bar)
		if !okA || !okB || !slices.Equal(a.notes[0], b.notes[0]) {
			c.Vocal = append(c.Vocal, bar+1)
		}
		if !okA || !okB || !slices.Equal(a.notes[1], b.notes[1]) {
			c.Ins = append(c.Ins, bar+1)
		}
		if !okA || !okB || !slices.Equal(a.chords, b.chords) {
			c.Chords = append(c.Chords, bar+1)
		}
	}
	return c
}
