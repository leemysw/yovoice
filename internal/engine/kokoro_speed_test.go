package engine

import (
	"math"
	"testing"
	"yovoice/internal/schema"
)

func TestKokoroRequestCarriesSpeakingRate(t *testing.T) {
	for _, id := range []string{"kokoro-82m-q8", "kokoro-1.1-zh-q8"} {
		for _, speed := range []float64{0.5, 1, 1.5, 2} {
			d := schema.DefaultDraft()
			d.ModelID = id
			d.Speed = speed
			payload, err := BuildRequest(d, "", "")
			must(t, err)
			options := payload["request"].(map[string]any)["options"].(map[string]any)
			if options["speed"] != speed {
				t.Fatalf("%s %.2f: %+v", id, speed, options)
			}
		}
	}
}

func TestKokoroRejectsInvalidSpeakingRate(t *testing.T) {
	for _, speed := range []float64{0, 0.4, 2.1, math.NaN(), math.Inf(1)} {
		d := schema.DefaultDraft()
		d.ModelID = "kokoro-82m-q8"
		d.Speed = speed
		if _, err := BuildRequest(d, "", ""); err == nil {
			t.Fatalf("应拒绝语速 %v", speed)
		}
	}
}
