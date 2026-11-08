package schema

import (
	"encoding/json"
	"math"
	"path/filepath"
	"slices"
	"strings"
	"yovoice/internal/catalog"
	"yovoice/internal/msg"
)

// ValidateRuntime 检查作品的运行方式：编曲不经过语音引擎，不能设置。
func (d Draft) ValidateRuntime() error {
	if d.Runtime != nil && d.Kind == "score" {
		return msg.Err(msg.ErrParamsOutOfRange, nil)
	}
	return nil
}

// Validate 检查引擎运行参数的范围；会话参数只接受目录中登记过的键与类型。
func (r EngineSettings) Validate() error {
	invalid := func() error { return msg.Err(msg.ErrParamsOutOfRange, nil) }
	if r.Threads < 0 || r.Threads > 256 || r.Device < 0 || r.Device > 255 || (r.IdleUnloadSeconds != nil && (*r.IdleUnloadSeconds < 0 || *r.IdleUnloadSeconds > 86400)) || len(r.Session) > 256 {
		return invalid()
	}
	// 各模型族的会话参数并存，生成时只取当前模型族的那部分。
	for key, value := range r.Session {
		family, _, _ := strings.Cut(key, ".")
		valid := false
		for _, spec := range catalog.RuntimeOptions[family] {
			if key != spec.Key {
				continue
			}
			switch spec.Type {
			case "number":
				number, ok := value.(float64)
				valid = ok && InRange(number, spec.Min, spec.Max) && (spec.Step != 1 || number == math.Trunc(number))
			case "select":
				text, ok := value.(string)
				valid = ok && slices.Contains(spec.Values, text)
			case "boolean":
				_, valid = value.(bool)
			case "path":
				text, ok := value.(string)
				valid = ok && len(text) <= 4096 && filepath.IsAbs(strings.TrimSpace(text))
			case "json":
				text, ok := value.(string)
				valid = ok && len(text) <= 10000 && json.Valid([]byte(text)) && strings.HasPrefix(strings.TrimSpace(text), "{")
			}
			break
		}
		if !valid {
			return invalid()
		}
	}
	return nil
}
