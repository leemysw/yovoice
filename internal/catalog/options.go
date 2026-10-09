package catalog

import (
	_ "embed"
	"encoding/json"
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

//go:embed omni_attributes.json
var omniAttributesJSON []byte
var OmniAttributes = func() map[string][][2]string {
	var attributes map[string][][2]string
	if err := json.Unmarshal(omniAttributesJSON, &attributes); err != nil {
		panic(err)
	}
	return attributes
}()
