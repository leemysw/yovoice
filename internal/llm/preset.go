// Package llm 是可选的大模型服务接入：内置常见服务的预设，统一三种接口协议的调用、模型列表与连通测试。
// 只做单次非流式调用，不保存状态；配置与密钥由 workbench 管理。
package llm

import (
	_ "embed"
	"encoding/json"
)

// 接口协议。
const (
	FormatChat      = "chat_completions"
	FormatResponses = "responses"
	FormatAnthropic = "anthropic_messages"
)

var Formats = []string{FormatChat, FormatResponses, FormatAnthropic}

// Preset 描述一个服务商：固定地址的服务只需填写密钥；本地与自定义服务可改地址，自定义服务还可改协议与模型列表路径。
type Preset struct {
	Key        string `json:"key"`
	Name       string `json:"name"`
	Format     string `json:"format"`
	BaseURL    string `json:"baseURL"`
	ModelsPath string `json:"modelsPath"`
	KeyURL     string `json:"keyURL,omitempty"`
	// Endpoint 为 fixed（地址固定）、local（本地服务，可改地址、无需密钥）或 custom（全部可改）。
	Endpoint string `json:"endpoint"`
}

// Presets 参考 nexus 的服务商目录，去掉编程套餐与图像生成，补充本地服务。界面持有同一份 JSON 副本。
//
//go:embed presets.json
var presetsJSON []byte

var Presets = func() []Preset {
	var p []Preset
	if e := json.Unmarshal(presetsJSON, &p); e != nil {
		panic(e)
	}
	return p
}()

// LookupPreset 返回预设；未知键返回 false。
func LookupPreset(key string) (Preset, bool) {
	for _, p := range Presets {
		if p.Key == key {
			return p, true
		}
	}
	return Preset{}, false
}
