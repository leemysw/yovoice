package workbench

import (
	"os"
	"path/filepath"
	"testing"
	"yovoice/internal/schema"
)

func TestBundledCPU(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	path := filepath.Join(t.TempDir(), "audiocpp_server.exe")
	must(t, w.UseBundledCPU(path))
	if w.Store.Read().RuntimePath != nil {
		t.Fatal("缺失内核不应被登记")
	}
	must(t, os.WriteFile(path, []byte("test executable"), 0600))
	must(t, w.UseBundledCPU(path))
	s := w.Store.Read()
	if value(s.RuntimePath) != path || value(s.RuntimeBackend) != "cpu" || s.Preferences.Backend != "cpu" || !RuntimeReady(s) {
		t.Fatal("首次启动应使用内置 CPU")
	}
	must(t, w.Store.Update(func(s *schema.State) {
		s.Preferences.Backend = "cuda"
		s.RuntimePath = ptr("downloaded-cuda")
		s.RuntimeBackend = ptr("cuda")
		s.RuntimeVersion = nil
	}, true))
	must(t, w.UseBundledCPU(path))
	if value(w.Store.Read().RuntimePath) != "downloaded-cuda" {
		t.Fatal("启动不应覆盖已选 CUDA")
	}
	if RuntimeReady(w.Store.Read()) {
		t.Fatal("未记录版本的旧 GPU 内核应要求更新")
	}
	p := w.Store.Read().Preferences
	p.Backend = "cpu"
	must(t, w.SavePreferences(p))
	if value(w.Store.Read().RuntimePath) != path || value(w.Store.Read().RuntimeBackend) != "cpu" {
		t.Fatal("切回 CPU 应复用内置内核")
	}
	moved := filepath.Join(t.TempDir(), "audiocpp_server.exe")
	must(t, os.Rename(path, moved))
	must(t, w.UseBundledCPU(moved))
	if value(w.Store.Read().RuntimePath) != moved {
		t.Fatal("移动应用后应刷新 CPU 路径")
	}
}

// 应用升级 audio.cpp 后，下载到数据目录的旧版本内核不能继续用于生成。
func TestRuntimeVersionMismatch(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	must(t, w.Store.Update(func(s *schema.State) {
		s.Preferences.Backend = "cuda"
		useRuntime(s, "downloaded-cuda", "cuda")
	}, true))
	if !RuntimeReady(w.Store.Read()) {
		t.Fatal("当前版本内核应可用")
	}
	must(t, w.Store.Update(func(s *schema.State) { s.RuntimeVersion = ptr("v0.0.1") }, true))
	if RuntimeReady(w.Store.Read()) {
		t.Fatal("旧版本内核应要求更新")
	}
}
