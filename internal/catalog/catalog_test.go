package catalog

import (
	"bytes"
	"os"
	"regexp"
	"testing"
)

// Go 嵌入文件与界面副本必须逐字节一致；修改任一侧后复制到另一侧。
func TestSharedDataMatchesWeb(t *testing.T) {
	for core, web := range map[string]string{
		"catalog.json":            "catalog.json",
		"generation_options.json": "generation-options.json",
		"omni_attributes.json":    "omni-attributes.json",
	} {
		a, err := os.ReadFile(repoFile(t, "internal", "catalog", core))
		if err != nil {
			t.Fatal(err)
		}
		b, err := os.ReadFile(repoFile(t, "web", "src", "shared", "lib", web))
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(a, b) {
			t.Errorf("internal/catalog/%s 与 web/src/shared/lib/%s 不一致，请同步两份文件", core, web)
		}
	}
}

// 升级 audio.cpp 时，服务端在线安装与桌面打包脚本必须使用同一版本。
func TestEngineVersionConsistent(t *testing.T) {
	pattern := regexp.MustCompile(`audio-(v\d+\.\d+\.\d+)-|releases/download/(v\d+\.\d+\.\d+)/`)
	for name := range archives {
		if m := pattern.FindStringSubmatch(name); m == nil || m[1] != EngineVersion {
			t.Errorf("运行时包 %s 与 EngineVersion %s 不一致", name, EngineVersion)
		}
	}
	for _, script := range []string{"build-macos.sh", "build-windows.ps1"} {
		b, err := os.ReadFile(repoFile(t, "scripts", "desktop", script))
		if err != nil {
			t.Fatal(err)
		}
		matches := pattern.FindAllStringSubmatch(string(b), -1)
		if len(matches) == 0 {
			t.Errorf("%s 未引用 audio.cpp 版本", script)
		}
		for _, m := range matches {
			if version := m[1] + m[2]; version != EngineVersion {
				t.Errorf("%s 使用 audio.cpp %s，EngineVersion 为 %s", script, version, EngineVersion)
			}
		}
	}
}
