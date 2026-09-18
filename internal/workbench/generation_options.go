package workbench

import (
	_ "embed"
	"encoding/json"
	"math"
	"slices"
	"strings"
)

// 参数定义与界面共享；仅允许已核对的生成选项，禁止透传任意引擎配置。
//
//go:embed generation_options.json
var generationOptionsJSON []byte

type GenerationOption struct {
	Key     string   `json:"key"`
	Type    string   `json:"type"`
	Default any      `json:"default"`
	Min     float64  `json:"min"`
	Max     float64  `json:"max"`
	Step    float64  `json:"step"`
	Values  []string `json:"values"`
}

var GenerationOptions = func() map[string][]GenerationOption {
	var options map[string][]GenerationOption
	if err := json.Unmarshal(generationOptionsJSON, &options); err != nil {
		panic(err)
	}
	return options
}()
var QwenSpeakers = []string{"Vivian", "Serena", "Uncle_Fu", "Dylan", "Eric", "Ryan", "Aiden", "Ono_Anna", "Sohee"}

func (d Draft) generationOptions(family string) (map[string]any, error) {
	out := map[string]any{}
	for key, value := range d.ModelOptions[family] {
		valid := false
		for _, spec := range GenerationOptions[family] {
			if spec.Key != key {
				continue
			}
			switch spec.Type {
			case "number":
				// JSON 解码和 CLI 均以 float64 保存数值。
				number, ok := value.(float64)
				valid = ok && inRange(number, spec.Min, spec.Max) && (spec.Step != 1 || number == math.Trunc(number))
			case "boolean":
				_, valid = value.(bool)
			case "select":
				text, ok := value.(string)
				valid = ok && slices.Contains(spec.Values, text)
			}
			break
		}
		if !valid {
			return nil, Err(MsgErrParamsOutOfRange, nil)
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
			return nil, Err(MsgErrParamsOutOfRange, nil)
		}
	}
	return out, nil
}

//go:embed omni_attributes.json
var omniAttributesJSON []byte
var omniAttributes = func() map[string][][2]string {
	var attributes map[string][][2]string
	if err := json.Unmarshal(omniAttributesJSON, &attributes); err != nil {
		panic(err)
	}
	return attributes
}()

func validateOmniDescription(description string) error {
	used := map[string]bool{}
	for _, item := range strings.FieldsFunc(strings.ToLower(description), func(r rune) bool { return r == ',' || r == '，' }) {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		group := ""
		for category, values := range omniAttributes {
			for _, pair := range values {
				if item == pair[0] || item == pair[1] {
					group = category
				}
			}
		}
		if group == "" || used[group] {
			return Err(MsgErrOmniAttributes, nil)
		}
		used[group] = true
	}
	return nil
}
