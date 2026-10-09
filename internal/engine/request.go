package engine

import (
	"math"
	"strconv"
	"strings"
	"yovoice/internal/catalog"
	"yovoice/internal/domain"
	"yovoice/internal/msg"
)

func BuildRequest(d domain.Draft, voice, emotion string) (map[string]any, error) {
	if e := domain.Validate(d); e != nil {
		return nil, e
	}
	m, _ := catalog.Lookup(d.ModelID)
	if m.Family == "kokoro_tts" {
		o, _ := d.GenerationOptions(m.Family)
		if _, ok := o["text_chunk_size"]; !ok {
			o["text_chunk_size"] = 64
		}
		if d.Seed != nil {
			o["seed"] = *d.Seed
		}
		return map[string]any{"model": "index", "request": map[string]any{"text": d.Text, "voice_id": d.KokoroSpeaker(m), "options": o}}, nil
	}
	if m.Family == "omnivoice" || m.Family == "qwen3_tts" {
		o, _ := d.GenerationOptions(m.Family)
		if d.Seed != nil {
			o["seed"] = *d.Seed
		}

		if m.Family == "omnivoice" && d.OmniSpeed != 0 {
			o["speed"] = d.OmniSpeed
		}
		if m.Variant == "customvoice" {
			o["speaker"] = d.Speaker
			if d.Speaker == "" {
				o["speaker"] = "Vivian"
			}
		}
		r := map[string]any{"text": d.Text, "options": o}
		if d.SynthesisLanguage != "" && d.SynthesisLanguage != "auto" {
			r["language"] = d.SynthesisLanguage
			if m.Family == "qwen3_tts" {
				r["language"] = map[string]string{"zh": "Chinese", "en": "English", "ja": "Japanese", "ko": "Korean", "de": "German", "fr": "French", "ru": "Russian", "pt": "Portuguese", "es": "Spanish", "it": "Italian"}[d.SynthesisLanguage]
			}
		}
		if d.RequiresVoice() {
			if voice == "" {
				return nil, msg.Err(msg.ErrVoiceRequired, nil)
			}
			r["voice_ref"] = voice
			transcript := strings.TrimSpace(d.ReferenceText)
			if transcript != "" {
				o["reference_text"] = transcript
			}
			// 没有原文时只提取说话人特征，避免进入需要原文的 ICL 克隆路径。
			if m.Family == "qwen3_tts" {
				o["x_vector_only_mode"] = transcript == ""
			}
		} else if description := strings.TrimSpace(d.VoiceDescription); description != "" {
			o["instruct"] = description
		}
		// 使用各引擎原生默认值，不透传 IndexTTS 的采样、情绪或语速参数。
		return map[string]any{"model": "index", "request": r}, nil
	}
	if m.Family == "voxcpm2" {
		guidance, steps := d.GuidanceScale, d.InferenceSteps
		if guidance == 0 {
			guidance = 2
		}
		if steps == 0 {
			steps = 10
		}
		o, _ := d.GenerationOptions(m.Family)
		o["guidance_scale"], o["num_inference_steps"] = guidance, steps
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
				return nil, msg.Err(msg.ErrVoiceRequired, nil)
			}
			r["voice_ref"] = voice
		}
		if d.VoxMode == "continuation" {
			r["reference_text"] = strings.TrimSpace(d.ReferenceText)
		}
		return map[string]any{"model": "index", "request": r}, nil
	}
	o := map[string]any{"language": d.Language, "duration_factor": 1 / d.Speed, "temperature": d.Temperature, "top_p": d.TopP, "top_k": d.TopK, "repetition_penalty": d.RepetitionPenalty, "max_tokens": d.MaxTokens, "interval_silence_ms": d.IntervalSilenceMs, "do_sample": d.DoSample, "num_beams": d.NumBeams, "length_penalty": d.LengthPenalty}
	extra, _ := d.GenerationOptions(m.Family)
	for k, v := range extra {
		o[k] = v
	}
	if d.Seed != nil {
		o["seed"] = *d.Seed
	}
	r := map[string]any{"text": d.Text, "voice_ref": voice, "options": o}
	switch d.Mode {
	case "reference":
		if emotion == "" {
			return nil, msg.Err(msg.ErrEmotionVoiceRequired, nil)
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
				return nil, msg.Err(msg.ErrEmotionTextRequired, nil)
			}
			o["emotion_text"] = d.EmotionText
		}
	}
	return map[string]any{"model": "index", "request": r}, nil
}
