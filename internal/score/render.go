// Package score 把编曲乐谱渲染为音频，并与标准 MIDI 文件互转。
package score

import (
	"context"
	"encoding/binary"
	"fmt"
	"hash/fnv"
	"math"
	"math/rand/v2"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"yovoice/internal/schema"

	"github.com/sinshu/go-meltysynth/meltysynth"
)

const (
	SampleRate = 44100
	block      = 256
	// 收尾留出混响与释音的时间。
	tailSeconds = 2.0
	// 主输出峰值上限，留出转码与播放器重采样的余量。
	peakLimit = -1.0
)

// SoundFont 解析一次后复用：同一音色库可同时给多个声部和多次渲染使用。
var soundFonts sync.Map

func LoadSoundFont(path string) (*meltysynth.SoundFont, error) {
	info, e := os.Stat(path)
	if e != nil {
		return nil, e
	}
	key := path + "|" + info.ModTime().String()
	if sf, ok := soundFonts.Load(key); ok {
		return sf.(*meltysynth.SoundFont), nil
	}
	f, e := os.Open(path)
	if e != nil {
		return nil, e
	}
	defer f.Close()
	sf, e := meltysynth.NewSoundFont(f)
	if e != nil {
		return nil, e
	}
	soundFonts.Store(key, sf)
	return sf, nil
}

type event struct {
	at       int
	on       bool
	pitch    int32
	velocity int32
}

// Render 逐声部合成，按“有声部分”电平对齐到各自目标后混音，写出 16 位立体声 WAV。
// stems 非空时同时写出每个声部（对齐电平后、混音前）的分轨。progress 收到已完成声部数。
func Render(ctx context.Context, sf *meltysynth.SoundFont, s schema.Score, output, stems string, progress func(done, total int)) error {
	if e := schema.ValidateScore(&s); e != nil {
		return e
	}
	frames := int(math.Ceil((s.Duration() + tailSeconds) * SampleRate))
	mixL, mixR := make([]float32, frames), make([]float32, frames)
	tracks := slices.DeleteFunc(slices.Clone(s.Tracks), func(t schema.ScoreTrack) bool { return t.Mute })
	for i, t := range tracks {
		if e := ctx.Err(); e != nil {
			return e
		}
		left, right, e := renderTrack(ctx, sf, s, t, frames)
		if e != nil {
			return e
		}
		if level := activeLevel(left, right); level > -90 {
			gain := float32(math.Pow(10, (t.TargetLevel()-level)/20))
			for j := range left {
				left[j] *= gain
				right[j] *= gain
			}
		}
		if stems != "" {
			if e = WriteWAV(filepath.Join(stems, stemName(i, t)), left, right); e != nil {
				return e
			}
		}
		for j := range left {
			mixL[j] += left[j]
			mixR[j] += right[j]
		}
		if progress != nil {
			progress(i+1, len(tracks))
		}
	}
	limit(mixL, mixR)
	return WriteWAV(output, mixL, mixR)
}

func stemName(i int, t schema.ScoreTrack) string {
	name := []rune{}
	for _, r := range t.ID {
		if r == '-' || r == '_' || ('a' <= r && r <= 'z') || ('A' <= r && r <= 'Z') || ('0' <= r && r <= '9') {
			name = append(name, r)
		}
	}
	return fmt.Sprintf("%02d-%s.wav", i+1, string(name))
}

func renderTrack(ctx context.Context, sf *meltysynth.SoundFont, s schema.Score, t schema.ScoreTrack, frames int) ([]float32, []float32, error) {
	settings := meltysynth.NewSynthesizerSettings(SampleRate)
	settings.BlockSize = block
	settings.MaximumPolyphony = 128
	synth, e := meltysynth.NewSynthesizer(sf, settings)
	if e != nil {
		return nil, nil, e
	}
	// 每个声部独占一个合成器，鼓组走 GM 约定的第 10 通道。
	channel := int32(0)
	if t.Drums {
		channel = 9
	}
	synth.ProcessMidiMessage(channel, 0xC0, int32(t.Program), 0)
	synth.ProcessMidiMessage(channel, 0xB0, 10, int32(math.Round(64+t.Pan*63)))
	synth.ProcessMidiMessage(channel, 0xB0, 91, int32(math.Round(t.Reverb*127)))
	synth.ProcessMidiMessage(channel, 0xB0, 93, 0)

	events := trackEvents(s, t)
	left, right := make([]float32, frames), make([]float32, frames)
	next := 0
	for start := 0; start < frames; start += block {
		if start%(SampleRate*4) == 0 {
			if e := ctx.Err(); e != nil {
				return nil, nil, e
			}
		}
		end := min(start+block, frames)
		if len(t.Dynamics) > 0 {
			synth.ProcessMidiMessage(channel, 0xB0, 11, int32(math.Round(expression(s, t.Dynamics, float64(start)/SampleRate)*127)))
		}
		for next < len(events) && events[next].at < end {
			ev := events[next]
			if ev.on {
				synth.NoteOn(channel, ev.pitch, ev.velocity)
			} else {
				synth.NoteOff(channel, ev.pitch)
			}
			next++
		}
		synth.Render(left[start:end], right[start:end])
	}
	return left, right, nil
}

// trackEvents 把音符换算为采样位置；人性化偏移由声部 ID 派生的随机序列决定，结果可复现。
func trackEvents(s schema.Score, t schema.ScoreTrack) []event {
	h := fnv.New64a()
	h.Write([]byte(t.ID))
	rng := rand.New(rand.NewPCG(h.Sum64(), 0x9e3779b97f4a7c15))
	per := s.BeatsPerBar()
	events := make([]event, 0, len(t.Notes)*2)
	for _, n := range t.Notes {
		start, end := s.Seconds(n.Bar, n.Beat), 0.0
		// 结束位置可能跨入后续小节，按拍数从起点累加再换算。
		position := float64(n.Bar-1)*per + n.Beat - 1 + n.Length
		bar := int(position/per) + 1
		end = s.Seconds(bar, position-float64(bar-1)*per+1)
		velocity := n.Velocity
		if h := t.Humanize; h != nil {
			if h.Velocity > 0 {
				velocity += rng.IntN(2*h.Velocity+1) - h.Velocity
			}
			if h.TimingMs > 0 {
				shift := (rng.Float64()*2 - 1) * h.TimingMs / 1000
				start, end = max(0, start+shift), max(0, end+shift)
			}
		}
		velocity = min(127, max(1, velocity))
		on, off := int(start*SampleRate), int(end*SampleRate)
		if off <= on {
			off = on + 1
		}
		events = append(events, event{at: on, on: true, pitch: int32(n.Pitch), velocity: int32(velocity)}, event{at: off, pitch: int32(n.Pitch)})
	}
	// 同一时刻先关后开，连续同音不会被下一音的关音截断。
	slices.SortStableFunc(events, func(a, b event) int {
		if a.at != b.at {
			return a.at - b.at
		}
		if a.on == b.on {
			return 0
		}
		if !a.on {
			return -1
		}
		return 1
	})
	return events
}

// expression 返回某时刻的音量系数：在渐变范围内线性插值，范围之外保持最近一次渐变的终值。
func expression(s schema.Score, ramps []schema.ScoreRamp, seconds float64) float64 {
	value := 1.0
	for _, r := range ramps {
		from, to := s.Seconds(r.Start, 1), s.Seconds(r.End+1, 1)
		switch {
		case seconds >= to:
			value = r.To
		case seconds >= from:
			return r.From + (r.To-r.From)*(seconds-from)/(to-from)
		}
	}
	return value
}

// activeLevel 计算 50 毫秒窗口 RMS，只统计不低于最响窗口 40 dB 的部分，静音段不拉低电平。
func activeLevel(left, right []float32) float64 {
	window := SampleRate / 20
	levels := []float64{}
	for start := 0; start+window <= len(left); start += window {
		sum := 0.0
		for i := start; i < start+window; i++ {
			sum += float64(left[i])*float64(left[i]) + float64(right[i])*float64(right[i])
		}
		levels = append(levels, sum/float64(2*window))
	}
	loudest := slices.Max(append(levels, 0))
	if loudest <= 1e-12 {
		return -100
	}
	sum, count := 0.0, 0
	for _, v := range levels {
		if v >= loudest*1e-4 {
			sum += v
			count++
		}
	}
	return 10 * math.Log10(sum/float64(count))
}

// limit 只在峰值超过上限时整体衰减，保留声部间的电平关系。
func limit(left, right []float32) {
	peak := float32(0)
	for i := range left {
		peak = max(peak, float32(math.Abs(float64(left[i]))), float32(math.Abs(float64(right[i]))))
	}
	ceiling := float32(math.Pow(10, peakLimit/20))
	if peak <= ceiling {
		return
	}
	gain := ceiling / peak
	for i := range left {
		left[i] *= gain
		right[i] *= gain
	}
}

func WriteWAV(path string, left, right []float32) error {
	data := make([]byte, 44+len(left)*4)
	copy(data, "RIFF")
	binary.LittleEndian.PutUint32(data[4:], uint32(len(data)-8))
	copy(data[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(data[16:], 16)
	binary.LittleEndian.PutUint16(data[20:], 1)
	binary.LittleEndian.PutUint16(data[22:], 2)
	binary.LittleEndian.PutUint32(data[24:], SampleRate)
	binary.LittleEndian.PutUint32(data[28:], SampleRate*4)
	binary.LittleEndian.PutUint16(data[32:], 4)
	binary.LittleEndian.PutUint16(data[34:], 16)
	copy(data[36:], "data")
	binary.LittleEndian.PutUint32(data[40:], uint32(len(left)*4))
	sample := func(v float32) uint16 { return uint16(int16(math.Round(float64(min(1, max(-1, v))) * 32767))) }
	for i := range left {
		binary.LittleEndian.PutUint16(data[44+i*4:], sample(left[i]))
		binary.LittleEndian.PutUint16(data[46+i*4:], sample(right[i]))
	}
	return os.WriteFile(path, data, 0600)
}
