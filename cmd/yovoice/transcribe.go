package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"yovoice/internal/schema"
	"yovoice/internal/workbench"
)

// transcribeFile 转写一个音频或视频文件：与桌面端“语音转写”相同，结果同时保存为一份转写记录（App 里可继续编辑），
// 再按输出扩展名写出字幕。断句沿用“设置 › 常规 › 语音转写”的规则。
func transcribeFile(w *workbench.Workbench, input, output string, wait func(func() error) error) (any, error) {
	before := map[string]bool{}
	for _, t := range w.Store.Read().Transcripts {
		before[t.ID] = true
	}
	if err := wait(func() error {
		f, e := os.Open(input)
		if e != nil {
			return e
		}
		defer f.Close()
		return w.TranscribeSpeech(filepath.Base(input), f)
	}); err != nil {
		return nil, err
	}
	list := w.Store.Read().Transcripts
	if len(list) == 0 || before[list[0].ID] {
		return nil, fmt.Errorf("转写结果未找到")
	}
	record := list[0]
	content, err := w.ReadTranscript(record.ID)
	if err != nil {
		return nil, err
	}
	captions := make([]schema.Caption, len(content.Captions))
	for i, c := range content.Captions {
		captions[i] = schema.Caption{Start: c.Start, End: c.End, Text: c.Text}
	}
	var data []byte
	if format := strings.TrimPrefix(strings.ToLower(filepath.Ext(output)), "."); format == "json" {
		if data, err = json.MarshalIndent(content, "", "  "); err != nil {
			return nil, err
		}
	} else {
		text, e := schema.FormatCaptions(captions, format, false)
		if e != nil {
			return nil, e
		}
		data = []byte(text)
	}
	if err = writeNew(output, data); err != nil {
		return nil, err
	}
	return map[string]any{"id": record.ID, "path": output, "duration": record.Duration, "language": record.Language, "lines": len(captions), "text": content.Text}, nil
}
