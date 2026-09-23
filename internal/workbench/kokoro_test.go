package workbench

import "testing"

func TestKokoroVoiceRequests(t *testing.T) {
	for _, m := range Catalog {
		if m.Family != "kokoro_tts" {
			continue
		}
		d := DefaultDraft()
		d.ModelID = m.ID
		if d.RequiresVoice() {
			t.Fatal("Kokoro 不应要求参考录音")
		}
		for _, voice := range append([]string{""}, m.Voices...) {
			d.Speaker = voice
			d.SynthesisLanguage = kokoroLanguage(d.kokoroSpeaker(m))
			payload, err := BuildRequest(d, "", "")
			must(t, err)
			r := payload["request"].(map[string]any)
			if r["voice_id"] != d.kokoroSpeaker(m) || r["voice_ref"] != nil || r["language"] != nil {
				t.Fatal(r)
			}
			o := r["options"].(map[string]any)
			if len(o) != 1 || o["text_chunk_size"] != 64 {
				t.Fatal("不能透传其他模型的参数", o)
			}
		}
		d.SynthesisLanguage = "ja"
		d.Speaker = d.kokoroSpeaker(m)
		if Validate(d) == nil {
			t.Fatal("拒绝音色与语言不匹配")
		}
		d.SynthesisLanguage, d.Speaker = "auto", "unknown"
		if Validate(d) == nil {
			t.Fatal("拒绝未知音色")
		}
		if _, err := m.URL("huggingface"); err == nil {
			t.Fatal("模型未发布时必须明确要求导入，不能生成无效下载地址")
		}
	}
}
