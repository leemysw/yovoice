package workbench

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// 运行时安装目录由 os.MkdirTemp 以“版本-后端-随机数”命名。
var runtimeDir = regexp.MustCompile(`^v\d+\.\d+\.\d+-[a-z0-9]+-\d+$`)

// 生成后转码与旧版录音导入使用 32 位十六进制 ID 命名的临时 WAV。
var temporaryWav = regexp.MustCompile(`^[0-9a-f]{32}\.wav$`)

// removeStale 回收进程中途退出时遗留的临时文件；只匹配本程序创建的命名，
// 不触碰下载缓存的运行时压缩包与正在使用的运行时。数据目录已由调用方加锁独占。
func (w *Workbench) removeStale() {
	root := w.Store.Root
	remove := func(dir string, match func(os.DirEntry) bool) {
		entries, err := os.ReadDir(dir)
		if err != nil {
			return
		}
		for _, entry := range entries {
			if match(entry) {
				_ = os.RemoveAll(filepath.Join(dir, entry.Name()))
			}
		}
	}
	remove(root, func(e os.DirEntry) bool {
		return (e.IsDir() && strings.HasPrefix(e.Name(), ".project-")) || (!e.IsDir() && strings.HasPrefix(e.Name(), ".state-"))
	})
	remove(filepath.Join(root, "downloads"), func(e os.DirEntry) bool {
		name := e.Name()
		return (e.IsDir() && strings.HasPrefix(name, "audio-")) ||
			(!e.IsDir() && (strings.HasPrefix(name, "upload-") || strings.HasPrefix(name, "api-upload-") || temporaryWav.MatchString(name)))
	})
	w.removeStaleRuntimes()
}

// removeStaleRuntimes 删除当前运行时以外的安装目录。
func (w *Workbench) removeStaleRuntimes() {
	current := ""
	if path := w.Store.Read().RuntimePath; path != nil {
		current = filepath.Clean(*path)
	}
	dir := filepath.Join(w.Store.Root, "runtime")
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		path := filepath.Join(dir, entry.Name())
		if !entry.IsDir() || !runtimeDir.MatchString(entry.Name()) || current == path || strings.HasPrefix(current, path+string(filepath.Separator)) {
			continue
		}
		_ = os.RemoveAll(path)
	}
}
