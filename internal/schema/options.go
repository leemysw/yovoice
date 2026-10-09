package schema

import (
	_ "embed"
	"math"
	"slices"
	"strings"
	"yovoice/internal/catalog"
	"yovoice/internal/msg"
)

func (d Draft) GenerationOptions(family string) (map[string]any, error) {
	out := map[string]any{}
	for key, value := range d.ModelOptions[family] {
		valid := false
		for _, spec := range catalog.GenerationOptions[family] {
			if spec.Key != key {
				continue
			}
			switch spec.Type {
			case "number":
				// JSON 解码和 CLI 均以 float64 保存数值。
				number, ok := value.(float64)
				valid = ok && InRange(number, spec.Min, spec.Max) && (spec.Step != 1 || number == math.Trunc(number))
			case "boolean":
				_, valid = value.(bool)
			case "select":
				text, ok := value.(string)
				valid = ok && slices.Contains(spec.Values, text)
			}
			break
		}
		if !valid {
			return nil, msg.Err(msg.ErrParamsOutOfRange, nil)
		}
		// 0 表示自动分段或时长，不向引擎传递无效的零值。
		if (key == "text_chunk_size" || key == "duration") && value == float64(0) {
			continue
		}
		out[key] = value
	}
	if family == "voxcpm2" {
		min, max := float64(2), float64(4096)
		if v, ok := out["min_tokens"].(float64); ok {
			min = v
		}
		if v, ok := out["max_tokens"].(float64); ok {
			max = v
		}
		if min > max {
			return nil, msg.Err(msg.ErrParamsOutOfRange, nil)
		}
	}
	return out, nil
}

func validateOmniDescription(description string) error {
	used := map[string]bool{}
	for _, item := range strings.FieldsFunc(strings.ToLower(description), func(r rune) bool { return r == ',' || r == '，' }) {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		group := ""
		for category, values := range catalog.OmniAttributes {
			for _, pair := range values {
				if item == pair[0] || item == pair[1] {
					group = category
				}
			}
		}
		if group == "" || used[group] {
			return msg.Err(msg.ErrOmniAttributes, nil)
		}
		used[group] = true
	}
	return nil
}
