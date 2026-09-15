package workbench

import (
	"os"
	"path/filepath"
	"testing"
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
	if value(s.RuntimePath) != path || value(s.RuntimeBackend) != "cpu" || s.Preferences.Backend != "cpu" {
		t.Fatal("首次启动应使用内置 CPU")
	}
	must(t, w.Store.Update(func(s *State) {
		s.Preferences.Backend = "cuda"
		s.RuntimePath = ptr("downloaded-cuda")
		s.RuntimeBackend = ptr("cuda")
	}, true))
	must(t, w.UseBundledCPU(path))
	if value(w.Store.Read().RuntimePath) != "downloaded-cuda" {
		t.Fatal("启动不应覆盖已选 CUDA")
	}
	p := w.Store.Read().Preferences
	p.Backend = "cpu"
	must(t, w.preferences(p))
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
