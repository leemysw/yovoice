package engine

import (
	"slices"
	"testing"
	"yovoice/internal/catalog"
	"yovoice/internal/schema"
)

func TestKokoroVoiceRequests(t *testing.T) {
	for _, m := range catalog.Models {
		if m.Family != "kokoro_tts" {
			continue
		}
		d := schema.DefaultDraft()
		d.ModelID = m.ID
		if d.RequiresVoice() {
			t.Fatal("Kokoro 不应要求参考录音")
		}
		for _, voice := range append([]string{""}, m.Voices...) {
			d.Speaker = voice
			d.SynthesisLanguage = schema.KokoroLanguage(d.KokoroSpeaker(m))
			payload, err := BuildRequest(d, "", "")
			must(t, err)
			r := payload["request"].(map[string]any)
			if r["voice_id"] != d.KokoroSpeaker(m) || r["voice_ref"] != nil || r["language"] != nil {
				t.Fatal(r)
			}
			o := r["options"].(map[string]any)
			if len(o) != 1 || o["text_chunk_size"] != 64 {
				t.Fatal("不能透传其他模型的参数", o)
			}
		}
		d.SynthesisLanguage = "ja"
		d.Speaker = d.KokoroSpeaker(m)
		if schema.Validate(d) == nil {
			t.Fatal("拒绝音色与语言不匹配")
		}
		d.SynthesisLanguage, d.Speaker = "auto", "unknown"
		if schema.Validate(d) == nil {
			t.Fatal("拒绝未知音色")
		}
		if _, err := m.URL("huggingface"); m.RemotePath == "" && err == nil {
			t.Fatal("模型未发布时必须明确要求导入，不能生成无效下载地址")
		}
	}
}

func TestKokoroOfficialDownload(t *testing.T) {
	for _, test := range []struct {
		id, precision, file, hash string
		size                      int64
	}{
		{"kokoro-82m-q8", "Q8", "kokoro-82m-q8_0.gguf", "5d800fd204029302c10313daeafdb31c875c7c29ae31974d0d156cc7f512d1d0", 189549408},
		{"kokoro-82m-bf16", "BF16", "kokoro-82m-bf16.gguf", "51d10c63557d21f70ef5d607e91c11023cf408dbc3af24c283b18106778e1e67", 211954816},
	} {
		t.Run(test.id, func(t *testing.T) {
			m, err := catalog.Lookup(test.id)
			must(t, err)
			if m.Precision != test.precision || m.Size != test.size || m.SHA256 != test.hash || m.Revision != "0a104324546d2622985e3c676a4b5550cc772127" {
				t.Fatal("官方模型下载元数据不匹配", m)
			}
			for source, prefix := range map[string]string{
				"huggingface": "https://huggingface.co/audio-cpp/audio.cpp-gguf/resolve/" + m.Revision,
				"mirror":      "https://hf-mirror.com/audio-cpp/audio.cpp-gguf/resolve/" + m.Revision,
				"modelscope":  "https://modelscope.cn/models/HereIsMark/audio.cpp-gguf/resolve/master",
			} {
				url, err := m.URL(source)
				must(t, err)
				if url != prefix+"/Kokoro-82M-GGUF/"+test.file {
					t.Fatal("官方模型下载地址不匹配", source, url)
				}
			}
			q8, err := catalog.Lookup("kokoro-82m-q8")
			must(t, err)
			if len(m.Voices) != 49 || !slices.Equal(m.Voices, q8.Voices) {
				t.Fatal("两种精度应提供相同的 49 个音色")
			}
			for _, voice := range m.Voices {
				if schema.KokoroLanguage(voice) == "ja" {
					t.Fatal("官方小包没有 UniDic，不应提供日语音色")
				}
			}
		})
	}
}
