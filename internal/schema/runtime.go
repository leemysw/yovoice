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

func (d Draft) ValidateRuntime() error {
	if d.Runtime == nil {
		return nil
	}
	r := d.Runtime
	invalid := func() error { return msg.Err(msg.ErrParamsOutOfRange, nil) }
	if d.Kind == "score" || r.Threads < 0 || r.Threads > 256 || r.Device < 0 || r.Device > 255 || (r.IdleUnloadSeconds != nil && (*r.IdleUnloadSeconds < 0 || *r.IdleUnloadSeconds > 86400)) || len(r.Session) > 64 {
		return invalid()
	}
	// 保留其他模型的会话设置；切回该模型时再应用，不会透传给当前模型。
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
