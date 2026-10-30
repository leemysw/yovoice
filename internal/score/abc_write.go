package score

import (
	"fmt"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
)

// 按音符事件改写旋律谱：只重写两个声部的音符行，表头、段落注释、分组和 M:/K: 行原样保留，
// 写完重新解析，事件与原意不一致就报错，不交出一份“看起来对”的谱。

// InstrumentalReport 记录人声转器乐时的改动，供界面与助手说明。
type InstrumentalReport struct {
	// Moved 是移到 Ins 的人声音符数。
	Moved int `json:"moved"`
	// Trimmed 是与人声重叠、只保留了不重叠部分（或整个让位）的原器乐音符数。
	Trimmed int `json:"trimmed"`
	// Changed 表示谱里原本有人声音符；为 false 时谱已是纯器乐，原样返回。
	Changed bool `json:"changed"`
}

// InstrumentalABC 把旋律谱改成纯音乐用的谱（YuE2 官方纯音乐流程）：Vocal 的全部音符移到 Ins，
// Vocal 只留休止与和弦；两声部重叠时人声优先，原 Ins 只保留不重叠的部分。速度、拍号、调与和弦不变。
func InstrumentalABC(text string) (string, InstrumentalReport, error) {
	s, e := ParseABC(text)
	if e != nil {
		return "", InstrumentalReport{}, e
	}
	vocal := s.Vocal().Notes
	if len(vocal) == 0 {
		if len(s.Ins().Notes) == 0 {
			return "", InstrumentalReport{}, issue("empty", 0, "the score contains no sounding notes")
		}
		return text, InstrumentalReport{}, nil
	}
	merged := slices.Clone(vocal)
	report := InstrumentalReport{Moved: len(vocal), Changed: true}
	for _, n := range s.Ins().Notes {
		pieces := subtractNotes(n, vocal)
		if len(pieces) != 1 || pieces[0] != n {
			report.Trimmed++
		}
		merged = append(merged, pieces...)
	}
	sort.Slice(merged, func(i, j int) bool { return merged[i].Start < merged[j].Start })
	out, e := s.rewrite(text, [2][]ABCNote{nil, merged})
	if e != nil {
		return "", InstrumentalReport{}, e
	}
	return out, report, nil
}

// subtractNotes 去掉 n 与人声音符重叠的部分，返回剩下的片段（同音高）。
func subtractNotes(n ABCNote, occupied []ABCNote) []ABCNote {
	pieces := []ABCNote{n}
	for _, o := range occupied {
		var next []ABCNote
		for _, p := range pieces {
			end, oEnd := p.Start+p.Length, o.Start+o.Length
			if o.Start >= end || oEnd <= p.Start {
				next = append(next, p)
				continue
			}
			if o.Start > p.Start {
				next = append(next, ABCNote{Start: p.Start, Length: o.Start - p.Start, Pitch: p.Pitch})
			}
			if oEnd < end {
				next = append(next, ABCNote{Start: oEnd, Length: end - oEnd, Pitch: p.Pitch})
			}
		}
		pieces = next
	}
	return pieces
}

// SectionTags 把段落注释写成歌词里的段落标记，如 "[Verse]\n\n[Chorus]\n"；纯音乐生成时代替歌词。
func (s *ABCScore) SectionTags() string {
	var tags []string
	for _, section := range s.Sections {
		words := strings.Split(strings.ToLower(section.Name), "-")
		for i, word := range words {
			if word != "" {
				words[i] = strings.ToUpper(word[:1]) + word[1:]
			}
		}
		tags = append(tags, "["+strings.Join(words, "-")+"]")
	}
	if len(tags) == 0 {
		return ""
	}
	return strings.Join(tags, "\n\n") + "\n"
}

// rewrite 用给定的两个声部音符重写音符行，和弦保留在 Vocal 原来的位置，并校验结果。
func (s *ABCScore) rewrite(text string, notes [2][]ABCNote) (string, error) {
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	indices := make([]int, 0, len(s.musicLines))
	for i := range s.musicLines {
		indices = append(indices, i)
	}
	slices.Sort(indices)
	bars := s.Vocal().Bars
	keys := s.Vocal().keys
	writers := [2]*abcWriter{{unit: s.Unit}, {unit: s.Unit}}
	next := [2]int{}
	for _, i := range indices {
		vi := 0
		if s.musicLines[i] == "Ins" {
			vi = 1
		}
		count := lineBars(lines[i])
		var written []string
		for b := next[vi]; b < next[vi]+count; b++ {
			bar := bars[b]
			key, inline := keyAt(keys, bar.Start)
			// 组内第一个小节的调由 K: 行给出；组中途换调要写成行内 [K:]。
			prefix := ""
			if inline && b != next[vi] {
				prefix = "[K:" + key + "]"
			}
			var chords []ABCChord
			if vi == 0 {
				chords = s.Vocal().Chords
			}
			body, e := writers[vi].bar(bar, key, notes[vi], chords)
			if e != nil {
				e.Voice, e.Bar = abcVoices[vi], b+1
				return "", e
			}
			written = append(written, prefix+body)
		}
		next[vi] += count
		lines[i] = joinBars(written)
	}
	out := strings.Join(lines, "\n")
	result, e := ParseABC(out)
	if e != nil {
		return "", fmt.Errorf("rewritten score is invalid: %w", e)
	}
	for vi := range notes {
		if !slices.Equal(result.Voices[vi].Notes, notes[vi]) {
			return "", issue("grid", 0, "rewriting changed the %s notes", abcVoices[vi])
		}
	}
	if !slices.Equal(result.Vocal().Chords, s.Vocal().Chords) || !slices.Equal(result.Vocal().Bars, bars) ||
		!slices.Equal(result.Vocal().keys, keys) || result.Tempo != s.Tempo {
		return "", issue("grid", 0, "rewriting changed chords, meter, key or tempo")
	}
	return out, nil
}

// lineBars 是一行音符里的小节数，Z2–Z4 按展开后计。
func lineBars(line string) int {
	line = strings.TrimSpace(line)
	count := 0
	for _, bar := range strings.Split(strings.TrimSuffix(line, "|"), "|") {
		if m := abcRests.FindStringSubmatch(strings.TrimSpace(bar)); m != nil && m[1] != "" {
			n, _ := strconv.Atoi(m[1])
			count += n
			continue
		}
		count++
	}
	return count
}

// joinBars 把小节连成一行，相邻的整小节休止压缩为 Z2–Z4（原生导出的写法）。
func joinBars(bars []string) string {
	var out []string
	for i := 0; i < len(bars); {
		if bars[i] != "Z" {
			out = append(out, bars[i])
			i++
			continue
		}
		j := i
		for j < len(bars) && bars[j] == "Z" {
			j++
		}
		if n := j - i; n == 1 {
			out = append(out, "Z")
		} else {
			out = append(out, "Z"+strconv.Itoa(n))
		}
		i = j
	}
	return strings.Join(out, "|") + "|"
}

// keyAt 返回某个小节开头生效的调，以及调是否恰好在这里改变。
func keyAt(keys []string, at int) (string, bool) {
	key, changed := "", false
	for _, entry := range keys {
		tick, name, _ := strings.Cut(entry, ":")
		t, _ := strconv.Atoi(tick)
		if t > at {
			break
		}
		key, changed = name, t == at && t > 0
	}
	return key, changed
}

// abcWriter 把一个声部的音符事件按小节写成原生记谱。held 是跨小节接续的音在上一小节的写法：
// 接续时照抄、不写临时记号，解析规则据此保持原音高。
type abcWriter struct {
	unit int
	held string
}

func (w *abcWriter) bar(b ABCBar, key string, notes []ABCNote, chords []ABCChord) (string, *ABCIssue) {
	end := b.Start + b.Length
	step := ABCTicksPerWhole / w.unit
	cuts := []int{b.Start, end}
	var inBar []ABCNote
	for _, n := range notes {
		if n.Start < end && n.Start+n.Length > b.Start {
			inBar = append(inBar, n)
			cuts = append(cuts, max(n.Start, b.Start), min(n.Start+n.Length, end))
		}
	}
	var marks []ABCChord
	for _, c := range chords {
		if c.At >= b.Start && c.At < end {
			marks = append(marks, c)
			cuts = append(cuts, c.At)
		}
	}
	if len(inBar) == 0 && len(marks) == 0 {
		return "Z", nil
	}
	slices.Sort(cuts)
	cuts = slices.Compact(cuts)
	signature, _ := abcKeyAccidentals(key)
	local := map[byte]int{}
	var out strings.Builder
	for i := 0; i+1 < len(cuts); i++ {
		a, z := cuts[i], cuts[i+1]
		for _, c := range marks {
			if c.At == a {
				out.WriteString(`"` + c.Name + `"`)
			}
		}
		if (z-a)%step != 0 || (a-b.Start)%step != 0 {
			return "", &ABCIssue{Code: "duration", Detail: fmt.Sprintf("an event is not on the L:1/%d grid", w.unit)}
		}
		pieces := splitUnits((z - a) / step)
		k := slices.IndexFunc(inBar, func(n ABCNote) bool { return n.Start <= a && a < n.Start+n.Length })
		if k < 0 {
			for _, units := range pieces {
				out.WriteString("z" + unitText(units))
			}
			continue
		}
		n := inBar[k]
		written := w.held
		if n.Start == a {
			var accidental string
			written, accidental = spell(n.Pitch, signature, local)
			out.WriteString(accidental)
		}
		for j, units := range pieces {
			out.WriteString(written + unitText(units))
			if j+1 < len(pieces) || n.Start+n.Length > z {
				out.WriteString("-")
			}
		}
		w.held = written
	}
	return out.String(), nil
}

// splitUnits 把以 L 为单位的长度拆成允许的时值，长的在前。
func splitUnits(units int) []int {
	var out []int
	for units > 0 {
		for i := len(abcDurations) - 1; i >= 0; i-- {
			if abcDurations[i] <= units {
				out = append(out, abcDurations[i])
				units -= abcDurations[i]
				break
			}
		}
	}
	return out
}

func unitText(units int) string {
	if units == 1 {
		return ""
	}
	return strconv.Itoa(units)
}

// spell 按调号拼写音高：调内音不写记号，调外音按调号方向用升或降；小节内已改过的字母需要时写还原号。
// 返回书写形式（字母与八度）和需要写在前面的临时记号。
func spell(pitch int, signature map[byte]int, local map[byte]int) (string, string) {
	pc := pitch % 12
	sharps := true
	for _, v := range signature {
		if v < 0 {
			sharps = false
		}
	}
	letter, alt := byte(0), 0
	for _, l := range []byte("CDEFGAB") {
		if (abcNatural[l]+signature[l]+12)%12 == pc {
			letter, alt = l, signature[l]
			break
		}
	}
	if letter == 0 {
		for _, l := range []byte("CDEFGAB") {
			if abcNatural[l] == pc {
				letter, alt = l, 0
			}
		}
	}
	if letter == 0 {
		for _, l := range []byte("CDEFGAB") {
			if sharps && (abcNatural[l]+1)%12 == pc {
				letter, alt = l, 1
			}
			if !sharps && (abcNatural[l]+11)%12 == pc {
				letter, alt = l, -1
			}
		}
	}
	effective, ok := local[letter]
	if !ok {
		effective = signature[letter]
	}
	accidental := ""
	if effective != alt {
		accidental = map[int]string{-1: "_", 0: "=", 1: "^"}[alt]
		local[letter] = alt
	}
	octave := (pitch - alt - 60 - abcNatural[letter]) / 12
	if octave >= 1 {
		return string(letter+'a'-'A') + strings.Repeat("'", octave-1), accidental
	}
	return string(letter) + strings.Repeat(",", -octave), accidental
}

// StripABCChords 去掉全部和弦记号，旋律、休止和小节保持不变；按谱生成时随之改用 melody 模式。
func StripABCChords(text string) (string, error) {
	s, e := ParseABC(text)
	if e != nil {
		return "", e
	}
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	quoted := regexp.MustCompile(`"[^"\n]*"`)
	for i := range s.musicLines {
		lines[i] = quoted.ReplaceAllString(lines[i], "")
	}
	out := strings.Join(lines, "\n")
	result, e := ParseABC(out)
	if e != nil {
		return "", e
	}
	for vi := range s.Voices {
		if !slices.Equal(s.Voices[vi].Notes, result.Voices[vi].Notes) {
			return "", issue("grid", 0, "removing chords changed the melody")
		}
	}
	return out, nil
}

// SetABCTempo 改写表头速度；拍子内的节奏不变，谱面时长随之变化。
func SetABCTempo(text string, tempo int) (string, error) {
	if _, e := ParseABC(text); e != nil {
		return "", e
	}
	if tempo < 30 || tempo > 300 {
		return "", issue("tempo", 5, "tempo must be 30-300")
	}
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	lines[4] = "Q:1/4=" + strconv.Itoa(tempo)
	return strings.Join(lines, "\n"), nil
}
