package score

import (
	"slices"
	"strings"
	"yovoice/internal/schema"
)

// chordPitches 返回和弦的低音和三/七和弦音（低音落在 C2–B2，和弦音落在 C4 附近）。
func chordPitches(name string) (int, []int, bool) {
	m := abcChord.FindStringSubmatch(name)
	if m == nil {
		return 0, nil, false
	}
	pc := func(n string) int {
		v := abcNatural[n[0]]
		for _, r := range n[1:] {
			if r == '#' {
				v++
			} else {
				v--
			}
		}
		return (v%12 + 12) % 12
	}
	root := pc(m[1])
	bass := root
	if m[3] != "" {
		bass = pc(m[3])
	}
	var tones []int
	for _, interval := range abcQualities[m[2]] {
		p := 60 + root + interval
		for p > 71 {
			p -= 12
		}
		tones = append(tones, p)
	}
	slices.Sort(tones)
	return 36 + bass, tones, true
}

// Score 把旋律谱转换成编曲乐谱，供轨道视图显示：人声旋律、器乐旋律、和弦铺底与低音各一轨，空轨省略。
// 小节与拍按谱面小节换算，拍以四分音符计，与编曲乐谱一致。
func (s *ABCScore) Score() schema.Score {
	out := schema.Score{Tempo: float64(s.Tempo), TimeSignature: []int{s.Meter[0], s.Meter[1]}, Key: abcKeyName(s.Key)}
	bars := s.Vocal().Bars
	// 编曲乐谱只有一个拍号：谱中途改成更长的拍子（如 4/4 里夹一小节 9/8）时，改按绝对时间排到固定小节网格上，
	// 保证每个音都落在小节内、试听时间不变；只有这种谱的小节号会与谱面略有出入。
	grid := s.Meter[0] * ABCTicksPerWhole / s.Meter[1]
	regular := !slices.ContainsFunc(bars, func(b ABCBar) bool { return b.Length > grid })
	locate := func(at int) (int, float64) {
		if !regular {
			return at/grid + 1, 1 + float64(at%grid)/abcQuarter
		}
		i, _ := slices.BinarySearchFunc(bars, at, func(b ABCBar, t int) int {
			if t < b.Start {
				return 1
			}
			if t >= b.Start+b.Length {
				return -1
			}
			return 0
		})
		i = min(i, len(bars)-1)
		return i + 1, 1 + float64(at-bars[i].Start)/abcQuarter
	}
	// barEnd 是 at 所在小节的结束位置，和弦铺底在这里切开。
	barEnd := func(at int) int {
		if !regular {
			return (at/grid + 1) * grid
		}
		bar, _ := locate(at)
		b := bars[bar-1]
		return b.Start + b.Length
	}
	melody := func(id, name, role string, program, velocity int, notes []ABCNote) {
		if len(notes) == 0 {
			return
		}
		t := schema.ScoreTrack{ID: id, Name: name, Role: role, Program: program}
		for _, n := range notes {
			bar, beat := locate(n.Start)
			t.Notes = append(t.Notes, schema.ScoreNote{Bar: bar, Beat: beat, Pitch: n.Pitch, Length: float64(n.Length) / abcQuarter, Velocity: velocity})
		}
		out.Tracks = append(out.Tracks, t)
	}
	melody("vocal", "Vocal", "melody", 53, 100, s.Vocal().Notes)
	melody("ins", "Ins", "piano", 0, 90, s.Ins().Notes)
	// 和弦持续到下一个和弦或曲末，按小节切开，便于在轨道上对齐小节线。
	chords := s.Vocal().Chords
	pad := schema.ScoreTrack{ID: "chords", Name: "Chords", Role: "pad", Program: 89}
	bass := schema.ScoreTrack{ID: "bass", Name: "Bass", Role: "bass", Program: 33}
	end := s.Vocal().time
	for i, ch := range chords {
		stop := end
		if i+1 < len(chords) {
			stop = chords[i+1].At
		}
		low, tones, ok := chordPitches(ch.Name)
		if !ok || stop <= ch.At {
			continue
		}
		for at := ch.At; at < stop; {
			bar, beat := locate(at)
			until := min(stop, barEnd(at))
			length := float64(until-at) / abcQuarter
			for _, p := range tones {
				pad.Notes = append(pad.Notes, schema.ScoreNote{Bar: bar, Beat: beat, Pitch: p, Length: length, Velocity: 64})
			}
			bass.Notes = append(bass.Notes, schema.ScoreNote{Bar: bar, Beat: beat, Pitch: low, Length: length, Velocity: 80})
			at = until
		}
	}
	if len(pad.Notes) > 0 {
		out.Tracks = append(out.Tracks, pad, bass)
	}
	// 段落起止换算到同一套小节号上。
	at := func(bar int) int {
		if bar > len(bars) {
			return s.Vocal().time
		}
		return bars[bar-1].Start
	}
	lastBar, _ := locate(max(s.Vocal().time-1, 0))
	for i, section := range s.Sections {
		start, _ := locate(at(section.Bar))
		last := lastBar
		if i+1 < len(s.Sections) {
			next, _ := locate(at(s.Sections[i+1].Bar))
			last = next - 1
		}
		if last >= start {
			out.Sections = append(out.Sections, schema.ScoreSection{Name: section.Name, Start: start, End: last})
		}
	}
	return out
}

// abcKeyName 把 K: 字段写成乐谱里的调名，如 "Bb major"、"F# minor"。
func abcKeyName(key string) string {
	if strings.HasSuffix(key, "m") {
		return strings.TrimSuffix(key, "m") + " minor"
	}
	return key + " major"
}
