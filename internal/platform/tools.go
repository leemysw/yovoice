// Package platform 封装文件锁、子进程控制、磁盘空间与随包工具定位等平台差异。
package platform

import (
	"errors"
	"os"
	"path/filepath"
)

// ErrToolMissing 表示安装包中缺少随附工具，调用方转换为各自的用户错误。
var ErrToolMissing = errors.New("packaged tool missing")

// PackagedTool 查找随安装包分发的工具，不依赖系统 PATH。
func PackagedTool(name string) (string, error) {
	executable, err := os.Executable()
	if err != nil {
		return "", err
	}
	executable, err = filepath.EvalSymlinks(executable)
	if err != nil {
		return "", err
	}
	directory := filepath.Dir(executable)
	// CLI 的 tools 与可执行文件同级；桌面服务位于 service 子目录。
	bases := []string{directory}
	if filepath.Base(directory) == "service" {
		bases = append(bases, filepath.Dir(directory))
	}
	for _, base := range bases {
		path := filepath.Join(base, "tools", name)
		if info, err := os.Stat(path); err == nil && info.Mode().IsRegular() {
			return path, nil
		}
	}
	return "", ErrToolMissing
}
