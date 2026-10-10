package schema

import (
	"time"
	"yovoice/internal/msg"
)

// AIProvider 是用户配置的大模型服务（可选功能）。密钥不写入状态，单独保存在数据目录的 secrets.json。
type AIProvider struct {
	ID         string   `json:"id"`
	Preset     string   `json:"preset"`
	Name       string   `json:"name"`
	Format     string   `json:"format"`
	BaseURL    string   `json:"baseURL"`
	ModelsPath string   `json:"modelsPath"`
	Model      string   `json:"model"`
	Models     []string `json:"models,omitempty"`
	// KeyMask 只保留密钥首尾，用于界面提示已填写。
	KeyMask  string  `json:"keyMask,omitempty"`
	LastTest *AITest `json:"lastTest,omitempty"`
}

// AITest 记录最近一次连通测试：成功时 Code 为空。
type AITest struct {
	OK     bool       `json:"ok"`
	Code   msg.Code   `json:"code,omitempty"`
	Params msg.Params `json:"params,omitempty"`
	At     time.Time  `json:"at"`
}

const AIProviderLimit = 16
