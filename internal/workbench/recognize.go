package workbench

import (
	"context"
	"math"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
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
	model, e := w.recognizer(s)
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
		if e = audio.WriteMono(input, recognizeInput(modelFamily(model.ID), audio.Resample(samples, rate, recognizeRate)), recognizeRate); e != nil {
			return e
		}
		heard, e := w.engine.Recognize(ctx, *s.RuntimePath, model, s.Preferences.Backend, input, false, func(code msg.Code, params msg.Params) { w.progress(code, params, 0, 1) })
		if e != nil {
			return e
		}
		text, language := heard.Text, heard.Language
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

// recognizer 返回转写和识别参考文本用的语音识别模型：优先用设置里选的；没选或已移除时按 catalog.RecognizerFamilies 的顺序取已安装的。
func (w *Workbench) recognizer(s schema.State) (schema.InstalledModel, error) {
	if id := s.Preferences.RecognizeModel; id != "" && slices.ContainsFunc(s.Models, func(m schema.InstalledModel) bool { return m.ID == id }) {
		return w.engineModel(s, id)
	}
	return w.toolModel(s, catalog.RecognizerFamilies...)
}

// modelFamily 返回目录里模型的家族，不在目录里时为空。
func modelFamily(id string) string {
	p, _ := catalog.Lookup(id)
	return p.Family
}

// recognizeInput 是送去识别的音频。Confucius4-R2T2 在音频紧接着最后一个词结束时常把这个词漏掉，
// 末尾补 300 毫秒静音；不改动 samples 底层的其余数据。
func recognizeInput(family string, samples []float32) []float32 {
	if family != "confucius4_r2t2" {
		return samples
	}
	return append(slices.Clip(samples), make([]float32, recognizeRate*3/10)...)
}

// toolModel 返回已安装的某个工具模型（按优先顺序找 families 里的第一个），没有时提示下载语音识别模型。
// 要求调用方持有编辑锁。
func (w *Workbench) toolModel(s schema.State, families ...string) (schema.InstalledModel, error) {
	for _, family := range families {
		i := slices.IndexFunc(s.Models, func(m schema.InstalledModel) bool {
			p, e := catalog.Lookup(m.ID)
			return e == nil && p.Family == family
		})
		if i >= 0 {
			return w.engineModel(s, s.Models[i].ID)
		}
	}
	return schema.InstalledModel{}, msg.Err(msg.ErrRecognizeModelRequired, nil)
}

// transcriptName 去掉文件名的目录与扩展名，限制长度；空名留给界面用默认名。
func transcriptName(name string) string {
	name = strings.TrimSpace(filepath.Base(strings.ReplaceAll(name, "\\", "/")))
	if name == "." || name == "/" {
		return ""
	}
	name = strings.TrimSuffix(name, filepath.Ext(name))
	if runes := []rune(name); len(runes) > 100 {
		name = string(runes[:100])
	}
	return name
}

// speechChunks 把语音切成不超过 limit 个样本的段：每段在后三分之一里找最安静的 20 ms 切开，避开说话中间；
// 整段几乎无声的部分直接跳过。返回各段的样本区间。
func speechChunks(samples []float32, rate, limit int) [][2]int {
	frame := rate / 50
	if frame <= 0 || len(samples) < frame {
		return nil
	}
	levels := make([]float64, (len(samples)+frame-1)/frame)
	for i := range levels {
		var sum float64
		part := samples[i*frame : min(len(samples), (i+1)*frame)]
		for _, v := range part {
			sum += float64(v) * float64(v)
		}
		levels[i] = math.Sqrt(sum / float64(len(part)))
	}
	sorted := slices.Clone(levels)
	slices.Sort(sorted)
	threshold := max(sorted[len(sorted)*95/100]*.03, 1e-4)
	per := max(1, limit/frame)
	var chunks [][2]int
	for from := 0; from < len(levels); {
		to := len(levels)
		if to-from > per {
			// 在 [from+2/3, from+1] 的窗口里取最安静的一帧作为切点。
			to = from + per
			best := to
			for k := from + per*2/3; k < from+per; k++ {
				if levels[k] < levels[best-1] {
					best = k + 1
				}
			}
			to = best
		}
		if slices.ContainsFunc(levels[from:to], func(v float64) bool { return v >= threshold }) {
			chunks = append(chunks, [2]int{from * frame, min(len(samples), to*frame)})
		}
		from = to
	}
	return chunks
}

// joinSpeech 接起两段识别结果：中日韩文字之间直接相连，其他文字用空格隔开。
func joinSpeech(a, b string) string {
	a, b = strings.TrimSpace(a), strings.TrimSpace(b)
	if a == "" || b == "" {
		return a + b
	}
	last, _ := utf8.DecodeLastRuneInString(a)
	first, _ := utf8.DecodeRuneInString(b)
	if closeScript(last) || closeScript(first) {
		return a + b
	}
	return a + " " + b
}

// closeScript 判断字符是否属于不用空格分词的文字（汉字、假名、谚文）或全角标点。
func closeScript(r rune) bool {
	return unicode.In(r, unicode.Han, unicode.Hiragana, unicode.Katakana, unicode.Hangul) || (r >= 0x3000 && r <= 0x303f) || (r >= 0xff00 && r <= 0xffef)
}

// DismissTranscript 在界面填入声音样本的识别结果后清除。
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
