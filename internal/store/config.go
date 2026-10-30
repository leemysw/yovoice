package store

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"yovoice/internal/platform"
)

func DefaultDirectory() (string, error) {
	home, e := os.UserHomeDir()
	return filepath.Join(home, ".yovoice"), e
}

// StorageConfig 存储全局重定向配置。
// PreviousPaths 记录迁移前的旧目录：新目录成功启动后由 CleanupPrevious 清理，释放原磁盘空间；
// 清理失败的旧目录保留在列表中下次重试，再次迁移时追加而不是覆盖，旧目录不会变成无人管理的孤儿。
type StorageConfig struct {
	DataPath      string   `json:"dataPath"`
	PreviousPaths []string `json:"previousPaths,omitempty"`
	// PreviousPath 是旧版只记一个旧目录的字段，读取时并入 PreviousPaths，写入时不再使用。
	PreviousPath string `json:"previousPath,omitempty"`
}

// ConfigFile 返回平台全局存储配置文件的路径，需与 Windows / macOS 宿主读取的位置保持一致。
func ConfigFile() (string, error) {
	var base string
	if runtime.GOOS == "windows" {
		base = os.Getenv("APPDATA")
		if base == "" {
			home, err := os.UserHomeDir()
			if err != nil {
				return "", err
			}
			base = filepath.Join(home, "AppData", "Roaming")
		}
	} else if runtime.GOOS == "darwin" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		base = filepath.Join(home, "Library", "Application Support")
	} else {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		base = filepath.Join(home, ".config")
	}
	return filepath.Join(base, "yovoice", "storage.json"), nil
}

// ReadConfig 读取已保存的数据目录重定向配置。
func ReadConfig() (StorageConfig, error) {
	var cfg StorageConfig
	cfgPath, err := ConfigFile()
	if err != nil {
		return cfg, err
	}
	b, err := os.ReadFile(cfgPath)
	if err != nil {
		return cfg, err
	}
	if err = json.Unmarshal(b, &cfg); err != nil {
		return cfg, fmt.Errorf("存储配置 %s 已损坏：%w", cfgPath, err)
	}
	if cfg.PreviousPath != "" {
		if !slices.ContainsFunc(cfg.PreviousPaths, func(p string) bool { return SamePath(p, cfg.PreviousPath) }) {
			cfg.PreviousPaths = append(cfg.PreviousPaths, cfg.PreviousPath)
		}
		cfg.PreviousPath = ""
	}
	return cfg, nil
}

// RecordRelocation 把数据目录切换到 target，并把 from 追加到待清理的旧目录列表；保留配置中的其他内容。
func RecordRelocation(from, target string) error {
	cfg, err := ReadConfig()
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	cfg.DataPath = target
	cfg.PreviousPaths = slices.DeleteFunc(cfg.PreviousPaths, func(p string) bool { return SamePath(p, target) || SamePath(p, from) })
	cfg.PreviousPaths = append(cfg.PreviousPaths, from)
	return WriteConfig(cfg)
}

// WriteConfig 原子保存数据目录重定向配置，避免写到一半时宿主读到损坏的配置。
func WriteConfig(cfg StorageConfig) error {
	cfgPath, err := ConfigFile()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(cfgPath), 0700); err != nil {
		return err
	}
	b, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return platform.WriteFileAtomic(cfgPath, b, 0600)
}
