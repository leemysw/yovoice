package workbench

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"yovoice/internal/schema"
)

func TestBundledCPU(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	path := filepath.Join(t.TempDir(), "audiocpp_server.exe")
	must(t, w.UseBundled("cpu", path))
	if w.Store.Read().RuntimePath != nil {
		t.Fatal("缺失内核不应被登记")
	}
	must(t, os.WriteFile(path, []byte("test executable"), 0600))
	must(t, w.UseBundled("cpu", path))
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
	must(t, w.UseBundled("cpu", path))
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
	must(t, w.UseBundled("cpu", moved))
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

// CUDA 安装包同时内置 CUDA 与 CPU 内核：首次启动选中 CUDA，切换后端时复用对应内置内核。
func TestBundledCUDA(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	dir := t.TempDir()
	cuda, cpu := filepath.Join(dir, "cuda.exe"), filepath.Join(dir, "cpu.exe")
	must(t, os.WriteFile(cuda, []byte("cuda"), 0600))
	must(t, os.WriteFile(cpu, []byte("cpu"), 0600))
	must(t, w.UseBundled("cuda", cuda))
	must(t, w.UseBundled("cpu", cpu))
	s := w.Store.Read()
	if s.Preferences.Backend != "cuda" || value(s.RuntimePath) != cuda || !RuntimeReady(s) {
		t.Fatal("首次启动应使用内置 CUDA")
	}
	// CUDA 后端仅在 Windows x64 上可选。
	if runtime.GOOS == "windows" && runtime.GOARCH == "amd64" {
		p := s.Preferences
		p.Backend = "cpu"
		must(t, w.SavePreferences(p))
		if value(w.Store.Read().RuntimePath) != cpu || !RuntimeReady(w.Store.Read()) {
			t.Fatal("切到 CPU 应复用内置 CPU 内核")
		}
		p.Backend = "cuda"
		must(t, w.SavePreferences(p))
		if value(w.Store.Read().RuntimePath) != cuda || !RuntimeReady(w.Store.Read()) {
			t.Fatal("切回 CUDA 应复用内置 CUDA 内核")
		}
	}
	// 之前下载的旧版 CUDA 内核在升级到内置 CUDA 安装包后被替换。
	must(t, w.Store.Update(func(s *schema.State) { s.RuntimePath = ptr("old-cuda"); s.RuntimeVersion = ptr("v0.0.1") }, true))
	must(t, w.UseBundled("cuda", cuda))
	if value(w.Store.Read().RuntimePath) != cuda || !RuntimeReady(w.Store.Read()) {
		t.Fatal("内置 CUDA 应替换旧版下载内核")
	}
}
