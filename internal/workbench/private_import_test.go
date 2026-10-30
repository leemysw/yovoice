package workbench

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"yovoice/internal/schema"
)

// 旧版单独存放的本机接口设置与 AI 密钥在启动时导入状态库，原文件删除；迁移后的新目录也带着它们。
func TestLegacyPrivateFilesImportedAndRelocated(t *testing.T) {
	isolateConfig(t)
	root := t.TempDir()
	token := "0123456789abcdef0123456789abcdef0123456789abcdef"
	must(t, os.WriteFile(filepath.Join(root, "local-api.json"), []byte(`{"enabled":true,"port":9090,"token":"`+token+`"}`), 0600))
	must(t, os.WriteFile(filepath.Join(root, "secrets.json"), []byte(`{"p1":"sk-old"}`), 0600))
	w, err := New(root)
	must(t, err)
	defer w.Close()
	for _, name := range []string{"local-api.json", "secrets.json"} {
		if _, err := os.Stat(filepath.Join(root, name)); !os.IsNotExist(err) {
			t.Fatal("导入后应删除旧文件", name)
		}
	}
	settings, err := w.LocalAPI()
	must(t, err)
	if !settings.Enabled || settings.Port != 9090 || settings.Token != token {
		t.Fatalf("本机接口设置未导入：%+v", settings)
	}
	keys, err := w.readSecrets()
	must(t, err)
	if keys["p1"] != "sk-old" {
		t.Fatal("AI 密钥未导入", keys)
	}

	target := filepath.Join(t.TempDir(), "moved")
	must(t, w.RelocateStorage(context.Background(), target))
	// 迁移后旧目录冻结，私有设置同样拒绝写入，避免修改留在旧目录里丢失。
	if _, err := w.SaveLocalAPI(false, 9091); err == nil {
		t.Fatal("迁移后应拒绝写入本机接口设置")
	}
	moved, err := New(target)
	must(t, err)
	defer moved.Close()
	settings, err = moved.LocalAPI()
	must(t, err)
	if settings.Token != token || settings.Port != 9090 {
		t.Fatalf("迁移后本机接口设置丢失：%+v", settings)
	}
	if keys, _ = moved.readSecrets(); keys["p1"] != "sk-old" {
		t.Fatal("迁移后 AI 密钥丢失")
	}
}

// outputs 目录暂时无法读取时，Reconcile 不能把素材当成缺失永久删除。
func TestReconcileSkipsUnreadableOutputs(t *testing.T) {
	root := t.TempDir()
	w, err := New(root)
	must(t, err)
	defer w.Close()
	d := schema.DefaultDraft()
	d.Timeline = &schema.AudioTimeline{Assets: []schema.AudioAsset{{ID: "a", Name: "素材", FileName: "asset.wav", Duration: 1}}}
	must(t, w.Store.Update(func(s *schema.State) { s.Drafts = append(s.Drafts, d) }, true))
	outputs := filepath.Join(root, "outputs")
	must(t, os.RemoveAll(outputs))
	must(t, os.WriteFile(outputs, nil, 0600))
	report, err := w.Reconcile()
	must(t, err)
	if report.Assets != 0 {
		t.Fatal("目录不可读时不应移除素材", report)
	}
	// 目录恢复后文件确实不存在才修复，并在修复前留下快照。
	must(t, os.Remove(outputs))
	must(t, os.Mkdir(outputs, 0700))
	report, err = w.Reconcile()
	must(t, err)
	if report.Assets != 1 {
		t.Fatal("确实缺失的素材应移除", report)
	}
	if files, _ := filepath.Glob(filepath.Join(root, "yovoice.reconcile-*.db")); len(files) != 1 {
		t.Fatal("修复前应留存快照", files)
	}
}
