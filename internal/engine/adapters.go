package engine

import (
	"os"
	"path/filepath"
	"strconv"
	"yovoice/internal/catalog"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
)

// AdapterDir 是导入的 LoRA 适配器所在目录：每个适配器存成 <ID>.safetensors，名称等信息在同名 .json 里。
func AdapterDir(root string) string { return filepath.Join(root, "adapters") }

// AdapterParts 是 YuE2 可挂 LoRA 的两半：ar 写谱与演唱（作曲），nar 声学解码（音色）。
var AdapterParts = []string{"ar", "nar"}

// adapterKeys 是 YuE2 生成参数里的 LoRA 选项：在启动内核时作为会话参数传入，不放进请求。
var adapterKeys = []string{"ar_lora", "ar_lora_scale", "nar_lora", "nar_lora_scale"}

// withAdapters 把作品选的 LoRA 换成会话参数 yue2.<ar|nar>_lora 与强度；换了 LoRA 或强度时内核按新参数重启。
func withAdapters(root string, d schema.Draft, definition catalog.ModelPackage) (catalog.ModelPackage, error) {
	if definition.Family != "yue2" {
		return definition, nil
	}
	options := d.ModelOptions["yue2"]
	var session map[string]string
	for _, part := range AdapterParts {
		id, _ := options[part+"_lora"].(string)
		if id == "" {
			continue
		}
		if !schema.ValidID(id) {
			return definition, msg.Err(msg.ErrParamsOutOfRange, nil)
		}
		path := filepath.Join(AdapterDir(root), id+".safetensors")
		if _, err := os.Stat(path); err != nil {
			return definition, msg.Err(msg.ErrAdapterMissing, nil)
		}
		if session == nil {
			session = make(map[string]string, len(definition.SessionOptions)+4)
			for key, value := range definition.SessionOptions {
				session[key] = value
			}
		}
		scale := 1.0
		if value, ok := options[part+"_lora_scale"].(float64); ok {
			scale = value
		}
		session["yue2."+part+"_lora"] = path
		session["yue2."+part+"_lora_scale"] = strconv.FormatFloat(scale, 'g', -1, 64)
	}
	if session != nil {
		definition.SessionOptions = session
	}
	return definition, nil
}
