package store

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"yovoice/internal/msg"
)

// WebCacheDir 是 Windows 宿主的 WebView2 用户数据目录，完全可再生；宿主运行期间其中文件始终被占用。
const WebCacheDir = "web-cache"

// SamePath 判断两个路径是否指向同一位置；Windows 与 macOS 默认文件系统不区分大小写。
func SamePath(a, b string) bool {
	a, b = filepath.Clean(a), filepath.Clean(b)
	if runtime.GOOS == "windows" || runtime.GOOS == "darwin" {
		return strings.EqualFold(a, b)
	}
	return a == b
}

// Within 判断 child 是否位于 parent 内部（含相同路径）。
func Within(parent, child string) bool {
	parent, child = filepath.Clean(parent), filepath.Clean(child)
	if SamePath(parent, child) {
		return true
	}
	if runtime.GOOS == "windows" || runtime.GOOS == "darwin" {
		parent, child = strings.ToLower(parent), strings.ToLower(child)
	}
	rel, err := filepath.Rel(parent, child)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel)
}

func (s *Store) MediaPath(kind, name string) (string, error) {
	if (kind != "voices" && kind != "outputs") || name == "" || name == "." || name == ".." || strings.ContainsAny(name, "/\\:\x00") {
		return "", msg.Err(msg.ErrAudioPathInvalid, nil)
	}
	path := filepath.Join(s.Root, kind, name)
	if info, e := os.Lstat(path); e == nil && info.Mode()&os.ModeSymlink != 0 {
		return "", msg.Err(msg.ErrAudioPathSymlink, nil)
	}
	return path, nil
}
