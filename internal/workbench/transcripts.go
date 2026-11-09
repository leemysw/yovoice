package workbench

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
	"yovoice/internal/msg"
	"yovoice/internal/platform"
	"yovoice/internal/schema"
)

// 一份转写最多保存的字幕行数与每行字数：1 小时的音频按句分行约一两千行，留足余量。
const maxTranscriptCaptions, maxCaptionRunes = 20000, 1000

// 原音频按扩展名保存，便于浏览器按类型播放；扩展名不像音视频格式时不保存。
var audioExt = regexp.MustCompile(`^\.[a-z0-9]{1,5}$`)

// saveTranscript 把一次转写写入 outputs 目录并加进转写记录：字幕文件保存原文与逐词时间，
// 上传的音频移到同目录供边听边改。upload 是收到的原文件，成功时由这里接管。
// 新记录在一次状态更新里加到最前面，与生成结果写入历史一样不需要编辑锁。
func (w *Workbench) saveTranscript(record schema.Transcript, content schema.TranscriptContent, upload, original string, wav bool) error {
	data, e := json.Marshal(content)
	if e != nil {
		return e
	}
	record.FileName = record.ID + ".json"
	record.Excerpt = transcriptExcerpt([]string{content.Text})
	path, e := w.Store.MediaPath("outputs", record.FileName)
	if e != nil {
		return e
	}
	if e = platform.WriteFileAtomic(path, data, 0600); e != nil {
		return e
	}
	ext := strings.ToLower(filepath.Ext(original))
	if wav {
		ext = ".wav"
	}
	if audioExt.MatchString(ext) {
		if target, e := w.Store.MediaPath("outputs", record.ID+ext); e == nil && os.Rename(upload, target) == nil {
			record.AudioFile = record.ID + ext
		}
	}
	e = w.Store.Update(func(s *schema.State) { s.Transcripts = append([]schema.Transcript{record}, s.Transcripts...) }, true)
	if e != nil {
		_ = os.Remove(path)
		if record.AudioFile != "" {
			_ = os.Remove(filepath.Join(filepath.Dir(path), record.AudioFile))
		}
	}
	return e
}

// transcript 返回指定的转写记录与字幕文件路径。
func (w *Workbench) transcript(id string) (schema.Transcript, string, error) {
	if !schema.ValidID(id) {
		return schema.Transcript{}, "", msg.Err(msg.ErrRequestInvalid, nil)
	}
	s := w.Store.Read()
	i := slices.IndexFunc(s.Transcripts, func(t schema.Transcript) bool { return t.ID == id })
	if i < 0 {
		return schema.Transcript{}, "", msg.Err(msg.ErrTranscriptMissing, nil)
	}
	path, e := w.Store.MediaPath("outputs", s.Transcripts[i].FileName)
	return s.Transcripts[i], path, e
}

// ReadTranscript 读取一份转写的字幕内容。
func (w *Workbench) ReadTranscript(id string) (schema.TranscriptContent, error) {
	_, path, e := w.transcript(id)
	if e != nil {
		return schema.TranscriptContent{}, e
	}
	return readTranscriptFile(path)
}

func readTranscriptFile(path string) (schema.TranscriptContent, error) {
	var content schema.TranscriptContent
	data, e := os.ReadFile(path)
	if os.IsNotExist(e) {
		return content, msg.Err(msg.ErrTranscriptMissing, nil)
	}
	if e != nil {
		return content, e
	}
	if json.Unmarshal(data, &content) != nil {
		return content, msg.Err(msg.ErrTranscriptMissing, nil)
	}
	if content.Words == nil {
		content.Words = []schema.LyricWord{}
	}
	return content, nil
}

// SaveTranscript 保存编辑后的字幕：开始时间按顺序不减，结束不早于开始，不超过音频时长；原文与逐词时间保持不变。
func (w *Workbench) SaveTranscript(id string, captions []schema.TranscriptCaption) error {
	w.edit.Lock()
	defer w.edit.Unlock()
	record, path, e := w.transcript(id)
	if e != nil {
		return e
	}
	if len(captions) > maxTranscriptCaptions {
		return msg.Err(msg.ErrRequestInvalid, nil)
	}
	for i, c := range captions {
		if math.IsNaN(c.Start) || math.IsNaN(c.End) || c.Start < 0 || c.End < c.Start || c.End > record.Duration+1 ||
			(i > 0 && c.Start < captions[i-1].Start) || utf8.RuneCountInString(c.Text) > maxCaptionRunes {
			return msg.Err(msg.ErrRequestInvalid, nil)
		}
	}
	content, e := readTranscriptFile(path)
	if e != nil {
		return e
	}
	// 全部删光也要记下来，免得再打开时又按逐词时间重新分行。
	content.Captions = slices.Clone(captions)
	if content.Captions == nil {
		content.Captions = []schema.TranscriptCaption{}
	}
	data, e := json.Marshal(content)
	if e != nil {
		return e
	}
	if e = platform.WriteFileAtomic(path, data, 0600); e != nil {
		return e
	}
	now := time.Now().UTC()
	texts := make([]string, len(captions))
	for i, c := range captions {
		texts[i] = c.Text
	}
	excerpt := transcriptExcerpt(texts)
	return w.Store.Update(func(s *schema.State) {
		for i := range s.Transcripts {
			if s.Transcripts[i].ID == id {
				s.Transcripts[i].UpdatedAt = &now
				s.Transcripts[i].Excerpt = excerpt
			}
		}
	}, true)
}

// RenameTranscript 修改转写记录的名称，也是导出字幕时的默认文件名。
func (w *Workbench) RenameTranscript(id, name string) error {
	w.edit.Lock()
	defer w.edit.Unlock()
	if _, _, e := w.transcript(id); e != nil {
		return e
	}
	name = strings.TrimSpace(name)
	if schema.TextLen(name) < 1 || schema.TextLen(name) > 120 || strings.ContainsFunc(name, unicode.IsControl) {
		return msg.Err(msg.ErrNameLength, nil)
	}
	return w.Store.Update(func(s *schema.State) {
		for i := range s.Transcripts {
			if s.Transcripts[i].ID == id {
				s.Transcripts[i].Name = name
			}
		}
	}, true)
}

// DeleteTranscript 删除转写记录及其字幕文件和原音频。
func (w *Workbench) DeleteTranscript(id string) error {
	w.edit.Lock()
	defer w.edit.Unlock()
	record, _, e := w.transcript(id)
	if e != nil {
		return e
	}
	if e = w.Store.Update(func(s *schema.State) {
		s.Transcripts = slices.DeleteFunc(s.Transcripts, func(t schema.Transcript) bool { return t.ID == id })
	}, true); e != nil {
		return e
	}
	w.deleteUnreferenced("outputs", []string{record.FileName, record.AudioFile}, nil)
	return nil
}

// 摘录最多保留的字数。
const excerptRunes = 80

// transcriptExcerpt 取字幕开头的一段做摘录：各行相连，英文等以字母结尾与开头的行之间加空格，超出部分截掉。
func transcriptExcerpt(texts []string) string {
	var b strings.Builder
	last := rune(0)
	for _, text := range texts {
		text = strings.Join(strings.Fields(text), " ")
		if text == "" {
			continue
		}
		first, _ := utf8.DecodeRuneInString(text)
		if last != 0 && (last < utf8.RuneSelf || first < utf8.RuneSelf) && !unicode.IsSpace(last) {
			b.WriteByte(' ')
		}
		b.WriteString(text)
		last, _ = utf8.DecodeLastRuneInString(text)
		if utf8.RuneCountInString(b.String()) >= excerptRunes {
			break
		}
	}
	runes := []rune(b.String())
	if len(runes) > excerptRunes {
		return strings.TrimSpace(string(runes[:excerptRunes])) + "…"
	}
	return string(runes)
}
