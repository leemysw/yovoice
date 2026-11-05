package engine

import (
	"os"
	"path/filepath"
	"testing"
	"yovoice/internal/catalog"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
)

// 作品选的 LoRA 换成 YuE2 的会话参数；文件被删时报适配器缺失，其他模型不受影响。
func TestWithAdapters(t *testing.T) {
	root := t.TempDir()
	id := schema.NewID()
	if err := os.MkdirAll(AdapterDir(root), 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(AdapterDir(root), id+".safetensors")
	if err := os.WriteFile(path, []byte("x"), 0600); err != nil {
		t.Fatal(err)
	}
	base := catalog.ModelPackage{Family: "yue2", SessionOptions: map[string]string{"yue2.keep": "1"}}
	d := schema.Draft{SynthesisSettings: schema.SynthesisSettings{ModelOptions: map[string]map[string]any{"yue2": {"nar_lora": id, "nar_lora_scale": 0.5, "ar_lora": ""}}}}
	got, err := withAdapters(root, d, base)
	if err != nil {
		t.Fatal(err)
	}
	if got.SessionOptions["yue2.nar_lora"] != path || got.SessionOptions["yue2.nar_lora_scale"] != "0.5" || got.SessionOptions["yue2.keep"] != "1" {
		t.Fatalf("会话参数不对：%v", got.SessionOptions)
	}
	if _, ok := got.SessionOptions["yue2.ar_lora"]; ok || len(base.SessionOptions) != 1 {
		t.Fatalf("未选的部分不应传，原定义不应被改：%v %v", got.SessionOptions, base.SessionOptions)
	}
	other, err := withAdapters(root, d, catalog.ModelPackage{Family: "ace_step"})
	if err != nil || other.SessionOptions != nil {
		t.Fatalf("非 YuE2 模型不应带 LoRA：%v %v", other.SessionOptions, err)
	}
	if err = os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if _, err = withAdapters(root, d, base); err == nil || err.(*msg.CallError).Code != msg.ErrAdapterMissing {
		t.Fatalf("文件被删时应报适配器缺失：%v", err)
	}
}
