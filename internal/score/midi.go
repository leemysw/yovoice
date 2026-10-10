package score

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"math"
	"slices"
	"sort"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
)

const ppq = 480

// MIDI 写出类型 1 文件：首轨记录速度与拍号，每个声部一轨；鼓组使用第 10 通道。
func MIDI(s schema.Score) ([]byte, error) {
	if e := schema.ValidateScore(&s); e != nil {
		return nil, e
	}
	per := s.BeatsPerBar()
	tick := func(bar int, beat float64) int { return int(math.Round((float64(bar-1)*per + beat - 1) * ppq)) }
	conductor := []midiEvent{{data: []byte{0xFF, 0x58, 4, byte(s.TimeSignature[0]), byte(bits(s.TimeSignature[1])), 24, 8}}}
	tempo := 0.0
	for bar := 1; bar <= s.Bars(); bar++ {
		if t := s.BarTempo(bar); t != tempo {
			tempo = t
			us := int(math.Round(60_000_000 / t))
			conductor = append(conductor, midiEvent{tick: tick(bar, 1), data: []byte{0xFF, 0x51, 3, byte(us >> 16), byte(us >> 8), byte(us)}})
		}
	}
	chunks := [][]midiEvent{conductor}
	melodic := 0
	for _, t := range s.Tracks {
		channel := byte(9)
		if !t.Drums {
			// 跳过第 10 通道，超过 15 个旋律声部时循环复用通道。
			channel = byte([]int{0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15}[melodic%15])
			melodic++
		}
		name := []byte(t.Name)
		events := []midiEvent{
			{data: append([]byte{0xFF, 0x03}, append(varint(len(name)), name...)...)},
			{data: []byte{0xC0 | channel, byte(t.Program)}},
			{data: []byte{0xB0 | channel, 10, byte(math.Round(64 + t.Pan*63))}},
			{data: []byte{0xB0 | channel, 91, byte(math.Round(t.Reverb * 127))}},
		}
		for _, n := range t.Notes {
			start := tick(n.Bar, n.Beat)
			events = append(events, midiEvent{tick: start, data: []byte{0x90 | channel, byte(n.Pitch), byte(n.Velocity)}},
				midiEvent{tick: start + max(1, int(math.Round(n.Length*ppq))), data: []byte{0x80 | channel, byte(n.Pitch), 0}})
		}
		chunks = append(chunks, events)
	}
	var out bytes.Buffer
	out.WriteString("MThd")
	_ = binary.Write(&out, binary.BigEndian, []uint32{6})
	_ = binary.Write(&out, binary.BigEndian, []uint16{1, uint16(len(chunks)), ppq})
	for _, events := range chunks {
		// 同一刻先写关音，避免同音连奏被提前截断。
		sort.SliceStable(events, func(i, j int) bool {
			if events[i].tick != events[j].tick {
				return events[i].tick < events[j].tick
			}
			return events[i].data[0]&0xF0 == 0x80 && events[j].data[0]&0xF0 != 0x80
		})
		var track bytes.Buffer
		last := 0
		for _, ev := range events {
			track.Write(varint(ev.tick - last))
			track.Write(ev.data)
			last = ev.tick
		}
		track.Write([]byte{0, 0xFF, 0x2F, 0})
		out.WriteString("MTrk")
		_ = binary.Write(&out, binary.BigEndian, uint32(track.Len()))
		out.Write(track.Bytes())
	}
	return out.Bytes(), nil
}

type midiEvent struct {
	tick int
	data []byte
}

func bits(denominator int) int {
	n := 0
	for denominator > 1 {
		denominator >>= 1
		n++
	}
	return n
}

func varint(v int) []byte {
	b := []byte{byte(v & 0x7F)}
	for v >>= 7; v > 0; v >>= 7 {
		b = append([]byte{byte(v&0x7F) | 0x80}, b...)
	}
	return b
}

type midiNote struct {
	track, channel, pitch, velocity int
	start, end                      int
}

// FromMIDI 读取类型 0/1 的标准 MIDI 文件：按“轨道 × 通道”拆分声部，速度取第一个速度事件，
// 后续速度变化忽略；拍号取第一个拍号事件。
func FromMIDI(data []byte) (schema.Score, error) {
	bad := msg.Err(msg.ErrMidiInvalid, nil)
	r := bytes.NewReader(data)
	var header struct {
		Magic              [4]byte
		Size               uint32
		Format, Count, PPQ uint16
	}
	if binary.Read(r, binary.BigEndian, &header) != nil || string(header.Magic[:]) != "MThd" || header.Size < 6 || header.Format > 1 || header.PPQ == 0 || header.PPQ&0x8000 != 0 {
		return schema.Score{}, bad
	}
	if _, e := r.Seek(int64(8+header.Size), 0); e != nil {
		return schema.Score{}, bad
	}
	division := int(header.PPQ)
	tempo, meter := 0.0, []int{4, 4}
	names, programs := map[int]string{}, map[[2]int]int{}
	notes := []midiNote{}
	for track := 0; track < int(header.Count); track++ {
		var chunk struct {
			Magic [4]byte
			Size  uint32
		}
		if binary.Read(r, binary.BigEndian, &chunk) != nil || chunk.Size > uint32(r.Len()) {
			return schema.Score{}, bad
		}
		body := make([]byte, chunk.Size)
		_, _ = r.Read(body)
		if string(chunk.Magic[:]) != "MTrk" {
			continue
		}
		open := map[[2]int][]midiNote{}
		tick, status, i := 0, byte(0), 0
		read := func() (int, bool) {
			v := 0
			for k := 0; k < 4; k++ {
				if i >= len(body) {
					return 0, false
				}
				b := body[i]
				i++
				v = v<<7 | int(b&0x7F)
				if b&0x80 == 0 {
					return v, true
				}
			}
			return 0, false
		}
		for i < len(body) {
			delta, ok := read()
			if !ok || i >= len(body) {
				return schema.Score{}, bad
			}
			tick += delta
			if body[i]&0x80 != 0 {
				status = body[i]
				i++
			}
			switch {
			case status == 0xFF:
				if i >= len(body) {
					return schema.Score{}, bad
				}
				kind := body[i]
				i++
				size, ok := read()
				if !ok || i+size > len(body) {
					return schema.Score{}, bad
				}
				payload := body[i : i+size]
				i += size
				switch {
				case kind == 0x51 && size == 3 && tempo == 0:
					tempo = 60_000_000 / float64(int(payload[0])<<16|int(payload[1])<<8|int(payload[2]))
				case kind == 0x58 && size >= 2 && tick == 0:
					meter = []int{int(payload[0]), 1 << payload[1]}
				case kind == 0x03 && names[track] == "":
					names[track] = string(payload)
				}
			case status == 0xF0 || status == 0xF7:
				size, ok := read()
				if !ok || i+size > len(body) {
					return schema.Score{}, bad
				}
				i += size
			case status >= 0x80:
				width := 2
				if status&0xF0 == 0xC0 || status&0xF0 == 0xD0 {
					width = 1
				}
				if i+width > len(body) {
					return schema.Score{}, bad
				}
				a, b, channel := int(body[i]), 0, int(status&0x0F)
				if width == 2 {
					b = int(body[i+1])
				}
				i += width
				key := [2]int{channel, a}
				switch status & 0xF0 {
				case 0xC0:
					programs[[2]int{track, channel}] = a
				case 0x90, 0x80:
					// 先结束同音上一个音，力度为 0 的开音视为关音。
					if pending := open[key]; len(pending) > 0 {
						n := pending[0]
						open[key] = pending[1:]
						n.end = tick
						notes = append(notes, n)
					}
					if status&0xF0 == 0x90 && b > 0 {
						open[key] = append(open[key], midiNote{track: track, channel: channel, pitch: a, velocity: b, start: tick})
					}
				}
			default:
				return schema.Score{}, bad
			}
		}
	}
	if tempo == 0 {
		tempo = 120
	}
	s := schema.Score{Tempo: math.Round(min(300, max(30, tempo))*100) / 100, TimeSignature: meter}
	if s.TimeSignature[0] < 1 || s.TimeSignature[0] > 16 || !slices.Contains([]int{2, 4, 8, 16}, s.TimeSignature[1]) {
		s.TimeSignature = []int{4, 4}
	}
	per := s.BeatsPerBar()
	index := map[[2]int]int{}
	for _, n := range notes {
		if n.end <= n.start {
			continue
		}
		key := [2]int{n.track, n.channel}
		at, ok := index[key]
		if !ok {
			if len(s.Tracks) == schema.ScoreMaxTracks {
				continue
			}
			name := names[n.track]
			if name == "" {
				name = fmt.Sprintf("Track %d", len(s.Tracks)+1)
			}
			drums := n.channel == 9
			role := "other"
			if drums {
				role = "drums"
			}
			at = len(s.Tracks)
			index[key] = at
			s.Tracks = append(s.Tracks, schema.ScoreTrack{ID: fmt.Sprintf("t%d", at+1), Name: string([]rune(name)[:min(40, len([]rune(name)))]), Role: role, Program: programs[key], Drums: drums})
		}
		beats := float64(n.start) / float64(division)
		bar := int(beats/per) + 1
		s.Tracks[at].Notes = append(s.Tracks[at].Notes, schema.ScoreNote{
			Bar: bar, Beat: math.Round((beats-float64(bar-1)*per+1)*1000) / 1000, Pitch: n.pitch,
			Length: math.Round(float64(n.end-n.start)/float64(division)*1000) / 1000, Velocity: n.velocity,
		})
	}
	for i := range s.Tracks {
		slices.SortStableFunc(s.Tracks[i].Notes, func(a, b schema.ScoreNote) int {
			if a.Bar != b.Bar {
				return a.Bar - b.Bar
			}
			if a.Beat < b.Beat {
				return -1
			}
			if a.Beat > b.Beat {
				return 1
			}
			return 0
		})
	}
	if e := schema.ValidateScore(&s); e != nil {
		return schema.Score{}, bad
	}
	return s, nil
}
