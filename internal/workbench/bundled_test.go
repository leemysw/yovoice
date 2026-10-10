package workbench

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"yovoice/internal/catalog"
	"yovoice/internal/schema"
)

// writeBundled 模拟安装包的 engine 目录：可执行文件与打包时写入的版本描述。
func writeBundled(t *testing.T, dir, backend, version string) string {
	t.Helper()
	path := filepath.Join(dir, "audiocpp_server.exe")
	must(t, os.MkdirAll(dir, 0700))
	must(t, os.WriteFile(path, []byte("test executable"), 0600))
	if backend != "" {
		must(t, os.WriteFile(filepath.Join(dir, "yovoice-engine.json"), []byte(`{"version":"`+version+`","backend":"`+backend+`"}`), 0600))
	}
	return path
}

func TestBundledCPU(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	dir := filepath.Join(t.TempDir(), "engine")
	path := filepath.Join(dir, "audiocpp_server.exe")
	must(t, w.UseBundled(path))
	if w.Store.Read().RuntimePath != nil {
		t.Fatal("缺失内核不应被登记")
	}
	writeBundled(t, dir, "cpu", catalog.EngineVersion)
	must(t, w.UseBundled(path))
	s := w.Store.Read()
	if value(s.RuntimePath) != path || value(s.RuntimeBackend) != "cpu" || s.Preferences.Backend != "cpu" || !RuntimeReady(s) {
		t.Fatal("首次启动应使用内置 CPU")
	}
	must(t, w.Store.Update(func(s *schema.State) {
		s.Preferences.Backend = "cuda"
		useRuntime(s, "downloaded-cuda", "cuda", catalog.EngineVersion)
	}, true))
	must(t, w.UseBundled(path))
	if value(w.Store.Read().RuntimePath) != "downloaded-cuda" {
		t.Fatal("启动不应覆盖已选 CUDA")
	}
	p := w.Store.Read().Preferences
	p.Backend = "cpu"
	must(t, w.SavePreferences(p))
	if value(w.Store.Read().RuntimePath) != path || value(w.Store.Read().RuntimeBackend) != "cpu" {
		t.Fatal("切回 CPU 应复用内置内核")
	}
	must(t, os.RemoveAll(dir))
	moved := writeBundled(t, filepath.Join(t.TempDir(), "engine"), "cpu", catalog.EngineVersion)
	must(t, w.UseBundled(moved))
	if value(w.Store.Read().RuntimePath) != moved {
		t.Fatal("移动应用后应刷新 CPU 路径")
	}
}

// 应用只更新本体时内置内核保持原版本：不低于最低版本可继续使用，低于时要求更新；
// 用户在设置中升级到更新的内核后，启动不再退回内置内核。
func TestBundledVersion(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	dir := filepath.Join(t.TempDir(), "engine")
	path := writeBundled(t, dir, "cpu", "v0.0.1")
	must(t, w.UseBundled(path))
	if s := w.Store.Read(); value(s.RuntimeVersion) != "v0.0.1" || RuntimeReady(s) {
		t.Fatal("低于最低版本的内置内核应要求更新")
	}
	writeBundled(t, dir, "", "")
	must(t, os.Remove(filepath.Join(dir, "yovoice-engine.json")))
	must(t, w.UseBundled(path))
	if RuntimeReady(w.Store.Read()) {
		t.Fatal("缺少版本描述的旧内置内核应要求更新")
	}
	writeBundled(t, dir, "cpu", catalog.EngineMinimum)
	must(t, w.UseBundled(path))
	if !RuntimeReady(w.Store.Read()) {
		t.Fatal("达到最低版本的内置内核应可直接使用")
	}
	downloaded := writeBundled(t, filepath.Join(t.TempDir(), "runtime"), "", "")
	must(t, w.Store.Update(func(s *schema.State) { useRuntime(s, downloaded, "cpu", "v999.0.0") }, true))
	must(t, w.UseBundled(path))
	if value(w.Store.Read().RuntimePath) != downloaded {
		t.Fatal("已升级的内核不应被较旧的内置内核替换")
	}
}

// CUDA 安装包只内置一个 CUDA 内核：首次启动选中 CUDA，同一内核也作为 CPU 内核使用。
func TestBundledCUDA(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	path := writeBundled(t, filepath.Join(t.TempDir(), "engine"), "cuda13", catalog.EngineVersion)
	must(t, w.UseBundled(path))
	s := w.Store.Read()
	if s.Preferences.Backend != "cuda13" || value(s.RuntimePath) != path || !RuntimeReady(s) {
		t.Fatal("首次启动应使用内置 CUDA")
	}
	// CUDA 后端仅在 Windows x64 上可选。
	if runtime.GOOS == "windows" && runtime.GOARCH == "amd64" {
		p := s.Preferences
		p.Backend = "cpu"
		must(t, w.SavePreferences(p))
		if s := w.Store.Read(); value(s.RuntimePath) != path || !RuntimeReady(s) {
			t.Fatal("切到 CPU 应复用内置 CUDA 内核")
		}
		p.Backend = "cuda"
		must(t, w.SavePreferences(p))
		if RuntimeReady(w.Store.Read()) {
			t.Fatal("CUDA 13 安装包不应把内核当作 CUDA 12.4 使用")
		}
	}
	// 之前下载的旧版内核在安装内置 CUDA 内核后被替换。
	must(t, w.Store.Update(func(s *schema.State) {
		s.Preferences.Backend = "cuda13"
		useRuntime(s, "old-cuda", "cuda13", "v0.0.1")
	}, true))
	must(t, w.UseBundled(path))
	if value(w.Store.Read().RuntimePath) != path || !RuntimeReady(w.Store.Read()) {
		t.Fatal("内置 CUDA 应替换旧版下载内核")
	}
}

// 应用升级 audio.cpp 后，下载到数据目录的旧版本内核不能继续用于生成。
func TestRuntimeVersionMismatch(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	must(t, w.Store.Update(func(s *schema.State) {
		s.Preferences.Backend = "cuda"
		useRuntime(s, "downloaded-cuda", "cuda", catalog.EngineVersion)
	}, true))
	if !RuntimeReady(w.Store.Read()) {
		t.Fatal("当前版本内核应可用")
	}
	must(t, w.Store.Update(func(s *schema.State) { s.RuntimeVersion = ptr("v0.0.1") }, true))
	if RuntimeReady(w.Store.Read()) {
		t.Fatal("低于最低版本的内核应要求更新")
	}
	must(t, w.Store.Update(func(s *schema.State) { s.RuntimeVersion = nil }, true))
	if RuntimeReady(w.Store.Read()) {
		t.Fatal("未记录版本的内核应要求更新")
	}
}

// 旧版本下载的内核未记录版本，启动时从安装目录名补记，满足最低版本即可继续使用。
func TestLegacyRuntimeVersion(t *testing.T) {
	root := t.TempDir()
	w, err := New(root)
	must(t, err)
	path := writeBundled(t, filepath.Join(root, "runtime", catalog.EngineMinimum+"-cuda-123", "bin"), "", "")
	must(t, w.Store.Update(func(s *schema.State) {
		s.Preferences.Backend = "cuda"
		s.RuntimePath, s.RuntimeBackend, s.RuntimeVersion = ptr(path), ptr("cuda"), nil
	}, true))
	w.Close()
	w, err = New(root)
	must(t, err)
	defer w.Close()
	if s := w.Store.Read(); value(s.RuntimeVersion) != catalog.EngineMinimum || !RuntimeReady(s) {
		t.Fatal("应从安装目录名补记旧内核版本")
	}
}
