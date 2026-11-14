package workbench

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"unicode"
	"yovoice/internal/audio"
	"yovoice/internal/diag"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
)

// 给语音版本对齐字幕时间：音频最长 maxTextAlignSeconds 秒，正文最多 maxTextAlignRunes 字。
const maxTextAlignSeconds, maxTextAlignRunes = 3600, 50000

// TextCaptions 把语音版本对齐好的逐字时间按句分成字幕行；还没对齐时返回空列表，由界面先发起 AlignText。
func (w *Workbench) TextCaptions(id string) ([]schema.Caption, error) {
	s := w.Store.Read()
	i := slices.IndexFunc(s.History, func(g schema.Generation) bool { return g.ID == id })
	if i < 0 {
		return nil, msg.Err(msg.ErrAudioMissing, nil)
	}
	g := s.History[i]
	return schema.WordCaptions(spokenText(g.Settings), g.TextWords, schema.DefaultCaptionRules), nil
}

// AlignText 把语音版本的正文逐字对齐到它的音频上，结果写进 TextWords，界面据此按句分行导出 SRT / WebVTT 字幕。
// 正文是已知的，直接用强制对齐，字幕不会有识别错字；语音识别包或歌词对齐包里的对齐模型都可以用。
func (w *Workbench) AlignText(id string) error {
	path, e := w.MediaFile("outputs", id)
	if e != nil {
		return e
	}
	w.edit.Lock()
	defer w.edit.Unlock()
	s := w.Store.Read()
	i := slices.IndexFunc(s.History, func(g schema.Generation) bool { return g.ID == id })
	if i < 0 {
		return msg.Err(msg.ErrAudioMissing, nil)
	}
	generation := s.History[i]
	text := spokenText(generation.Settings)
	if text == "" {
		return msg.Err(msg.ErrAlignText, nil)
	}
	if generation.Duration > maxTextAlignSeconds || schema.TextLen(text) > maxTextAlignRunes {
		return msg.Err(msg.ErrAudioDuration, nil)
	}
	model, e := w.toolModel(s, "qwen3_asr", "confucius4_r2t2", "lyric_align")
	if e != nil {
		return e
	}
	_, e = w.start("generate", msg.ActivityAlignText, msg.Params{"done": 0, "total": 1}, &model.ID, func(ctx context.Context) error {
		runtimeDir := filepath.Join(w.Store.Root, "runtime")
		if e := os.MkdirAll(runtimeDir, 0700); e != nil {
			return e
		}
		dir, e := os.MkdirTemp(runtimeDir, "caption-")
		if e != nil {
			return e
		}
		defer os.RemoveAll(dir)
		samples, rate, e := audio.ReadMono(path)
		if e != nil {
			return e
		}
		a := w.newAligner(ctx, s, model, audio.Resample(samples, rate, alignRate), alignLanguage(text), dir, msg.ActivityAlignText)
		words, e := a.sequential(sentences(text))
		if e != nil {
			return e
		}
		if len(words) == 0 {
			return msg.Err(msg.ErrAlignTextEmpty, nil)
		}
		diag.Log(w.Store.Root, "text.aligned", "generation_id", id, "requests", a.requests, "words", len(words), "language", a.language)
		return w.Store.Update(func(s *schema.State) {
			for i := range s.History {
				if s.History[i].ID == id {
					s.History[i].TextWords = words
				}
			}
		}, true)
	}, "", generation.Settings.ID)
	if e == nil {
		w.tagActivity("caption")
	}
	return e
}

// spokenText 返回语音版本实际念出的正文；歌曲、音效和编曲版本没有正文可对齐，返回空。
func spokenText(d schema.Draft) string {
	if d.Kind == "music" || d.Kind == "sfx" || d.Kind == "score" {
		return ""
	}
	return schema.SpokenText(d.Text)
}

// sentences 按换行和句末标点把正文切成句子，用来分段对齐；标点留在句尾。
func sentences(text string) []string {
	var out []string
	var b strings.Builder
	flush := func() {
		if line := strings.TrimSpace(b.String()); line != "" {
			out = append(out, line)
		}
		b.Reset()
	}
	runes := []rune(text)
	// ended 表示已到句末标点，后面紧跟的引号、括号和连续标点仍归到这一句。
	ended := false
	for i, r := range runes {
		if r == '\n' {
			flush()
			ended = false
			continue
		}
		b.WriteRune(r)
		ended = ended || strings.ContainsRune("。！？!?；;…", r) || (r == '.' && (i+1 == len(runes) || unicode.IsSpace(runes[i+1])))
		if ended && (i+1 == len(runes) || !strings.ContainsRune("”’」』）)\"'。！？!?…", runes[i+1])) {
			flush()
			ended = false
		}
	}
	flush()
	return out
}
