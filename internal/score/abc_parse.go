package score

import (
	"fmt"
	"slices"
	"strconv"
	"strings"
	"yovoice/internal/schema"
)

func abcKeyAccidentals(key string) (map[byte]int, bool) {
	count, ok := abcKeys[key]
	if !ok {
		return nil, false
	}
	result := map[byte]int{}
	order := "FCGDAEB"
	sign := 1
	if count < 0 {
		order, sign, count = "BEADGCF", -1, -count
	}
	for i := 0; i < count; i++ {
		result[order[i]] = sign
	}
	return result, true
}

func abcMeterValue(text string) ([2]int, bool) {
	m := abcMeter.FindStringSubmatch(strings.TrimSpace(text))
	if m == nil {
		return [2]int{}, false
	}
	n, _ := strconv.Atoi(m[1])
	d, _ := strconv.Atoi(m[2])
	if d > 1024 || d&(d-1) != 0 || n > 64 {
		return [2]int{}, false
	}
	return [2]int{n, d}, true
}

func powerOfTwo(n int) bool { return n > 0 && n <= 1024 && n&(n-1) == 0 }

// ParseABC 校验并解析旋律谱；出错时返回 *ABCIssue。
func ParseABC(text string) (*ABCScore, error) {
	if len(text) > ABCMaxLength {
		return nil, issue("length", 0, "score is longer than %d bytes", ABCMaxLength)
	}
	text = strings.ReplaceAll(text, "\r\n", "\n")
	lines := strings.Split(strings.TrimRight(text, "\n"), "\n")
	if len(lines) < 12 {
		return nil, issue("header", 0, "incomplete native two-voice ABC: expected the 8 header lines followed by Vocal and Ins blocks")
	}
	if lines[0] != "X:1" || strings.TrimSpace(lines[1]) != "T:" {
		return nil, issue("header", 1, "expected native X:1 and a blank T: header")
	}
	if !strings.HasPrefix(lines[2], "M:") {
		return nil, issue("header", 3, "missing header M:")
	}
	meter, ok := abcMeterValue(lines[2][2:])
	if !ok {
		return nil, issue("meter", 3, "unsupported meter %q; write an explicit fraction such as 4/4", lines[2][2:])
	}
	unit, e := strconv.Atoi(strings.TrimPrefix(lines[3], "L:1/"))
	if !strings.HasPrefix(lines[3], "L:1/") || e != nil || !powerOfTwo(unit) {
		return nil, issue("header", 4, "expected L:1/<power of two>, usually L:1/32")
	}
	tempo, e := strconv.Atoi(strings.TrimPrefix(lines[4], "Q:1/4="))
	if !strings.HasPrefix(lines[4], "Q:1/4=") || e != nil || tempo < 30 || tempo > 300 {
		return nil, issue("tempo", 5, "expected an integer quarter-note tempo Q:1/4=<30-300>")
	}
	if lines[5] != abcVoiceHeader[0] || lines[6] != abcVoiceHeader[1] {
		return nil, issue("header", 6, "keep the native Vocal and Ins voice definitions")
	}
	if !strings.HasPrefix(lines[7], "K:") {
		return nil, issue("header", 8, "missing header K:")
	}
	key := strings.TrimSpace(lines[7][2:])
	if _, ok := abcKeyAccidentals(key); !ok {
		return nil, issue("key", 8, "unsupported key %q; use a standard major or minor key such as G or Em", key)
	}
	s := &ABCScore{Tempo: tempo, Meter: meter, Key: key, Unit: unit, musicLines: map[int]string{}}
	for i := range s.Voices {
		s.Voices[i] = &ABCVoice{meter: meter, key: key, keys: []string{"0:" + key}}
	}
	cursor, section := 8, ""
	for cursor < len(lines) {
		for cursor < len(lines) && (strings.HasPrefix(lines[cursor], "%") || strings.TrimSpace(lines[cursor]) == "") {
			if name := strings.TrimSpace(strings.TrimPrefix(lines[cursor], "%")); name != "" {
				section = name
			}
			cursor++
		}
		if cursor == len(lines) {
			if section != "" {
				return nil, issue("group", cursor, "section comment %q has no music after it", section)
			}
			break
		}
		if section != "" {
			s.Sections = append(s.Sections, ABCSection{Name: section, Bar: s.Bars() + 1})
			section = ""
		}
		counts := [2]int{}
		for vi, name := range abcVoices {
			voice := s.Voices[vi]
			if cursor >= len(lines) || strings.TrimSpace(lines[cursor]) != "V: "+name {
				return nil, &ABCIssue{Code: "group", Line: cursor + 1, Voice: name, Bar: len(voice.Bars) + 1, Detail: "expected a V: " + name + " line; every group lists Vocal then Ins"}
			}
			cursor++
			fields := map[byte]bool{}
			for cursor < len(lines) && (strings.HasPrefix(lines[cursor], "M:") || strings.HasPrefix(lines[cursor], "K:")) {
				field, value := lines[cursor][0], strings.TrimSpace(lines[cursor][2:])
				if fields[field] {
					return nil, &ABCIssue{Code: "group", Line: cursor + 1, Voice: name, Detail: fmt.Sprintf("duplicate %c: field", field)}
				}
				fields[field] = true
				if field == 'M' {
					m, ok := abcMeterValue(value)
					if !ok {
						return nil, &ABCIssue{Code: "meter", Line: cursor + 1, Voice: name, Detail: fmt.Sprintf("unsupported meter %q", value)}
					}
					voice.meter = m
				} else {
					if _, ok := abcKeyAccidentals(value); !ok {
						return nil, &ABCIssue{Code: "key", Line: cursor + 1, Voice: name, Detail: fmt.Sprintf("unsupported key %q", value)}
					}
					voice.key = value
					voice.keys = append(voice.keys, strconv.Itoa(voice.time)+":"+value)
				}
				cursor++
			}
			if cursor >= len(lines) {
				return nil, &ABCIssue{Code: "group", Line: cursor, Voice: name, Detail: "missing music line"}
			}
			line := strings.TrimSpace(lines[cursor])
			if !strings.HasSuffix(line, "|") {
				return nil, &ABCIssue{Code: "barline", Line: cursor + 1, Voice: name, Bar: len(voice.Bars) + 1, Detail: "a music line must end with a plain barline |"}
			}
			s.musicLines[cursor] = name
			var bars []string
			for _, bar := range strings.Split(line[:len(line)-1], "|") {
				bar = strings.TrimSpace(bar)
				if bar == "" {
					return nil, &ABCIssue{Code: "barline", Line: cursor + 1, Voice: name, Bar: len(voice.Bars) + len(bars) + 1, Detail: "empty measure or unsupported double/repeat barline"}
				}
				if m := abcRests.FindStringSubmatch(bar); m != nil {
					n := 1
					if m[1] != "" {
						n, _ = strconv.Atoi(m[1])
					}
					for range n {
						bars = append(bars, "Z")
					}
				} else {
					bars = append(bars, bar)
				}
			}
			if len(bars) > 4 {
				return nil, &ABCIssue{Code: "group", Line: cursor + 1, Voice: name, Bar: len(voice.Bars) + 1, Detail: "a group holds 1-4 measures after expanding Z rests"}
			}
			counts[vi] = len(bars)
			for _, bar := range bars {
				if e := parseABCBar(bar, voice, unit); e != nil {
					e.Line, e.Voice, e.Bar = cursor+1, name, len(voice.Bars)+1
					return nil, e
				}
			}
			cursor++
		}
		if counts[0] != counts[1] {
			return nil, &ABCIssue{Code: "group", Line: cursor, Bar: s.Bars(), Detail: fmt.Sprintf("Vocal has %d measures but Ins has %d in this group", counts[0], counts[1])}
		}
	}
	if s.Bars() == 0 {
		return nil, issue("group", 9, "the score has no measures")
	}
	for vi, voice := range s.Voices {
		if voice.pending != nil {
			return nil, &ABCIssue{Code: "tie", Voice: abcVoices[vi], Bar: len(voice.Bars), Detail: "unresolved tie at the end of the score"}
		}
	}
	if len(s.Ins().Chords) > 0 {
		return nil, &ABCIssue{Code: "chord", Voice: "Ins", Detail: "chord symbols belong in Vocal, not Ins"}
	}
	if !slices.Equal(s.Vocal().Bars, s.Ins().Bars) {
		return nil, issue("grid", 0, "Vocal and Ins meter/time grids differ")
	}
	if !slices.Equal(s.Vocal().keys, s.Ins().keys) {
		return nil, issue("key", 0, "Vocal and Ins must change key at the same time")
	}
	if s.Seconds() > schema.ScoreMaxSeconds {
		return nil, issue("length", 0, "the score is longer than %d seconds", int(schema.ScoreMaxSeconds))
	}
	return s, nil
}

func parseABCBar(body string, voice *ABCVoice, unit int) *ABCIssue {
	length := ABCTicksPerWhole * voice.meter[0] / voice.meter[1]
	start, offset := voice.time, 0
	// 原生导出按字母传递临时记号，跨八度也生效，到小节线重置。
	local := map[byte]int{}
	if body == "Z" {
		if voice.pending != nil {
			return &ABCIssue{Code: "tie", Detail: "a tie runs into a full-measure rest"}
		}
		offset = length
	}
	for cursor := 0; body != "Z" && cursor < len(body); {
		if body[cursor] == ' ' || body[cursor] == '\t' {
			cursor++
			continue
		}
		m := abcToken.FindStringSubmatchIndex(body[cursor:])
		if m == nil {
			rest := body[cursor:]
			if len(rest) > 24 {
				rest = rest[:24]
			}
			return &ABCIssue{Code: "token", Detail: fmt.Sprintf("unsupported notation at %q (tuplets, grace notes, chords in brackets, slurs and decorations are outside the native dialect)", rest)}
		}
		base := cursor
		group := func(i int) (string, bool) {
			if m[2*i] < 0 {
				return "", false
			}
			return body[base+m[2*i] : base+m[2*i+1]], true
		}
		cursor += m[1]
		if offset >= length {
			return &ABCIssue{Code: "overflow", Detail: "an event comes after the end of the measure"}
		}
		if chord, ok := group(1); ok {
			if !abcChord.MatchString(chord) {
				return &ABCIssue{Code: "chord", Detail: fmt.Sprintf("unsupported chord %q; use a root with one of: major, m, dim, aug, 7, maj7, m7, dim7, m7b5, sus4, sus2, 6, m6, 7sus4, m(maj7), optionally /bass", chord)}
			}
			voice.Chords = append(voice.Chords, ABCChord{At: start + offset, Name: chord})
			continue
		}
		if key, ok := group(2); ok {
			if _, ok := abcKeyAccidentals(key); !ok {
				return &ABCIssue{Code: "key", Detail: fmt.Sprintf("unsupported key %q", key)}
			}
			voice.key = key
			voice.keys = append(voice.keys, strconv.Itoa(start+offset)+":"+key)
			local = map[byte]int{}
			continue
		}
		acc, _ := group(3)
		note, _ := group(4)
		octave, _ := group(5)
		digits, _ := group(6)
		tie, _ := group(7)
		units := 1
		if digits != "" {
			units, _ = strconv.Atoi(digits)
		}
		if !slices.Contains(abcDurations, units) {
			return &ABCIssue{Code: "duration", Detail: fmt.Sprintf("unsupported duration %d; use one of 1,2,3,4,6,8,12,16,24,32,48 and tie notes for other lengths", units)}
		}
		duration := units * ABCTicksPerWhole / unit
		if offset+duration > length {
			return &ABCIssue{Code: "overflow", Detail: fmt.Sprintf("notes add up to more than the %d/%d measure", voice.meter[0], voice.meter[1])}
		}
		if strings.Contains(octave, ",") && strings.Contains(octave, "'") {
			return &ABCIssue{Code: "token", Detail: "mixed octave marks"}
		}
		if note == "z" {
			if acc != "" || octave != "" || tie != "" {
				return &ABCIssue{Code: "rest", Detail: "a rest cannot carry accidentals, octave marks or ties"}
			}
			if voice.pending != nil {
				return &ABCIssue{Code: "tie", Detail: "a tie runs into a rest"}
			}
		} else {
			letter := strings.ToUpper(note)[0]
			written := 60 + abcNatural[letter] + 12*(strings.Count(octave, "'")-strings.Count(octave, ","))
			if note[0] >= 'a' {
				written += 12
			}
			signature, _ := abcKeyAccidentals(voice.key)
			alteration, ok := local[letter]
			if !ok {
				alteration = signature[letter]
			}
			if acc != "" {
				alteration = map[string]int{"=": 0, "_": -1, "__": -2, "^": 1, "^^": 2}[acc]
				local[letter] = alteration
			}
			pitch := written + alteration
			if voice.pending != nil {
				// 跨小节线接续的音不写记号时保持原音高，也不影响本小节后面的音。
				if acc == "" && written == voice.pending[1] {
					pitch = voice.pending[0]
				}
				if pitch != voice.pending[0] {
					return &ABCIssue{Code: "tie", Detail: fmt.Sprintf("a tie joins different pitches (%d to %d)", voice.pending[0], pitch)}
				}
				voice.Notes[len(voice.Notes)-1].Length += duration
			} else {
				if pitch < 0 || pitch > 127 {
					return &ABCIssue{Code: "pitch", Detail: fmt.Sprintf("pitch %d is outside the MIDI range", pitch)}
				}
				voice.Notes = append(voice.Notes, ABCNote{Start: start + offset, Length: duration, Pitch: pitch})
			}
			voice.pending = nil
			if tie != "" {
				voice.pending = &[2]int{pitch, written}
			}
		}
		offset += duration
	}
	if offset != length {
		return &ABCIssue{Code: "duration", Detail: fmt.Sprintf("the measure holds %s of %s quarter notes", quarters(offset), quarters(length))}
	}
	voice.Bars = append(voice.Bars, ABCBar{Start: start, Length: length, Meter: voice.meter})
	voice.time += length
	return nil
}

func quarters(ticks int) string {
	return strconv.FormatFloat(float64(ticks)/abcQuarter, 'f', -1, 64)
}
