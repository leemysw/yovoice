package workbench

import (
	"encoding/binary"
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
	bad := Err(MsgErrAudioFormat, nil)
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
		return Err(MsgErrTextRequired, nil)
	}
	if strings.TrimSpace(d.Title) == "" || textLen(d.Title) > 120 {
		return Err(MsgErrTitleLength, nil)
	}
	m, e := model(d.ModelID)
	if e != nil {
		return e
	}
	if m.Family == "voxcpm2" {
		if d.VoxMode != "" && d.VoxMode != "design" && d.VoxMode != "clone" && d.VoxMode != "continuation" {
			return Err(MsgErrVoxModeInvalid, nil)
		}
		if textLen(d.VoiceDescription) > 500 || textLen(d.ReferenceText) > 2000 {
			return Err(MsgErrVoxTextLimits, nil)
		}
		if d.VoxMode == "continuation" && strings.TrimSpace(d.ReferenceText) == "" {
			return Err(MsgErrVoxReferenceRequired, nil)
		}
		if (d.GuidanceScale != 0 && !inRange(d.GuidanceScale, .5, 5)) || d.InferenceSteps < 0 || d.InferenceSteps > 50 || (d.Seed != nil && (*d.Seed < 0 || *d.Seed > 2147483647)) {
			return Err(MsgErrVoxParams, nil)
		}
		return nil
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
		return Err(MsgErrLanguageUnsupported, nil)
	}
	switch d.Mode {
	case "speaker", "reference", "vector", "text":
	default:
		return Err(MsgErrModeInvalid, nil)
	}
	if textLen(d.EmotionText) > 500 || len(d.Emotions) != 8 {
		return Err(MsgErrEmotionInvalid, nil)
	}
	for _, v := range d.Emotions {
		if !inRange(v, 0, 1) {
			return Err(MsgErrEmotionStrength, nil)
		}
	}
	for _, v := range [][3]float64{{d.Speed, .5, 2}, {d.EmotionStrength, 0, 1}, {d.Temperature, .05, 2}, {d.TopP, .01, 1}, {d.RepetitionPenalty, .1, 20}, {d.LengthPenalty, -2, 2}} {
		if !inRange(v[0], v[1], v[2]) {
			return Err(MsgErrParamsOutOfRange, nil)
		}
	}
	if d.TopK < 1 || d.TopK > 200 || d.MaxTokens < 50 || d.MaxTokens > 4000 || d.NumBeams < 1 || d.NumBeams > 10 || d.IntervalSilenceMs < 0 || d.IntervalSilenceMs > 2000 || (d.Seed != nil && (*d.Seed < 0 || *d.Seed > 2147483647)) {
		return Err(MsgErrParamsOutOfRange, nil)
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
	m, _ := model(d.ModelID)
	if m.Family == "voxcpm2" {
		guidance, steps := d.GuidanceScale, d.InferenceSteps
		if guidance == 0 {
			guidance = 2
		}
		if steps == 0 {
			steps = 10
		}
		o := map[string]any{"guidance_scale": guidance, "num_inference_steps": steps}
		if d.Seed != nil {
			o["seed"] = *d.Seed
		}
		text := d.Text
		// 精细克隆沿用参考音频的演绎，其他模式可通过前缀控制音色和风格。
		if description := strings.TrimSpace(d.VoiceDescription); description != "" && d.VoxMode != "continuation" {
			text = "(" + description + ")" + text
		}
		r := map[string]any{"text": text, "options": o}
		if d.RequiresVoice() {
			if voice == "" {
				return nil, Err(MsgErrVoiceRequired, nil)
			}
			r["voice_ref"] = voice
		}
		if d.VoxMode == "continuation" {
			r["reference_text"] = strings.TrimSpace(d.ReferenceText)
		}
		return map[string]any{"model": "index", "request": r}, nil
	}
	o := map[string]any{"language": d.Language, "duration_factor": 1 / d.Speed, "temperature": d.Temperature, "top_p": d.TopP, "top_k": d.TopK, "repetition_penalty": d.RepetitionPenalty, "max_tokens": d.MaxTokens, "interval_silence_ms": d.IntervalSilenceMs, "do_sample": d.DoSample, "num_beams": d.NumBeams, "length_penalty": d.LengthPenalty}
	if d.Seed != nil {
		o["seed"] = *d.Seed
	}
	r := map[string]any{"text": d.Text, "voice_ref": voice, "options": o}
	switch d.Mode {
	case "reference":
		if emotion == "" {
			return nil, Err(MsgErrEmotionVoiceRequired, nil)
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
				return nil, Err(MsgErrEmotionTextRequired, nil)
			}
			o["emotion_text"] = d.EmotionText
		}
	}
	return map[string]any{"model": "index", "request": r}, nil
}

func (d Draft) RequiresVoice() bool {
	m, err := model(d.ModelID)
	return err != nil || m.Family != "voxcpm2" || d.VoxMode == "clone" || d.VoxMode == "continuation"
}
