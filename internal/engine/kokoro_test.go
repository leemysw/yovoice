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
			if len(o) != 1 || o["speed"] != float64(1) {
				t.Fatal("默认语速为 1，分段交给内核，不能透传其他模型的参数", o)
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
		{"kokoro-82m-q8", "Q8", "kokoro-82m-q8_0.gguf", "9a4ca6176460cdc8c7845b804c0bbe85a4791ee3ffff568a3fdadbb708c63f47", 189550976},
		{"kokoro-82m-bf16", "BF16", "kokoro-82m-bf16.gguf", "0d2c2afac39b0ff01fb20b5633a6a5543735e612942b3af571424502b9c2dfaa", 211956384},
	} {
		t.Run(test.id, func(t *testing.T) {
			m, err := catalog.Lookup(test.id)
			must(t, err)
			if m.Precision != test.precision || m.Size != test.size || m.SHA256 != test.hash || m.Revision != "" {
				t.Fatal("官方模型下载元数据不匹配", m)
			}
			for source, prefix := range map[string]string{
				"huggingface": "https://huggingface.co/audio-cpp/audio.cpp-gguf/resolve/" + catalog.Revision,
				"mirror":      "https://hf-mirror.com/audio-cpp/audio.cpp-gguf/resolve/" + catalog.Revision,
				"modelscope":  "https://modelscope.cn/models/HereIsMark/audio.cpp-gguf/resolve/" + catalog.ModelScopeRevision,
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

func TestKokoroVoiceBlend(t *testing.T) {
	m, err := catalog.Lookup("kokoro-82m-q8")
	must(t, err)
	d := schema.DefaultDraft()
	d.ModelID = m.ID
	d.SynthesisLanguage = "en-us"
	for _, speaker := range []string{
		"af_alloy(0.5)+af_heart(0.5)",
		"af_alloy(1)+af_heart(1)",
		"am_adam(2.5)+af_alloy(0.25)",
	} {
		d.Speaker = speaker
		payload, err := BuildRequest(d, "", "")
		must(t, err)
		r := payload["request"].(map[string]any)
		if r["voice_id"] != speaker {
			t.Fatalf("混合音色应原样透传 voice_id：%v", r)
		}
	}

	for _, speaker := range []string{
		"af_alloy(0)+af_heart(1)",
		"af_alloy(-0.5)+af_heart(1.5)",
		"af_alloy(NaN)+af_heart(1)",
		"af_alloy(Inf)+af_heart(1)",
		"unknown(0.5)+af_heart(0.5)",
		"af_alloy(0.5)+bf_alice(0.5)",
		"af_alloy()+af_heart(0.5)",
		"af_alloy(0.5)af_heart(0.5)",
		"af_alloy(0.5)+af_heart(0.5)+am_adam(0.5)",
	} {
		d.Speaker = speaker
		if schema.Validate(d) == nil {
			t.Errorf("应拒绝非法混合音色 %q", speaker)
		}
	}
	d.Speaker = "af_alloy(0.5)+af_heart(0.5)"
	d.SynthesisLanguage = "en-gb"
	if schema.Validate(d) == nil {
		t.Fatal("显式语言仍应匹配混合音色的第一音色")
	}
}

func TestKokoroStorySpeakersUseExistingSpeakerSettings(t *testing.T) {
	m, err := catalog.Lookup("kokoro-82m-q8")
	must(t, err)
	story := schema.DefaultDraft()
	story.ModelID = m.ID
	story.Kind = "story"
	story.Text = "夜色很深。\n我来了。"
	narrator := story.SynthesisSettings
	narrator.Speaker = "af_alloy(0.5)+af_heart(0.5)"
	narrator.SynthesisLanguage = "auto"
	hero := story.SynthesisSettings
	hero.Speaker = "zf_xiaobei"
	hero.SynthesisLanguage = "auto"
	story.Subtitles = &schema.SubtitleDocument{
		Speakers: []schema.SubtitleSpeaker{{ID: "narrator", SourceName: "旁白", Settings: &narrator}, {ID: "hero", SourceName: "主角", Settings: &hero}},
		Cues:     []schema.SubtitleCue{{Start: 0, End: 1000, Text: "夜色很深。", SpeakerID: "narrator"}, {Start: 1000, End: 2000, Text: "我来了。", SpeakerID: "hero"}},
	}
	drafts, err := story.SubtitleDrafts()
	must(t, err)
	for i, want := range []string{narrator.Speaker, hero.Speaker} {
		payload, err := BuildRequest(drafts[i], "", "")
		must(t, err)
		r := payload["request"].(map[string]any)
		if drafts[i].Speaker != want || r["voice_id"] != want {
			t.Fatalf("角色 %d 未复用现有 speaker 链路：%+v", i, r)
		}
	}
}
