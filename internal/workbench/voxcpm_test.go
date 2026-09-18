package workbench

import (
	"math"
	"testing"
)

func TestVoxCPMRequest(t *testing.T) {
	d := DefaultDraft()
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
			if len(o) != 2 || o["guidance_scale"] != float64(2) || o["num_inference_steps"] != 10 {
				t.Fatal(o)
			}
			_, voice := r["voice_ref"]
			_, transcript := r["reference_text"]
			if voice != (mode != "design") || transcript != (mode == "continuation") {
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
	for _, patch := range []func(*Draft){
		func(d *Draft) { d.VoxMode = "invalid" },
		func(d *Draft) { d.VoxMode = "continuation"; d.ReferenceText = " " },
		func(d *Draft) { d.GuidanceScale = math.NaN() },
		func(d *Draft) { d.InferenceSteps = 51 },
	} {
		invalid := d
		patch(&invalid)
		if Validate(invalid) == nil {
			t.Fatal("应拒绝无效参数", invalid)
		}
	}
}

func TestOmniAndQwenRequests(t *testing.T) {
	for _, id := range []string{"omnivoice-q8", "omnivoice-bf16", "qwen3-tts-base-q8", "qwen3-tts-base-bf16"} {
		t.Run(id, func(t *testing.T) {
			d := DefaultDraft()
			d.ModelID = id
			d.VoiceDescription = "female, young adult, moderate pitch"
			d.VoiceMode = "design"
			m, err := model(id)
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
			if Validate(d) == nil {
				t.Fatal("无效种子应失败")
			}
		})
	}
}

func TestModelVariantsAndOptions(t *testing.T) {
	for _, m := range Catalog {
		t.Run(m.ID, func(t *testing.T) {
			d := DefaultDraft()
			d.ModelID = m.ID
			d.VoiceDescription = "female, young adult"
			d.ModelOptions = map[string]map[string]any{m.Family: {"text_chunk_size": float64(512), "text_chunk_mode": "tag_aware"}}
			if m.Family == "qwen3_tts" {
				d.SynthesisLanguage = "ja"
				d.ModelOptions[m.Family]["temperature"] = .7
			}
			p, err := BuildRequest(d, "reference.wav", "")
			must(t, err)
			r := p["request"].(map[string]any)
			o := r["options"].(map[string]any)
			if o["text_chunk_size"] != float64(512) {
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
			if Validate(d) == nil {
				t.Fatal("拒绝未支持的流式或任意引擎选项")
			}
			delete(d.ModelOptions[m.Family], "streaming")
			d.ModelOptions[m.Family]["text_chunk_size"] = 1.5
			if Validate(d) == nil {
				t.Fatal("拒绝非整数分段字数")
			}
		})
	}
	for _, invalid := range []string{"warm voice", "female, male", "young adult, 老年"} {
		d := DefaultDraft()
		d.ModelID = "omnivoice-q8"
		d.VoiceDescription = invalid
		if Validate(d) == nil {
			t.Fatal("拒绝无效或互斥的音色属性", invalid)
		}
	}
}
