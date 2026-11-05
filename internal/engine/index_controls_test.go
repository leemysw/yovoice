package engine

import (
	"testing"
	"yovoice/internal/schema"
)

func TestIndexTextControlsReachInferenceRequest(t *testing.T) {
	for _, id := range []string{"index-2-q8", "index-2.5-q8"} {
		d := schema.DefaultDraft()
		d.ModelID = id
		d.ModelOptions = map[string]map[string]any{"index_tts2": {"max_text_tokens_per_segment": float64(60)}}
		if id == "index-2.5-q8" {
			d.ModelOptions["index_tts2"]["text_normalization"] = false
		}
		payload, err := BuildRequest(d, "reference.wav", "")
		must(t, err)
		options := payload["request"].(map[string]any)["options"].(map[string]any)
		if options["max_text_tokens_per_segment"] != float64(60) {
			t.Fatal(options)
		}
		if id == "index-2.5-q8" && options["text_normalization"] != false {
			t.Fatal(options)
		}
	}
	d := schema.DefaultDraft()
	d.ModelID = "index-2-q8"
	d.ModelOptions = map[string]map[string]any{"index_tts2": {"text_normalization": false}}
	if _, err := BuildRequest(d, "reference.wav", ""); err == nil {
		t.Fatal("2.0 不支持的文本规范化开关不能透传")
	}
	d.ModelID = "index-2.5-q8"
	for _, value := range []any{float64(0), float64(601), float64(1.5), "60"} {
		d.ModelOptions["index_tts2"]["max_text_tokens_per_segment"] = value
		if _, err := BuildRequest(d, "reference.wav", ""); err == nil {
			t.Fatal("应拒绝无效分段上限", value)
		}
	}
}
