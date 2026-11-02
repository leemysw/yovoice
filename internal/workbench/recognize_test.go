package workbench

import (
	"os"
	"path/filepath"
	"testing"
	"yovoice/internal/audio"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
	"yovoice/internal/testkit"
)

// recognizeWorkbench 准备两个 24 kHz 的声音样本（一个已有参考文本）；installed 决定是否装好可选的语音识别模型。
func recognizeWorkbench(t *testing.T, installed bool) *Workbench {
	wb, _ := yueWorkbench(t)
	if installed {
		model := filepath.Join(wb.Store.Root, "models", "qwen3-asr-0.6b-q8_0.gguf")
		must(t, os.WriteFile(model, nil, 0600))
		must(t, wb.Store.Update(func(s *schema.State) {
			s.Models = append(s.Models, schema.InstalledModel{ID: "qwen3-asr-0.6b-q8", Path: model})
		}, true))
	}
	for _, name := range []string{"empty.wav", "typed.wav"} {
		must(t, audio.WriteMono(filepath.Join(wb.Store.Root, "voices", name), make([]float32, 2*24000), 24000))
	}
	must(t, wb.Store.Update(func(s *schema.State) {
		s.Voices = []schema.Voice{
			{ID: "0123456789abcdef0123456789abcdef", Name: "空", FileName: "empty.wav", Duration: 2},
			{ID: "fedcba9876543210fedcba9876543210", Name: "已填", FileName: "typed.wav", Duration: 2, ReferenceText: "手动填写的原文"},
		}
	}, true))
	return wb
}

// 没装识别模型时直接提示下载，不启动任务。
func TestRecognizeVoiceNeedsModel(t *testing.T) {
	wb := recognizeWorkbench(t, false)
	if e := wb.RecognizeVoice("0123456789abcdef0123456789abcdef"); !isCode(e, msg.ErrRecognizeModelRequired) {
		t.Fatalf("%v", e)
	}
	if e := wb.RecognizeVoice("00000000000000000000000000000000"); !isCode(e, msg.ErrAudioMissing) {
		t.Fatalf("%v", e)
	}
}

// 样本转成 16 kHz 送去识别；结果放进会话状态等界面填入。样本原来没有参考文本时顺带保存，已有的不覆盖。
func TestRecognizeVoice(t *testing.T) {
	wb := recognizeWorkbench(t, true)
	must(t, wb.RecognizeVoice("0123456789abcdef0123456789abcdef"))
	<-wb.Done()
	s := wb.Store.Read()
	if s.Activity.Status != "completed" || s.Activity.Task != "recognize" {
		t.Fatalf("%+v", s.Activity)
	}
	if s.Transcript == nil || s.Transcript.VoiceID != "0123456789abcdef0123456789abcdef" || s.Transcript.Text != testkit.RecognizedText || s.Transcript.Language != "Chinese" {
		t.Fatalf("%+v", s.Transcript)
	}
	if s.Voices[0].ReferenceText != testkit.RecognizedText {
		t.Fatalf("%+v", s.Voices[0])
	}
	first := s.Transcript.ID

	must(t, wb.RecognizeVoice("fedcba9876543210fedcba9876543210"))
	<-wb.Done()
	s = wb.Store.Read()
	if s.Transcript == nil || s.Transcript.ID == first || s.Transcript.VoiceID != "fedcba9876543210fedcba9876543210" || s.Voices[1].ReferenceText != "手动填写的原文" {
		t.Fatalf("%+v %+v", s.Transcript, s.Voices[1])
	}
	// 只清除界面已填入的那一次结果。
	must(t, wb.DismissTranscript(first))
	if wb.Store.Read().Transcript == nil {
		t.Fatal("清除了较新的识别结果")
	}
	must(t, wb.DismissTranscript(s.Transcript.ID))
	if wb.Store.Read().Transcript != nil {
		t.Fatal("识别结果未清除")
	}
	// 转换后的临时音频用完即删。
	if left, _ := filepath.Glob(filepath.Join(wb.Store.Root, "runtime", "recognize-*")); len(left) != 0 {
		t.Fatalf("%v", left)
	}
}
