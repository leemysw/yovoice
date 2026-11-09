package engine

import (
	"cmp"
	"errors"
	"math"
	"strconv"
	"strings"
	"yovoice/internal/catalog"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
	"yovoice/internal/score"
)

// melodyError 把谱面问题转成界面可显示的错误，带上小节与声部。
func melodyError(e error) error {
	var issue *score.ABCIssue
	if errors.As(e, &issue) {
		return msg.Err(msg.ErrMelodyInvalid, msg.Params{"bar": issue.Bar, "voice": issue.Voice, "code": issue.Code, "detail": issue.Detail})
	}
	return e
}

func BuildRequest(d schema.Draft, voice, emotion string) (map[string]any, error) {
	if e := schema.Validate(d); e != nil {
		return nil, e
	}
	m, _ := catalog.Lookup(d.ModelID)
	if m.Family == "ace_step" {
		o, _ := d.GenerationOptions(m.Family)
		o["route"] = "text2music"
		// ACE-Step 以 [Instrumental] 标记纯音乐；保存的歌词不随开关丢失。
		o["lyrics"] = strings.TrimSpace(d.Lyrics)
		if d.Instrumental {
			o["lyrics"] = "[Instrumental]"
		}
		if d.Seed != nil {
			o["seed"] = *d.Seed
		}
		r := map[string]any{"text": strings.TrimSpace(d.Text), "options": o}
		if d.SynthesisLanguage != "" {
			r["language"] = d.SynthesisLanguage
		}
		return map[string]any{"model": "index", "request": r}, nil
	}
	if m.Family == "yue2" {
		return yue2Request(d)
	}
	if m.Family == "stable_audio" {
		return stableAudioRequest(d, voice), nil
	}
	if m.Family == "kokoro_tts" {
		o, _ := d.GenerationOptions(m.Family)
		o["speed"] = d.Speed
		if d.Seed != nil {
			o["seed"] = *d.Seed
		}
		return map[string]any{"model": "index", "request": map[string]any{"text": d.Text, "voice_id": d.KokoroSpeaker(m), "options": o}}, nil
	}
	switch m.Family {
	case "ming3_tts", "voxtral_tts", "plapre", "xtts_v2", "gradium_phonon", "fish_drama3":
		return nativeTTSRequest(d, m, voice)
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
	if m.Family == "breeze_tts" {
		o, _ := d.GenerationOptions(m.Family)
		// Breeze TTS 2 以 12.5 帧/秒生成，官方上下文为 2048 帧；audio.cpp 默认每段 600 字、上限 1500 帧，
		// 中文长段远超训练长度，容易拖音、重复到上限才停。默认改为短分段，并把单段上限压到约 72 秒。
		if _, ok := o["text_chunk_size"]; !ok {
			o["text_chunk_size"] = 160
		}
		if _, ok := o["max_tokens"]; !ok {
			o["max_tokens"] = 900
		}
		if d.Seed != nil {
			o["seed"] = *d.Seed
		}
		// 声音设计时描述音色，克隆时作为演绎指导（语速、情绪、语气）。
		if description := strings.TrimSpace(d.VoiceDescription); description != "" {
			o["instruction"] = description
		}
		r := map[string]any{"text": strings.TrimSpace(d.Text), "options": o}
		if d.RequiresVoice() {
			if err := attachReference(r, o, d, voice, true); err != nil {
				return nil, err
			}
		}
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
		// VoxCPM2 以 6.25 帧/秒自回归生成；audio.cpp 默认每段 2048 字，千字长文会整段一次生成，
		// 远超训练长度后音色发散甚至爆音，长段内也会逐渐走调。默认改为每段 200 字，续写时上下文约两段。
		if _, ok := o["text_chunk_size"]; !ok {
			o["text_chunk_size"] = 200
		}
		o["guidance_scale"], o["num_inference_steps"] = guidance, steps
		if d.Runtime != nil && d.Runtime.Streaming {
			o["retry_badcase"] = false
		}
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
			// 精细克隆需要参考音频同时作为续写提示（audio）；只给 voice_ref 时引擎会忽略原文，退化为普通克隆。
			r["audio"] = voice
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

// nativeTTSRequest 构建 audio.cpp v0.9.3 新增 TTS 家族的请求：正文与音色（内置音色或参考音频）放顶层，
// 高级参数、随机种子和参考原文放 options，均使用上游参数名。
func nativeTTSRequest(d schema.Draft, m catalog.ModelPackage, voice string) (map[string]any, error) {
	o, _ := d.GenerationOptions(m.Family)
	if d.Seed != nil {
		o["seed"] = *d.Seed
	}
	r := map[string]any{"text": strings.TrimSpace(d.Text), "options": o}
	auto := d.SynthesisLanguage == "" || d.SynthesisLanguage == "auto"
	switch m.Family {
	case "ming3_tts":
		if !auto {
			r["language"] = d.SynthesisLanguage
		}
	case "xtts_v2":
		// XTTS 必须显式指定语言；未选择或“自动”时按简体中文处理。
		r["language"] = d.SynthesisLanguage
		if auto {
			r["language"] = "zh-cn"
		}
	}
	if d.RequiresVoice() {
		// XTTS 只用参考音频，不接受原文。
		if err := attachReference(r, o, d, voice, m.Family != "xtts_v2"); err != nil {
			return nil, err
		}
		return map[string]any{"model": "index", "request": r}, nil
	}
	switch m.Family {
	case "voxtral_tts":
		r["voice_id"] = cmp.Or(d.Speaker, "casual_male")
	case "plapre":
		r["voice_id"] = cmp.Or(d.Speaker, m.Voices[0])
	case "ming3_tts":
		if description := strings.TrimSpace(d.VoiceDescription); description != "" {
			o["template_name"] = "voice_design"
			o["instruct"] = description
		}
	}
	return map[string]any{"model": "index", "request": r}, nil
}

// attachReference 把克隆用的参考音频写入请求；withTranscript 时把非空原文写入 options。
func attachReference(r, o map[string]any, d schema.Draft, voice string, withTranscript bool) error {
	if voice == "" {
		return msg.Err(msg.ErrVoiceRequired, nil)
	}
	r["voice_ref"] = voice
	if transcript := strings.TrimSpace(d.ReferenceText); withTranscript && transcript != "" {
		o["reference_text"] = transcript
	}
	return nil
}

// planningForms 是纯音乐出谱时没有歌词用的段落骨架，只给规划器安排结构，不会被唱出来。
// 按种子挑一种，同一种子总得到同一骨架；不总用同一种曲式，避免纯音乐都是一个结构。
var planningForms = []string{
	"[Intro]\n\n[Verse]\n\n[Chorus]\n\n[Verse]\n\n[Chorus]\n\n[Outro]\n",
	"[Intro]\n\n[Theme]\n\n[Variation]\n\n[Theme]\n\n[Outro]\n",
	"[Theme A]\n\n[Theme A]\n\n[Theme B]\n\n[Theme A]\n",
	"[Intro]\n\n[Build]\n\n[Drop]\n\n[Breakdown]\n\n[Build]\n\n[Drop]\n\n[Outro]\n",
	"[Intro]\n\n[Theme]\n\n[Solo]\n\n[Interlude]\n\n[Theme]\n\n[Outro]\n",
}

func planningLyrics(seed *int) string {
	if seed == nil {
		return planningForms[0]
	}
	return planningForms[(*seed%len(planningForms)+len(planningForms))%len(planningForms)]
}

// yue2Request 构建 YuE2 请求。YuE2 以歌词为正文、风格为请求参数，没有时长参数，长度由歌词或谱决定。
// 规划模式 cot：auto 时有谱按谱演唱（谱里有和弦用 full、只有旋律用 melody），没谱用 full 让模型自己出谱，
// 结果附带这次的旋律谱；off 不经过谱直接生成；melody 会先去掉谱里的和弦，让伴奏自由编配。
// 纯音乐：有谱时把人声旋律移到器乐声部、歌词换成段落标记再生成；没谱时这是出谱请求（Generate 先出谱再转）。
func yue2Request(d schema.Draft) (map[string]any, error) {
	options, err := d.GenerationOptions("yue2")
	if err != nil {
		return nil, err
	}
	mode, _ := options["cot"].(string)
	delete(options, "cot")
	delete(options, "candidates")
	for _, key := range adapterKeys {
		delete(options, key)
	}
	style := strings.TrimSpace(d.Text)
	lyrics := strings.TrimSpace(d.Lyrics)
	abc := d.Abc
	if strings.TrimSpace(abc) == "" {
		abc = ""
	}
	if d.Instrumental {
		// 纯音乐必须经过谱：自由生成没有可转换的旋律。
		if mode == "off" {
			mode = ""
		}
		if !strings.Contains(strings.ToLower(style), "instrumental") {
			style += ", instrumental, no vocals"
		}
		if abc == "" {
			if lyrics == "" {
				lyrics = planningLyrics(d.Seed)
			}
		} else {
			converted, _, e := score.InstrumentalABC(d.Abc)
			if e != nil {
				return nil, melodyError(e)
			}
			parsed, _ := score.ParseABC(converted)
			abc, lyrics = converted, parsed.SectionTags()
		}
	}
	if mode == "off" {
		abc = ""
	}
	cot := "full"
	if mode == "off" {
		cot = "off"
	}
	o := map[string]any{"style": style, "lyrics": lyrics}
	for key, value := range options {
		o[key] = value
	}
	if abc != "" {
		s, e := score.ParseABC(abc)
		if e != nil {
			return nil, melodyError(e)
		}
		switch {
		case mode == "melody" && s.HasChords():
			if abc, e = score.StripABCChords(abc); e != nil {
				return nil, melodyError(e)
			}
			cot = "melody"
		case mode == "melody", mode == "" && !s.HasChords():
			cot = "melody"
		}
		o["abc"] = abc
	} else if mode == "melody" {
		cot = "melody"
	}
	o["cot"] = cot
	if d.Seed != nil {
		o["seed"] = *d.Seed
	}
	return map[string]any{"model": "index", "request": map[string]any{"text": lyrics, "options": o}}, nil
}

// stableAudioRequest 构建 Stable Audio 请求：正文是英文描述，没有歌词与演唱语言。
// 改编时 source 是起点版本的音频：init_audio 按 init_noise_level 保留原曲的程度整体重写，
// inpaint_audio 只重绘 [inpaint_start, inpaint_end] 区间，其余部分保持原样。
// 参数名用 v0.9.1 与 v0.9.2 都接受的 duration_sec、inpaint_mask_*_sec。
func stableAudioRequest(d schema.Draft, source string) map[string]any {
	options, _ := d.GenerationOptions("stable_audio")
	edit, _ := options["edit"].(string)
	start, end := options["inpaint_start"], options["inpaint_end"]
	strength := options["init_noise_level"]
	for _, key := range []string{"edit", "inpaint_start", "inpaint_end", "init_noise_level"} {
		delete(options, key)
	}
	o := map[string]any{}
	for key, value := range options {
		o[key] = value
	}
	duration, ok := o["duration_seconds"].(float64)
	if !ok {
		duration = 30
	}
	delete(o, "duration_seconds")
	o["duration_sec"] = duration
	if d.Seed != nil {
		o["seed"] = *d.Seed
	}
	r := map[string]any{"text": strings.TrimSpace(d.Text), "options": o}
	switch edit {
	case "init_audio":
		r["audio"] = source
		o["audio_input_kind"] = "init_audio"
		if strength == nil {
			strength = 0.7
		}
		o["init_noise_level"] = strength
	case "inpaint_audio":
		r["audio"] = source
		o["audio_input_kind"] = "inpaint_audio"
		o["inpaint_mask_start_sec"] = strconv.FormatFloat(number(start), 'f', -1, 64)
		o["inpaint_mask_end_sec"] = strconv.FormatFloat(number(end), 'f', -1, 64)
	}
	return map[string]any{"model": "index", "request": r}
}

func number(v any) float64 {
	f, _ := v.(float64)
	return f
}

// instrumentalScore 返回纯音乐实际演奏的谱：人声旋律已移到器乐声部。
func instrumentalScore(abc string) (string, error) {
	converted, _, e := score.InstrumentalABC(abc)
	if e != nil {
		return "", melodyError(e)
	}
	return converted, nil
}
