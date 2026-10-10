package workbench

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"yovoice/internal/schema"
)

// 启动时回收中途退出遗留的临时文件与不再使用的运行时，保留缓存、当前运行时与其他后端最新的内核。
func TestRemoveStaleFiles(t *testing.T) {
	root := t.TempDir()
	w, err := New(root)
	must(t, err)
	current := filepath.Join(root, "runtime", "v0.7.4-cuda-222", "bin", "audiocpp_server")
	must(t, os.MkdirAll(filepath.Dir(current), 0700))
	must(t, os.WriteFile(current, nil, 0700))
	must(t, w.Store.Update(func(s *schema.State) { s.RuntimePath = &current }, true))
	w.Close()
	// 键为遗留文件，值为应被整体删除的目标。
	stale := map[string]string{
		".project-1/outputs/a.wav":                       ".project-1",
		".state-1":                                       ".state-1",
		"downloads/upload-1":                             "downloads/upload-1",
		"downloads/api-upload-1":                         "downloads/api-upload-1",
		"downloads/audio-1/reference.wav":                "downloads/audio-1",
		"downloads/0123456789abcdef0123456789abcdef.wav": "downloads/0123456789abcdef0123456789abcdef.wav",
		"runtime/v0.7.3-cuda-111/audiocpp_server":        "runtime/v0.7.3-cuda-111",
	}
	kept := []string{
		"downloads/audio-v0.7.4-bin-windows-x64-cuda12.4.zip",
		"downloads/audio-v0.7.4-bin-windows-x64-cuda12.4.zip.part",
		"runtime/server.json",
		"runtime/v0.7.4-vulkan-333/" + executableName(),
		"voices/keep.wav",
		"outputs/keep.wav",
	}
	files := append([]string{}, kept...)
	for file := range stale {
		files = append(files, file)
	}
	for _, name := range files {
		path := filepath.Join(root, filepath.FromSlash(name))
		must(t, os.MkdirAll(filepath.Dir(path), 0700))
		must(t, os.WriteFile(path, []byte("x"), 0600))
	}
	w, err = New(root)
	must(t, err)
	defer w.Close()
	for _, target := range stale {
		if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(target))); !os.IsNotExist(err) {
			t.Error("应清理", target)
		}
	}
	for _, name := range append(kept, "runtime/v0.7.4-cuda-222/bin/audiocpp_server") {
		if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(name))); err != nil {
			t.Error("应保留", name, err)
		}
	}
	if r := w.Store.Read().Runtimes["vulkan"]; r.Path != filepath.Join(root, "runtime", "v0.7.4-vulkan-333", executableName()) || r.Version != "v0.7.4" {
		t.Error("应登记未记录的 Vulkan 内核", r)
	}
}

func executableName() string {
	if runtime.GOOS == "windows" {
		return "audiocpp_server.exe"
	}
	return "audiocpp_server"
}
