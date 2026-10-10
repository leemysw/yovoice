package score

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
)

// Read 按扩展名读取 .mid/.midi 或乐谱 JSON，并完整校验。
func Read(path string) (schema.Score, error) {
	info, e := os.Stat(path)
	if e != nil {
		return schema.Score{}, e
	}
	if info.Size() > 16<<20 {
		return schema.Score{}, msg.Err(msg.ErrScoreInvalid, nil)
	}
	data, e := os.ReadFile(path)
	if e != nil {
		return schema.Score{}, e
	}
	if ext := strings.ToLower(filepath.Ext(path)); ext == ".mid" || ext == ".midi" {
		return FromMIDI(data)
	}
	var s schema.Score
	if json.Unmarshal(data, &s) != nil {
		return schema.Score{}, msg.Err(msg.ErrScoreInvalid, nil)
	}
	return s, schema.ValidateScore(&s)
}

// Encode 按扩展名把乐谱编码为 MIDI 或缩进的 JSON。
func Encode(path string, s schema.Score) ([]byte, error) {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".mid", ".midi":
		return MIDI(s)
	case ".json":
		if e := schema.ValidateScore(&s); e != nil {
			return nil, e
		}
		b, e := json.MarshalIndent(s, "", "  ")
		return append(b, '\n'), e
	}
	return nil, msg.Err(msg.ErrRequestInvalid, nil)
}

// Write 先写临时文件再替换，覆盖已有文件由调用方（保存对话框）确认。
func Write(path string, s schema.Score) error {
	data, e := Encode(path, s)
	if e != nil {
		return e
	}
	temp := path + ".part"
	if e = os.WriteFile(temp, data, 0600); e != nil {
		return e
	}
	if e = os.Rename(temp, path); e != nil {
		_ = os.Remove(temp)
	}
	return e
}
