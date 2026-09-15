package workbench

import (
	"encoding/binary"
	"fmt"
	"io"
	"math"
	"os"
	"strconv"
	"strings"
	"unicode/utf16"
)

func textLen(s string) int { return len(utf16.Encode([]rune(s))) }
func Duration(path string) (float64, error) {
	f, e := os.Open(path)
	if e != nil {
		return 0, e
	}
	defer f.Close()
	info, e := f.Stat()
	if e != nil {
		return 0, e
	}
	bad := fmt.Errorf("请选择有效的单声道或双声道 PCM / Float WAV 音频。")
	header := make([]byte, 12)
	if _, e = io.ReadFull(f, header); e != nil || string(header[:4]) != "RIFF" || string(header[8:]) != "WAVE" {
		return 0, bad
	}
	var byteRate, dataLength uint32
	for pos := int64(12); pos+8 <= info.Size(); {
		h := make([]byte, 8)
		if _, e = io.ReadFull(f, h); e != nil {
			return 0, e
		}
		size := binary.LittleEndian.Uint32(h[4:])
		pos += 8
		if pos+int64(size) > info.Size() {
			return 0, bad
		}
		switch string(h[:4]) {
		case "fmt ":
			if size < 16 {
				return 0, bad
			}
			b := make([]byte, 16)
			if _, e = io.ReadFull(f, b); e != nil {
				return 0, e
			}
			u16 := binary.LittleEndian.Uint16
			u32 := binary.LittleEndian.Uint32
			format, channels, rate, align, bits := u16(b), u16(b[2:]), u32(b[4:]), u16(b[12:]), u16(b[14:])
			byteRate = u32(b[8:])
			if (format != 1 && format != 3) || channels < 1 || channels > 2 || rate < 8000 || rate > 192000 || (bits != 16 && bits != 24 && bits != 32) || (format == 3 && bits != 32) || align != channels*bits/8 || byteRate != rate*uint32(align) {
				return 0, bad
			}
		case "data":
			dataLength = size
		}
		pos += int64(size) + int64(size%2)
		if _, e = f.Seek(pos, io.SeekStart); e != nil {
			return 0, e
		}
	}
	if byteRate == 0 || dataLength == 0 {
		return 0, bad
	}
	return float64(dataLength) / float64(byteRate), nil
}
func Validate(d Draft) error {
	if strings.TrimSpace(d.Text) == "" || textLen(d.Text) > 12000 {
		return fmt.Errorf("请输入 1–12000 字的正文。")
	}
	if strings.TrimSpace(d.Title) == "" || textLen(d.Title) > 120 {
		return fmt.Errorf("作品名称需为 1–120 字。")
	}
	m, e := model(d.ModelID)
	if e != nil {
		return e
	}
	languages := []string{"zh", "en"}
	if m.Version != "2" {
		languages = append(languages, "ja", "es", "ar")
	}
	ok := false
	for _, l := range languages {
		ok = ok || l == d.Language
	}
	if !ok {
		return fmt.Errorf("当前模型不支持此语言。")
	}
	switch d.Mode {
	case "speaker", "reference", "vector", "text":
	default:
		return fmt.Errorf("表达方式无效。")
	}
	if textLen(d.EmotionText) > 500 || len(d.Emotions) != 8 {
		return fmt.Errorf("情绪参数无效。")
	}
	for _, v := range d.Emotions {
		if !inRange(v, 0, 1) {
			return fmt.Errorf("情绪强度需为 0–1。")
		}
	}
	for _, v := range [][3]float64{{d.Speed, .5, 2}, {d.EmotionStrength, 0, 1}, {d.Temperature, .05, 2}, {d.TopP, .01, 1}, {d.RepetitionPenalty, .1, 20}, {d.LengthPenalty, -2, 2}} {
		if !inRange(v[0], v[1], v[2]) {
			return fmt.Errorf("生成参数超出范围。")
		}
	}
	if d.TopK < 1 || d.TopK > 200 || d.MaxTokens < 50 || d.MaxTokens > 4000 || d.NumBeams < 1 || d.NumBeams > 10 || d.IntervalSilenceMs < 0 || d.IntervalSilenceMs > 2000 || (d.Seed != nil && *d.Seed < 0) {
		return fmt.Errorf("高级生成参数超出范围。")
	}
	return nil
}
func inRange(v, min, max float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0) && v >= min && v <= max
}
func BuildRequest(d Draft, voice, emotion string) (map[string]any, error) {
	if e := Validate(d); e != nil {
		return nil, e
	}
	o := map[string]any{"language": d.Language, "duration_factor": 1 / d.Speed, "temperature": d.Temperature, "top_p": d.TopP, "top_k": d.TopK, "repetition_penalty": d.RepetitionPenalty, "max_tokens": d.MaxTokens, "interval_silence_ms": d.IntervalSilenceMs, "do_sample": d.DoSample, "num_beams": d.NumBeams, "length_penalty": d.LengthPenalty}
	if d.Seed != nil {
		o["seed"] = *d.Seed
	}
	r := map[string]any{"text": d.Text, "voice_ref": voice, "options": o}
	switch d.Mode {
	case "reference":
		if emotion == "" {
			return nil, fmt.Errorf("请添加情绪参考音频。")
		}
		r["audio"] = emotion
		o["emotion_alpha"] = d.EmotionStrength
	case "vector":
		bias := []float64{.9375, .875, 1, 1, .9375, .9375, .6875, .5625}
		sum := 0.
		values := make([]float64, 8)
		for i, v := range d.Emotions {
			values[i] = v * bias[i]
			sum += values[i]
		}
		scale := math.Min(1, .8/math.Max(sum, .0001))
		parts := make([]string, 8)
		for i, v := range values {
			parts[i] = strconv.FormatFloat(v*scale, 'g', -1, 64)
		}
		o["emotion_vector"] = strings.Join(parts, ",")
		o["emotion_alpha"] = d.EmotionStrength
		o["use_random_emotion"] = d.RandomEmotion
	case "text":
		o["use_emotion_text"] = true
		o["emotion_alpha"] = d.EmotionStrength
		o["use_random_emotion"] = d.RandomEmotion
		if !d.InferEmotion {
			if strings.TrimSpace(d.EmotionText) == "" {
				return nil, fmt.Errorf("请输入情绪描述，或选择理解正文。")
			}
			o["emotion_text"] = d.EmotionText
		}
	}
	return map[string]any{"model": "index", "request": r}, nil
}
