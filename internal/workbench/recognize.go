package workbench

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
	"yovoice/internal/audio"
	"yovoice/internal/catalog"
	"yovoice/internal/diag"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
)

// recognizeRate 是 Qwen3 ASR 的输入采样率。
const recognizeRate = 16000

// RecognizeVoice 用可选下载的语音识别模型把声音样本转成文字，供克隆时作参考文本。
// 结果放在会话状态 Transcript 里，由发起识别的界面填入；声音样本还没有参考文本时同时保存到样本上，下次选用直接带出。
func (w *Workbench) RecognizeVoice(id string) error {
	path, e := w.MediaFile("voices", id)
	if e != nil {
		return e
	}
	w.edit.Lock()
	defer w.edit.Unlock()
	s := w.Store.Read()
	if !slices.ContainsFunc(s.Voices, func(v schema.Voice) bool { return v.ID == id }) {
		return msg.Err(msg.ErrAudioMissing, nil)
	}
	m := slices.IndexFunc(s.Models, func(m schema.InstalledModel) bool {
		p, e := catalog.Lookup(m.ID)
		return e == nil && p.Family == "qwen3_asr"
	})
	if m < 0 {
		return msg.Err(msg.ErrRecognizeModelRequired, nil)
	}
	model, e := w.engineModel(s, s.Models[m].ID)
	if e != nil {
		return e
	}
	_, e = w.start("generate", msg.ActivityRecognize, nil, &model.ID, func(ctx context.Context) error {
		runtimeDir := filepath.Join(w.Store.Root, "runtime")
		if e := os.MkdirAll(runtimeDir, 0700); e != nil {
			return e
		}
		dir, e := os.MkdirTemp(runtimeDir, "recognize-")
		if e != nil {
			return e
		}
		defer os.RemoveAll(dir)
		samples, rate, e := audio.ReadMono(path)
		if e != nil {
			return e
		}
		input := filepath.Join(dir, "speech.wav")
		if e = audio.WriteMono(input, audio.Resample(samples, rate, recognizeRate), recognizeRate); e != nil {
			return e
		}
		text, language, e := w.engine.Recognize(ctx, *s.RuntimePath, model, s.Preferences.Backend, input, func(code msg.Code, params msg.Params) { w.progress(code, params, 0, 1) })
		if e != nil {
			return e
		}
		// 参考文本最多 2000 字，超出部分截掉（样本最长 60 秒，正常不会超过）。
		if runes := []rune(text); len(runes) > 2000 {
			text = strings.TrimSpace(string(runes[:2000]))
		}
		if text == "" {
			return msg.Err(msg.ErrRecognizeEmpty, nil)
		}
		diag.Log(w.Store.Root, "voice.recognized", "voice_id", id, "chars", schema.TextLen(text), "language", language)
		result := schema.TranscriptResult{ID: schema.NewID(), VoiceID: id, Text: text, Language: language, CreatedAt: time.Now().UTC()}
		return w.Store.Update(func(s *schema.State) {
			s.Transcript = &result
			for i := range s.Voices {
				if s.Voices[i].ID == id && strings.TrimSpace(s.Voices[i].ReferenceText) == "" {
					s.Voices[i].ReferenceText = text
				}
			}
		}, true)
	})
	if e == nil {
		w.tagActivity("recognize")
	}
	return e
}

// DismissTranscript 在界面填入识别结果后清除。
func (w *Workbench) DismissTranscript(id string) error {
	return w.Store.Update(func(s *schema.State) {
		if s.Transcript != nil && s.Transcript.ID == id {
			s.Transcript = nil
		}
	}, false)
}

// tagActivity 标记当前生成操作的具体任务；引擎进度会改写消息码，界面靠这个标记区分（见 Activity.Task）。
func (w *Workbench) tagActivity(task string) {
	_ = w.Store.Update(func(s *schema.State) {
		if s.Activity != nil {
			s.Activity.Task = task
		}
	}, false)
}
