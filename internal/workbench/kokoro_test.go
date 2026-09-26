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
		if _, err := m.URL("huggingface"); m.RemotePath == "" && err == nil {
			t.Fatal("模型未发布时必须明确要求导入，不能生成无效下载地址")
		}
	}
}

func TestKokoroOfficialDownload(t *testing.T) {
	m, err := model("kokoro-82m-q8")
	must(t, err)
	url, err := m.URL("huggingface")
	must(t, err)
	if url != "https://huggingface.co/audio-cpp/audio.cpp-gguf/resolve/"+m.Revision+"/Kokoro-82M-GGUF/kokoro-82m-q8_0.gguf" || m.Size != 189549408 || m.SHA256 != "5d800fd204029302c10313daeafdb31c875c7c29ae31974d0d156cc7f512d1d0" {
		t.Fatal("官方模型下载元数据不匹配", m)
	}
	for _, voice := range m.Voices {
		if kokoroLanguage(voice) == "ja" {
			t.Fatal("官方小包没有 UniDic，不应提供日语音色")
		}
	}
}
