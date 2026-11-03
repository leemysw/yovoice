package engine

import (
	"errors"
	"math"
	"slices"
	"strings"
	"testing"
	"yovoice/internal/catalog"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
	"yovoice/internal/score"
	"yovoice/internal/testkit"
)

func TestVoxCPMRequest(t *testing.T) {
	d := schema.DefaultDraft()
	d.ModelID = "voxcpm2-q8"
	d.VoiceDescription = "温柔清澈"
	// 保留的 IndexTTS 参数不能泄漏到 VoxCPM2 请求中。
	d.Mode = "reference"
	d.Language = "ja"
	for _, mode := range []string{"design", "clone", "continuation"} {
		t.Run(mode, func(t *testing.T) {
			d := d
			d.VoxMode = mode
			d.ReferenceText = "参考音频的原文"
			p, err := BuildRequest(d, "voice.wav", "emotion.wav")
			must(t, err)
			r := p["request"].(map[string]any)
			o := r["options"].(map[string]any)
			if len(o) != 3 || o["guidance_scale"] != float64(2) || o["num_inference_steps"] != 10 || o["text_chunk_size"] != 200 {
				t.Fatal(o)
			}
			_, voice := r["voice_ref"]
			_, transcript := r["reference_text"]
			// 精细克隆必须同时把参考音频作为续写提示，否则引擎不使用原文。
			_, prompt := r["audio"]
			if voice != (mode != "design") || transcript != (mode == "continuation") || prompt != (mode == "continuation") || (prompt && r["audio"] != "voice.wav") {
				t.Fatal(r)
			}
			want := "(" + d.VoiceDescription + ")" + d.Text
			if mode == "continuation" {
				want = d.Text
			}
			if r["text"] != want {
				t.Fatal(r)
			}
			_, err = BuildRequest(d, "", "")
			if (err != nil) != d.RequiresVoice() {
				t.Fatal(err)
			}
		})
	}
	for _, patch := range []func(*schema.Draft){
		func(d *schema.Draft) { d.VoxMode = "invalid" },
		func(d *schema.Draft) { d.VoxMode = "continuation"; d.ReferenceText = " " },
		func(d *schema.Draft) { d.GuidanceScale = math.NaN() },
		func(d *schema.Draft) { d.InferenceSteps = 51 },
		func(d *schema.Draft) {
			d.ModelOptions = map[string]map[string]any{"voxcpm2": {"text_chunk_size": float64(4096)}}
		},
	} {
		invalid := d
		patch(&invalid)
		if schema.Validate(invalid) == nil {
			t.Fatal("应拒绝无效参数", invalid)
		}
	}
}

func TestOmniAndQwenRequests(t *testing.T) {
	for _, id := range []string{"omnivoice-q8", "omnivoice-bf16", "qwen3-tts-base-q8", "qwen3-tts-base-bf16"} {
		t.Run(id, func(t *testing.T) {
			d := schema.DefaultDraft()
			d.ModelID = id
			d.VoiceDescription = "female, young adult, moderate pitch"
			d.VoiceMode = "design"
			m, err := catalog.Lookup(id)
			must(t, err)
			if d.RequiresVoice() != (m.Family == "qwen3_tts") {
				t.Fatal("参考音频要求错误")
			}
			p, err := BuildRequest(d, "voice.wav", "emotion.wav")
			must(t, err)
			r := p["request"].(map[string]any)
			o := r["options"].(map[string]any)
			if m.Family == "omnivoice" {
				if r["voice_ref"] != nil || o["instruct"] != "female, young adult, moderate pitch" {
					t.Fatal(r)
				}
			} else if o["x_vector_only_mode"] != true {
				t.Fatal(o)
			}
			d.VoiceMode = "clone"
			d.ReferenceText = "原文"
			p, err = BuildRequest(d, "voice.wav", "emotion.wav")
			must(t, err)
			r = p["request"].(map[string]any)
			o = r["options"].(map[string]any)
			if r["voice_ref"] != "voice.wav" || o["reference_text"] != "原文" || o["instruct"] != nil || o["temperature"] != nil || o["emotion_vector"] != nil {
				t.Fatal(r)
			}
			if m.Family == "qwen3_tts" && o["x_vector_only_mode"] != false {
				t.Fatal(o)
			}
			if _, err = BuildRequest(d, "", ""); err == nil {
				t.Fatal("缺少参考音频应失败")
			}
			seed := -1
			d.Seed = &seed
			if schema.Validate(d) == nil {
				t.Fatal("无效种子应失败")
			}
		})
	}
}

func TestModelVariantsAndOptions(t *testing.T) {
	for _, m := range catalog.Models {
		t.Run(m.ID, func(t *testing.T) {
			if catalog.IsMusic(m.Family) {
				t.Skip("音乐模型参数由 TestMusicRequest、TestYuE2Request 覆盖")
			}
			if m.Family == "soundfont" {
				t.Skip("音色库由编曲渲染使用，不经过推理引擎")
			}
			if catalog.IsTool(m.Family) {
				d := schema.DefaultDraft()
				d.ModelID = m.ID
				if schema.Validate(d) == nil {
					t.Fatal("扒谱、歌词对齐、语音识别模型不能作为作品的生成模型")
				}
				return
			}
			d := schema.DefaultDraft()
			d.ModelID = m.ID
			d.VoiceDescription = "female, young adult"
			d.ModelOptions = map[string]map[string]any{m.Family: {"text_chunk_size": float64(512)}}
			if slices.ContainsFunc(catalog.GenerationOptions[m.Family], func(spec catalog.GenerationOption) bool { return spec.Key == "text_chunk_mode" }) {
				d.ModelOptions[m.Family]["text_chunk_mode"] = "tag_aware"
			}
			if m.Family == "gradium_phonon" {
				d.ModelOptions[m.Family] = map[string]any{"text_chunk_tokens": float64(64)}
			}
			if m.Family == "voxcpm2" {
				d.ModelOptions[m.Family]["text_chunk_size"] = float64(300)
			}
			if m.Family == "kokoro_tts" {
				delete(d.ModelOptions[m.Family], "text_chunk_mode")
				d.ModelOptions[m.Family]["text_chunk_size"] = float64(120)
			}
			if m.Family == "qwen3_tts" {
				d.SynthesisLanguage = "ja"
				d.ModelOptions[m.Family]["temperature"] = .7
			}
			p, err := BuildRequest(d, "reference.wav", "")
			must(t, err)
			r := p["request"].(map[string]any)
			o := r["options"].(map[string]any)
			if o["text_chunk_size"] != d.ModelOptions[m.Family]["text_chunk_size"] {
				t.Fatal(o)
			}
			if m.Variant == "customvoice" && (d.RequiresVoice() || o["speaker"] != "Vivian") {
				t.Fatal(r)
			}
			if m.Variant == "voicedesign" && (d.RequiresVoice() || m.Task != "vdes" || o["instruct"] == nil) {
				t.Fatal(r)
			}
			if m.Family == "qwen3_tts" && (o["temperature"] != .7 || r["language"] != "Japanese") {
				t.Fatal(o)
			}
			d.ModelOptions[m.Family]["streaming"] = true
			if schema.Validate(d) == nil {
				t.Fatal("拒绝未支持的流式或任意引擎选项")
			}
			delete(d.ModelOptions[m.Family], "streaming")
			d.ModelOptions[m.Family]["text_chunk_size"] = 1.5
			if schema.Validate(d) == nil {
				t.Fatal("拒绝非整数分段字数")
			}
		})
	}
	for _, invalid := range []string{"warm voice", "female, male", "young adult, 老年"} {
		d := schema.DefaultDraft()
		d.ModelID = "omnivoice-q8"
		d.VoiceDescription = invalid
		if schema.Validate(d) == nil {
			t.Fatal("拒绝无效或互斥的音色属性", invalid)
		}
	}
}

func TestYuE2Request(t *testing.T) {
	d := schema.DefaultDraft()
	d.Kind, d.ModelID, d.Text, d.Lyrics = "music", "yue2-3b-q8", "Mandarin, city pop, warm synths", " [verse]\n晚风吹过招牌 "
	// 音乐草稿默认带 ACE-Step 时长，YuE2 不使用也不应因此失败。
	d.ModelOptions = map[string]map[string]any{"ace_step": {"duration_seconds": float64(60)}}
	seed := 9
	d.Seed = &seed
	p, err := BuildRequest(d, "", "")
	must(t, err)
	r := p["request"].(map[string]any)
	o := r["options"].(map[string]any)
	if r["text"] != "[verse]\n晚风吹过招牌" || o["lyrics"] != r["text"] || o["style"] != d.Text || o["seed"] != 9 || o["cot"] != "full" || len(o) != 4 {
		t.Fatal(r)
	}
	if d.RequiresVoice() {
		t.Fatal("YuE2 不需要参考音色")
	}
	for _, patch := range []func(*schema.Draft){
		func(d *schema.Draft) { d.Lyrics = " " },
		func(d *schema.Draft) { d.Text = "" },
		func(d *schema.Draft) { d.ModelOptions = map[string]map[string]any{"yue2": {"cot": "nope"}} },
	} {
		invalid := d
		patch(&invalid)
		if _, err := BuildRequest(invalid, "", ""); err == nil {
			t.Fatal("无效的 YuE2 草稿应失败", invalid)
		}
	}
	// 有谱时按谱演唱：带和弦用 full，去掉和弦后用 melody；谱面错误带上小节号。
	withScore := d
	withScore.Abc = testkit.ABC
	p, err = BuildRequest(withScore, "", "")
	must(t, err)
	if o := p["request"].(map[string]any)["options"].(map[string]any); o["abc"] != testkit.ABC || o["cot"] != "full" {
		t.Fatal(o)
	}
	withScore.Abc, err = score.StripABCChords(testkit.ABC)
	must(t, err)
	p, err = BuildRequest(withScore, "", "")
	must(t, err)
	if o := p["request"].(map[string]any)["options"].(map[string]any); o["cot"] != "melody" {
		t.Fatal(o)
	}
	// 规划模式与采样参数：off 不经过谱，melody 先去掉和弦。
	withScore.Abc = testkit.ABC
	withScore.ModelOptions = map[string]map[string]any{"yue2": {"cot": "off", "num_inference_steps": float64(32)}}
	p, err = BuildRequest(withScore, "", "")
	must(t, err)
	if o := p["request"].(map[string]any)["options"].(map[string]any); o["cot"] != "off" || o["abc"] != nil || o["num_inference_steps"] != float64(32) {
		t.Fatal(o)
	}
	withScore.ModelOptions = map[string]map[string]any{"yue2": {"cot": "melody"}}
	p, err = BuildRequest(withScore, "", "")
	must(t, err)
	if o := p["request"].(map[string]any)["options"].(map[string]any); o["cot"] != "melody" || strings.Contains(o["abc"].(string), `"C"`) {
		t.Fatal(o)
	}
	// 纯音乐：没谱时是出谱请求，歌词可空、用段落骨架；有谱时人声旋律移到器乐，歌词只剩段落标记，自由生成不适用。
	instrumental := d
	instrumental.Instrumental, instrumental.Lyrics = true, ""
	instrumental.ModelOptions = map[string]map[string]any{"yue2": {"cot": "off"}}
	p, err = BuildRequest(instrumental, "", "")
	must(t, err)
	if o := p["request"].(map[string]any)["options"].(map[string]any); o["cot"] != "full" || o["lyrics"] != planningLyrics || !strings.HasSuffix(o["style"].(string), "instrumental, no vocals") {
		t.Fatal(o)
	}
	instrumental.Abc = testkit.ABC
	p, err = BuildRequest(instrumental, "", "")
	must(t, err)
	opts := p["request"].(map[string]any)["options"].(map[string]any)
	converted, e := score.ParseABC(opts["abc"].(string))
	must(t, e)
	if len(converted.Vocal().Notes) != 0 || len(converted.Ins().Notes) == 0 || opts["lyrics"] != converted.SectionTags() || p["request"].(map[string]any)["text"] != opts["lyrics"] {
		t.Fatal(opts)
	}
	withScore.Abc = strings.Replace(testkit.ABC, "B8G8D16", "B8G8D8", 1)
	var ce *msg.CallError
	if _, err = BuildRequest(withScore, "", ""); !errors.As(err, &ce) || ce.Code != msg.ErrMelodyInvalid || ce.Params["bar"] != 2 || ce.Params["voice"] != "Vocal" {
		t.Fatal(err)
	}
	m, _ := catalog.Lookup("yue2-3b-bf16")
	if len(m.Files) != 6 || m.SessionOptions["yue2.model_gguf"] != "yue2-3b-bf16.gguf" || m.Files[0].Path != m.RemotePath {
		t.Fatal(m)
	}
	var total int64
	for _, f := range m.Files {
		total += f.Size
	}
	if total != m.Size {
		t.Fatal("模型包大小应为各文件之和", total, m.Size)
	}
}

func TestMusicRequest(t *testing.T) {
	d := schema.DefaultDraft()
	d.Kind, d.ModelID, d.Text, d.Lyrics, d.SynthesisLanguage = "music", "ace-step-1.5-turbo-bf16", "city pop, 温暖的合成器", "[verse]\n晚风吹过招牌", "zh"
	// 自动值不下发，由 ACE-Step 规划器决定。
	d.ModelOptions = map[string]map[string]any{"ace_step": {"duration_seconds": float64(60), "bpm": float64(0), "keyscale": "auto", "timesignature": "4"}}
	seed := 7
	d.Seed = &seed
	p, err := BuildRequest(d, "", "")
	must(t, err)
	r := p["request"].(map[string]any)
	o := r["options"].(map[string]any)
	if r["text"] != d.Text || r["language"] != "zh" || o["route"] != "text2music" || o["lyrics"] != d.Lyrics || o["duration_seconds"] != float64(60) || o["timesignature"] != "4" || o["seed"] != 7 {
		t.Fatal(r)
	}
	if _, ok := o["bpm"]; ok {
		t.Fatal(o)
	}
	if _, ok := o["keyscale"]; ok {
		t.Fatal(o)
	}
	if _, ok := r["voice_ref"]; ok || d.RequiresVoice() {
		t.Fatal("音乐生成不需要参考音色", r)
	}
	d.Instrumental = true
	p, err = BuildRequest(d, "", "")
	must(t, err)
	if p["request"].(map[string]any)["options"].(map[string]any)["lyrics"] != "[Instrumental]" {
		t.Fatal(p)
	}
	for _, patch := range []func(*schema.Draft){
		func(d *schema.Draft) { d.Text = " " },
		func(d *schema.Draft) { d.Text = string(make([]rune, 513)) },
		func(d *schema.Draft) { d.Lyrics = string(make([]rune, 4001)) },
		func(d *schema.Draft) { d.SynthesisLanguage = "klingon" },
		func(d *schema.Draft) { d.ModelOptions["ace_step"]["duration_seconds"] = float64(5) },
		func(d *schema.Draft) { d.ModelOptions["ace_step"]["duration_seconds"] = float64(301) },
		func(d *schema.Draft) { d.ModelOptions["ace_step"]["bpm"] = float64(20) },
		func(d *schema.Draft) { d.ModelOptions["ace_step"]["keyscale"] = "H major" },
		func(d *schema.Draft) { d.ModelOptions["ace_step"]["lyrics"] = "绕过校验" },
	} {
		invalid := d
		invalid.ModelOptions = map[string]map[string]any{"ace_step": {}}
		for k, v := range d.ModelOptions["ace_step"] {
			invalid.ModelOptions["ace_step"][k] = v
		}
		patch(&invalid)
		if schema.Validate(invalid) == nil {
			t.Fatal("应拒绝无效音乐参数", invalid.Text[:min(len(invalid.Text), 20)], invalid.ModelOptions)
		}
	}
}

// Stable Audio：英文描述直接作为正文，不带歌词和演唱语言；时长换成两个内核版本都接受的 duration_sec。
// 改编把起点版本作为 audio 传入，局部重绘带上区间，其余界面选项不下发。
func TestStableAudioRequest(t *testing.T) {
	d := schema.DefaultDraft()
	d.Kind, d.ModelID, d.Text, d.Lyrics, d.SynthesisLanguage = "music", "stable-audio-3-small-music-q8", " uplifting house, bright synths ", "[verse]\n不会被唱出来", "zh"
	d.ModelOptions = map[string]map[string]any{"stable_audio": {"duration_seconds": float64(45), "num_inference_steps": float64(12), "edit": "off", "init_noise_level": 0.5}}
	seed := 3
	d.Seed = &seed
	p, err := BuildRequest(d, "", "")
	must(t, err)
	r := p["request"].(map[string]any)
	o := r["options"].(map[string]any)
	if r["text"] != "uplifting house, bright synths" || o["duration_sec"] != float64(45) || o["num_inference_steps"] != float64(12) || o["seed"] != 3 {
		t.Fatal(r)
	}
	for _, key := range []string{"duration_seconds", "edit", "init_noise_level", "audio_input_kind", "lyrics", "route"} {
		if _, ok := o[key]; ok {
			t.Fatal("不应下发", key, o)
		}
	}
	if _, ok := r["audio"]; ok || r["language"] != nil || d.RequiresVoice() {
		t.Fatal(r)
	}
	// 未设置时长时用 30 秒，而不是内核默认的 120 秒。
	delete(d.ModelOptions["stable_audio"], "duration_seconds")
	p, _ = BuildRequest(d, "", "")
	if p["request"].(map[string]any)["options"].(map[string]any)["duration_sec"] != float64(30) {
		t.Fatal(p)
	}

	d.ModelOptions["stable_audio"]["edit"] = "init_audio"
	if _, err = BuildRequest(d, "", ""); err == nil || !strings.Contains(err.Error(), string(msg.ErrMusicSourceRequired)) {
		t.Fatal("改编需要起点版本", err)
	}
	d.SourceGenerationID = "take1"
	p, err = BuildRequest(d, "/data/outputs/take1.wav", "")
	must(t, err)
	r = p["request"].(map[string]any)
	o = r["options"].(map[string]any)
	if r["audio"] != "/data/outputs/take1.wav" || o["audio_input_kind"] != "init_audio" || o["init_noise_level"] != 0.5 {
		t.Fatal(r)
	}

	d.ModelOptions["stable_audio"]["edit"] = "inpaint_audio"
	d.ModelOptions["stable_audio"]["inpaint_start"] = 2.5
	d.ModelOptions["stable_audio"]["inpaint_end"] = float64(8)
	p, err = BuildRequest(d, "/data/outputs/take1.wav", "")
	must(t, err)
	o = p["request"].(map[string]any)["options"].(map[string]any)
	if o["audio_input_kind"] != "inpaint_audio" || o["inpaint_mask_start_sec"] != "2.5" || o["inpaint_mask_end_sec"] != "8" {
		t.Fatal(o)
	}
	if _, ok := o["init_noise_level"]; ok {
		t.Fatal("重绘不需要改编幅度", o)
	}

	for _, patch := range []func(*schema.Draft){
		func(d *schema.Draft) { d.Text = " " },
		func(d *schema.Draft) { d.ModelOptions["stable_audio"]["duration_seconds"] = float64(0) },
		// Small 系列最长 120 秒，Medium 才能更长。
		func(d *schema.Draft) { d.ModelOptions["stable_audio"]["duration_seconds"] = float64(121) },
		func(d *schema.Draft) { d.ModelOptions["stable_audio"]["init_noise_level"] = 1.5 },
		func(d *schema.Draft) { d.ModelOptions["stable_audio"]["edit"] = "variation" },
		func(d *schema.Draft) { d.ModelOptions["stable_audio"]["inpaint_end"] = 2.5 },
		func(d *schema.Draft) { d.ModelOptions["stable_audio"]["inpaint_end"] = float64(130) },
		func(d *schema.Draft) { d.ModelOptions["stable_audio"]["audio_input_kind"] = "init_audio" },
	} {
		invalid := d
		invalid.ModelOptions = map[string]map[string]any{"stable_audio": {}}
		for k, v := range d.ModelOptions["stable_audio"] {
			invalid.ModelOptions["stable_audio"][k] = v
		}
		patch(&invalid)
		if schema.Validate(invalid) == nil {
			t.Fatal("应拒绝无效 Stable Audio 参数", invalid.ModelOptions)
		}
	}
	d.ModelID = "stable-audio-3-medium-q8"
	d.ModelOptions["stable_audio"]["duration_seconds"] = float64(300)
	d.ModelOptions["stable_audio"]["inpaint_end"] = float64(200)
	must(t, schema.Validate(d))
}

func TestBreezeRequest(t *testing.T) {
	d := schema.DefaultDraft()
	d.ModelID = "breeze-tts-2-q8"
	d.Text = " 你好，世界。\n"
	d.VoiceDescription = "温暖的女声，语速平稳"
	// IndexTTS 的采样参数不能泄漏到 Breeze 请求中。
	d.Mode = "reference"
	d.Language = "ja"
	p, err := BuildRequest(d, "voice.wav", "emotion.wav")
	must(t, err)
	r := p["request"].(map[string]any)
	o := r["options"].(map[string]any)
	if r["text"] != "你好，世界。" || r["voice_ref"] != nil || o["instruction"] != d.VoiceDescription || o["text_chunk_size"] != 160 || o["max_tokens"] != 900 || len(o) != 3 {
		t.Fatal(r)
	}
	// 克隆需要参考音频和原文；描述作为演绎指导一并传入，用户设置的分段覆盖默认值。
	d.VoiceMode = "clone"
	d.ReferenceText = " 参考原文 "
	d.ModelOptions = map[string]map[string]any{"breeze_tts": {"text_chunk_size": float64(80), "guidance_scale": float64(3)}}
	seed := 7
	d.Seed = &seed
	if !d.RequiresVoice() {
		t.Fatal("克隆应要求参考音频")
	}
	p, err = BuildRequest(d, "voice.wav", "")
	must(t, err)
	r = p["request"].(map[string]any)
	o = r["options"].(map[string]any)
	if r["voice_ref"] != "voice.wav" || o["reference_text"] != "参考原文" || o["instruction"] != d.VoiceDescription || o["text_chunk_size"] != float64(80) || o["guidance_scale"] != float64(3) || o["seed"] != seed {
		t.Fatal(r)
	}
	if _, err = BuildRequest(d, "", ""); err == nil {
		t.Fatal("克隆缺少参考音频时应报错")
	}
	for _, patch := range []func(*schema.Draft){
		func(d *schema.Draft) { d.ReferenceText = " " },
		func(d *schema.Draft) { d.VoiceMode = "continuation" },
		func(d *schema.Draft) {
			d.ModelOptions = map[string]map[string]any{"breeze_tts": {"text_chunk_size": float64(0)}}
		},
		func(d *schema.Draft) {
			d.ModelOptions = map[string]map[string]any{"breeze_tts": {"max_tokens": float64(2000)}}
		},
	} {
		invalid := d
		patch(&invalid)
		if schema.Validate(invalid) == nil {
			t.Fatal("应拒绝无效参数", invalid)
		}
	}
}

func TestMingRequest(t *testing.T) {
	d := schema.DefaultDraft()
	d.ModelID = "ming3-tts-0.5b-q8"
	d.Text = " 你好，世界。\n"
	d.VoiceDescription = "温暖的女声"
	d.SynthesisLanguage = "zh"
	// IndexTTS 的模式、语言与采样参数不能泄漏到 Ming 请求中。
	d.Mode = "reference"
	d.Language = "ja"
	p, err := BuildRequest(d, "voice.wav", "emotion.wav")
	must(t, err)
	r := p["request"].(map[string]any)
	o := r["options"].(map[string]any)
	if r["text"] != "你好，世界。" || r["language"] != "zh" || r["voice_ref"] != nil || o["template_name"] != "voice_design" || o["instruct"] != d.VoiceDescription || len(o) != 2 {
		t.Fatal(r)
	}
	// 无描述时是普通 TTS；自动语言与长文分段都交给上游决定。
	d.VoiceDescription = ""
	d.SynthesisLanguage = "auto"
	p, err = BuildRequest(d, "", "")
	must(t, err)
	r = p["request"].(map[string]any)
	o = r["options"].(map[string]any)
	if _, ok := r["language"]; ok || len(o) != 0 {
		t.Fatal(r)
	}

	d.VoiceMode = "clone"
	d.VoiceDescription = "克隆时不透传描述"
	d.ReferenceText = " 参考原文 "
	d.ModelOptions = map[string]map[string]any{"ming3_tts": {"text_chunk_size": float64(0), "guidance_scale": float64(3), "temperature": 0.5, "trim_silence": false}}
	seed := 7
	d.Seed = &seed
	if !d.RequiresVoice() {
		t.Fatal("克隆应要求参考音频")
	}
	p, err = BuildRequest(d, "voice.wav", "")
	must(t, err)
	r = p["request"].(map[string]any)
	o = r["options"].(map[string]any)
	if r["voice_ref"] != "voice.wav" || o["reference_text"] != "参考原文" || o["guidance_scale"] != float64(3) || o["temperature"] != 0.5 || o["trim_silence"] != false || o["seed"] != seed || len(o) != 5 {
		t.Fatal(r)
	}
	for _, key := range []string{"template_name", "instruct", "text_chunk_size"} {
		if _, ok := o[key]; ok {
			t.Fatal("不应下发", key, o)
		}
	}
	// Ming 无原文时只使用说话人条件，不像 Breeze 那样强制原文。
	d.ReferenceText = ""
	p, err = BuildRequest(d, "voice.wav", "")
	must(t, err)
	o = p["request"].(map[string]any)["options"].(map[string]any)
	if _, ok := o["reference_text"]; ok {
		t.Fatal(o)
	}
	if _, err = BuildRequest(d, "", ""); err == nil {
		t.Fatal("克隆缺少参考音频时应报错")
	}
	for _, patch := range []func(*schema.Draft){
		func(d *schema.Draft) { d.VoiceMode = "continuation" },
		func(d *schema.Draft) { d.SynthesisLanguage = "ru" },
		func(d *schema.Draft) { d.ModelOptions = map[string]map[string]any{"ming3_tts": {"temperature": -0.1}} },
		func(d *schema.Draft) { negative := -1; d.Seed = &negative },
	} {
		invalid := d
		patch(&invalid)
		if schema.Validate(invalid) == nil {
			t.Fatal("应拒绝无效参数", invalid)
		}
	}
	// 未设置的模式、音色和语言按默认处理。
	defaults := schema.DefaultDraft()
	defaults.ModelID = "ming3-tts-0.5b-bf16"
	defaults.Text = "Hello."
	p, err = BuildRequest(defaults, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if r := p["request"].(map[string]any); r["voice_ref"] != nil || r["language"] != nil {
		t.Fatal(r)
	}
}

func TestVoxtralRequest(t *testing.T) {
	d := schema.DefaultDraft()
	d.ModelID = "voxtral-tts-4b-q8"
	d.Text = " Bonjour. "
	d.ModelOptions = map[string]map[string]any{"voxtral_tts": {"num_inference_steps": float64(9), "guidance_scale": 1.4, "max_tokens": float64(1024), "text_chunk_size": float64(200)}}
	seed := 42
	d.Seed = &seed
	p, err := BuildRequest(d, "ignored.wav", "")
	must(t, err)
	r := p["request"].(map[string]any)
	o := r["options"].(map[string]any)
	if r["text"] != "Bonjour." || r["voice_id"] != "casual_male" || r["voice_ref"] != nil || o["num_inference_steps"] != float64(9) || o["guidance_scale"] != 1.4 || o["max_tokens"] != float64(1024) || o["text_chunk_size"] != float64(200) || o["seed"] != seed || d.RequiresVoice() {
		t.Fatal(r)
	}
	d.Speaker = "fr_female"
	p, err = BuildRequest(d, "", "")
	must(t, err)
	if p["request"].(map[string]any)["voice_id"] != "fr_female" {
		t.Fatal(p)
	}
	for _, patch := range []func(*schema.Draft){
		func(d *schema.Draft) { d.Speaker = "unknown" },
		func(d *schema.Draft) {
			d.ModelOptions = map[string]map[string]any{"voxtral_tts": {"num_inference_steps": float64(0)}}
		},
		func(d *schema.Draft) { negative := -1; d.Seed = &negative },
	} {
		invalid := d
		patch(&invalid)
		if schema.Validate(invalid) == nil {
			t.Fatal("应拒绝无效参数", invalid)
		}
	}
	// 未设置的模式、音色和语言按默认处理。
	defaults := schema.DefaultDraft()
	defaults.ModelID = "voxtral-tts-4b-bf16"
	defaults.Text = "Hello."
	p, err = BuildRequest(defaults, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if r := p["request"].(map[string]any); r["voice_id"] != "casual_male" {
		t.Fatal(r)
	}
}

func TestPlapreRequest(t *testing.T) {
	d := schema.DefaultDraft()
	d.ModelID = "plapre-3-bf16"
	d.Text = " Hej. "
	d.ModelOptions = map[string]map[string]any{"plapre": {"temperature": 0.7, "top_k": float64(40), "top_p": 0.9, "silence_duration_sec": 0.2, "text_chunk_size": float64(200)}}
	seed := 8
	d.Seed = &seed
	p, err := BuildRequest(d, "ignored.wav", "")
	must(t, err)
	r := p["request"].(map[string]any)
	o := r["options"].(map[string]any)
	if r["text"] != "Hej." || r["voice_id"] != "tor" || r["voice_ref"] != nil || o["temperature"] != 0.7 || o["top_k"] != float64(40) || o["top_p"] != 0.9 || o["silence_duration_sec"] != 0.2 || o["text_chunk_size"] != float64(200) || o["seed"] != seed || d.RequiresVoice() {
		t.Fatal(r)
	}
	d.Speaker = "ida"
	p, err = BuildRequest(d, "", "")
	must(t, err)
	if p["request"].(map[string]any)["voice_id"] != "ida" {
		t.Fatal(p)
	}
	d.VoiceMode = "clone"
	d.ReferenceText = " Referenceoptagelsen. "
	p, err = BuildRequest(d, "voice.wav", "")
	must(t, err)
	r = p["request"].(map[string]any)
	o = r["options"].(map[string]any)
	if r["voice_ref"] != "voice.wav" || r["voice_id"] != nil || o["reference_text"] != "Referenceoptagelsen." || !d.RequiresVoice() {
		t.Fatal(r)
	}
	d.ReferenceText = ""
	p, err = BuildRequest(d, "voice.wav", "")
	must(t, err)
	if _, ok := p["request"].(map[string]any)["options"].(map[string]any)["reference_text"]; ok {
		t.Fatal(p)
	}
	if _, err = BuildRequest(d, "", ""); err == nil {
		t.Fatal("克隆缺少参考音频时应报错")
	}
	for _, patch := range []func(*schema.Draft){
		func(d *schema.Draft) { d.VoiceMode = "continuation" },
		func(d *schema.Draft) { d.VoiceMode = "design"; d.Speaker = "unknown" },
		func(d *schema.Draft) { d.ReferenceText = strings.Repeat("字", 2001) },
		func(d *schema.Draft) { negative := -1; d.Seed = &negative },
	} {
		invalid := d
		patch(&invalid)
		if schema.Validate(invalid) == nil {
			t.Fatal("应拒绝无效参数", invalid)
		}
	}
	// 未设置的模式、音色和语言按默认处理。
	defaults := schema.DefaultDraft()
	defaults.ModelID = "plapre-3-f32"
	defaults.Text = "Hello."
	p, err = BuildRequest(defaults, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if r := p["request"].(map[string]any); r["voice_id"] != "tor" || r["voice_ref"] != nil {
		t.Fatal(r)
	}
}

func TestXTTSRequest(t *testing.T) {
	d := schema.DefaultDraft()
	d.ModelID = "xtts-v2-q8"
	d.Text = " 你好。 "
	d.ModelOptions = map[string]map[string]any{"xtts_v2": {"temperature": 0.8, "top_k": float64(40), "top_p": 0.9, "repetition_penalty": 8.0, "text_chunk_size": float64(200)}}
	seed := 4294967295
	d.Seed = &seed
	if !d.RequiresVoice() {
		t.Fatal("XTTS 必须要求参考音频")
	}
	p, err := BuildRequest(d, "voice.wav", "")
	must(t, err)
	r := p["request"].(map[string]any)
	o := r["options"].(map[string]any)
	if r["text"] != "你好。" || r["voice_ref"] != "voice.wav" || r["language"] != "zh-cn" || o["temperature"] != 0.8 || o["top_k"] != float64(40) || o["top_p"] != 0.9 || o["repetition_penalty"] != 8.0 || o["text_chunk_size"] != float64(200) || o["seed"] != seed {
		t.Fatal(r)
	}
	d.SynthesisLanguage = "ja"
	p, err = BuildRequest(d, "voice.wav", "")
	must(t, err)
	if p["request"].(map[string]any)["language"] != "ja" {
		t.Fatal(p)
	}
	if _, err = BuildRequest(d, "", ""); err == nil {
		t.Fatal("缺少参考音频时应报错")
	}
	for _, language := range []string{"en", "es", "fr", "de", "it", "pt", "pl", "tr", "ru", "nl", "cs", "ar", "zh-cn", "hu", "ko", "ja", "hi"} {
		d.SynthesisLanguage = language
		must(t, schema.Validate(d))
	}
	d.SynthesisLanguage = "auto"
	p, err = BuildRequest(d, "voice.wav", "")
	must(t, err)
	if p["request"].(map[string]any)["language"] != "zh-cn" {
		t.Fatal(p)
	}
	d.SynthesisLanguage = "en-US"
	if schema.Validate(d) == nil {
		t.Fatal("应拒绝不支持的语言")
	}
	negative := -1
	d.Seed = &negative
	if schema.Validate(d) == nil {
		t.Fatal("应拒绝无效种子")
	}
	// 未设置的模式、音色和语言按默认处理。
	defaults := schema.DefaultDraft()
	defaults.ModelID = "xtts-v2-q4"
	defaults.Text = "Hello."
	p, err = BuildRequest(defaults, "voice.wav", "")
	if err != nil {
		t.Fatal(err)
	}
	if r := p["request"].(map[string]any); r["language"] != "zh-cn" {
		t.Fatal(r)
	}
}

func TestGradiumRequest(t *testing.T) {
	d := schema.DefaultDraft()
	d.ModelID = "gradium-phonon-31m-en-q8"
	d.Text = " Hello from Phonon. "
	d.ModelOptions = map[string]map[string]any{"gradium_phonon": {"temperature": 0.4, "text_chunk_tokens": float64(64)}}
	seed := 4294967295
	d.Seed = &seed
	p, err := BuildRequest(d, "ignored.wav", "")
	must(t, err)
	r := p["request"].(map[string]any)
	o := r["options"].(map[string]any)
	if r["text"] != "Hello from Phonon." || r["voice_ref"] != nil || r["voice_id"] != nil || r["language"] != nil || o["temperature"] != 0.4 || o["text_chunk_tokens"] != float64(64) || o["seed"] != seed || d.RequiresVoice() {
		t.Fatal(r)
	}
	d.SynthesisLanguage = "zh"
	if schema.Validate(d) == nil {
		t.Fatal("Phonon 只支持英文")
	}
	negative := -1
	d.Seed = &negative
	if schema.Validate(d) == nil {
		t.Fatal("应拒绝无效种子")
	}
	// 未设置的模式、音色和语言按默认处理。
	defaults := schema.DefaultDraft()
	defaults.ModelID = d.ModelID
	defaults.Text = "Hello."
	p, err = BuildRequest(defaults, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if r := p["request"].(map[string]any); r["language"] != nil || r["voice_ref"] != nil {
		t.Fatal(r)
	}
}

func TestDramaRequest(t *testing.T) {
	d := schema.DefaultDraft()
	d.ModelID = "fish-drama3-small-iq3"
	d.Text = " <|speaker:0|>Hello [laughs] "
	d.ModelOptions = map[string]map[string]any{"fish_drama3": {"top_p": 0.8, "temperature": 0.9, "max_tokens": float64(512), "text_chunk_size": float64(96)}}
	seed := 12
	d.Seed = &seed
	p, err := BuildRequest(d, "ignored.wav", "")
	must(t, err)
	r := p["request"].(map[string]any)
	o := r["options"].(map[string]any)
	if r["text"] != "<|speaker:0|>Hello [laughs]" || r["voice_ref"] != nil || o["reference_text"] != nil || o["top_p"] != 0.8 || o["temperature"] != 0.9 || o["max_tokens"] != float64(512) || o["text_chunk_size"] != float64(96) || o["seed"] != seed || d.RequiresVoice() {
		t.Fatal(r)
	}
	d.VoiceMode = "clone"
	d.ReferenceText = " Reference transcript. "
	p, err = BuildRequest(d, "voice.wav", "")
	must(t, err)
	r = p["request"].(map[string]any)
	o = r["options"].(map[string]any)
	if r["voice_ref"] != "voice.wav" || o["reference_text"] != "Reference transcript." || !d.RequiresVoice() {
		t.Fatal(r)
	}
	if _, err = BuildRequest(d, "", ""); err == nil {
		t.Fatal("克隆缺少参考音频时应报错")
	}
	d.ReferenceText = " "
	if schema.Validate(d) == nil {
		t.Fatal("Drama 克隆必须提供参考原文")
	}
	for _, patch := range []func(*schema.Draft){
		func(d *schema.Draft) { d.VoiceMode = "continuation" },
		func(d *schema.Draft) { d.ReferenceText = strings.Repeat("字", 2001) },
		func(d *schema.Draft) { negative := -1; d.Seed = &negative },
	} {
		invalid := d
		patch(&invalid)
		if schema.Validate(invalid) == nil {
			t.Fatal("应拒绝无效参数", invalid)
		}
	}
	// 未设置的模式、音色和语言按默认处理。
	defaults := schema.DefaultDraft()
	defaults.ModelID = "fish-drama3-q2"
	defaults.Text = "Hello."
	p, err = BuildRequest(defaults, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if r := p["request"].(map[string]any); r["voice_ref"] != nil {
		t.Fatal(r)
	}
}
