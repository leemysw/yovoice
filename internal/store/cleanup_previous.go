package store

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"yovoice/internal/platform"
)

// WebCacheDir 是 Windows 宿主的 WebView2 用户数据目录，完全可再生；宿主运行期间其中文件始终被占用。
const WebCacheDir = "web-cache"

// dataEntries 是数据目录中由应用创建的条目；清理旧目录时只删除这些，其余内容（用户自行放入的文件）原样保留。
var dataEntries = []string{"voices", "outputs", "downloads", "runtime", "models", "logs", "service.lock", hostPreferences, backupFile, legacyBackup, legacyMigrated, "local-api.json", "secrets.json", WebCacheDir}

// dataEntry 判断名称是否为应用创建的条目，包括损坏快照与修复快照。
func dataEntry(name string) bool {
	if slices.Contains(dataEntries, name) {
		return true
	}
	for _, pattern := range []string{"state.corrupt-*.json", "yovoice.*.db", "yovoice.*.db-journal", ".yovoice-*", ".tmp-*"} {
		if ok, _ := filepath.Match(pattern, name); ok {
			return true
		}
	}
	return false
}

// CleanupPrevious 在新数据目录成功启动后清理迁移前的旧目录，返回已清理的目录。
// 只有配置确认当前目录就是迁移目标、旧目录确实是数据目录且没有其他进程占用时才清理；
// 宿主未切换到新目录（例如旧版宿主）时保持旧目录不动，绝不删除正在使用的数据。
// 清理只删除应用创建的条目，状态文件最后删除；目录里还有其他内容时保留目录本身。
func CleanupPrevious(root string) (removed []string, err error) {
	cfg, err := ReadConfig()
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	if len(cfg.PreviousPaths) == 0 || cfg.DataPath == "" || !SamePath(cfg.DataPath, root) {
		return nil, nil
	}
	var pending []string
	var errs []error
	for _, previous := range cfg.PreviousPaths {
		done, e := cleanupPrevious(root, previous)
		if e != nil {
			errs = append(errs, fmt.Errorf("%s: %w", previous, e))
		}
		if done {
			removed = append(removed, previous)
		} else {
			pending = append(pending, previous)
		}
	}
	if len(pending) != len(cfg.PreviousPaths) {
		cfg.PreviousPaths = pending
		if e := WriteConfig(cfg); e != nil {
			errs = append(errs, e)
		}
	}
	return removed, errors.Join(errs...)
}

// cleanupPrevious 清理单个旧目录；done 为真表示无需再保留在待清理列表中。
func cleanupPrevious(root, previous string) (done bool, err error) {
	if previous == "" || Within(previous, root) || Within(root, previous) {
		return true, nil
	}
	if _, e := os.Stat(previous); os.IsNotExist(e) {
		return true, nil
	}
	if !HasData(previous) {
		// 不是可识别的数据目录，不冒险删除。
		return true, nil
	}
	lock, e := platform.Lock(filepath.Join(previous, "service.lock"))
	if e != nil {
		// 旧目录仍被其他进程使用，下次启动再试。
		return false, e
	}
	lock.Close()
	entries, e := os.ReadDir(previous)
	if e != nil {
		return false, e
	}
	for _, entry := range entries {
		if name := entry.Name(); name != DatabaseFile && name != legacyState && dataEntry(name) {
			if e = os.RemoveAll(filepath.Join(previous, name)); e != nil {
				return false, e
			}
		}
	}
	// 状态文件最后删除：中途退出时下次启动仍能识别这是旧数据目录并继续清理。
	for _, name := range []string{DatabaseFile + "-journal", DatabaseFile, legacyState} {
		if e = os.Remove(filepath.Join(previous, name)); e != nil && !os.IsNotExist(e) {
			return false, e
		}
	}
	// 只在目录已空时删除目录本身，用户放入的其他文件保留。
	if e = os.Remove(previous); e != nil {
		if rest, _ := os.ReadDir(previous); len(rest) > 0 {
			return true, nil
		}
		return false, e
	}
	return true, nil
}
