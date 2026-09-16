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
