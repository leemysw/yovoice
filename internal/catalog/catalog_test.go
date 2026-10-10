package catalog

import (
	"bytes"
	"os"
	"regexp"
	"strings"
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

// 升级 audio.cpp 时只改 engine.json：在线安装与桌面打包脚本都从清单读取版本和校验值。
func TestEngineVersionConsistent(t *testing.T) {
	if !regexp.MustCompile(`^v\d+\.\d+\.\d+$`).MatchString(EngineVersion) {
		t.Fatalf("EngineVersion %q 格式无效", EngineVersion)
	}
	for name, hash := range archives {
		if !strings.HasPrefix(name, "audio-"+EngineVersion+"-") || !regexp.MustCompile(`^[0-9a-f]{64}$`).MatchString(hash) {
			t.Errorf("运行时包 %s 与 EngineVersion %s 不一致或校验值无效", name, EngineVersion)
		}
	}
	hardcoded := regexp.MustCompile(`audio-v\d+\.\d+\.\d+-|releases/download/v\d+\.\d+\.\d+/|[0-9a-f]{64}`)
	for _, script := range []string{"build-macos.sh", "build-windows.ps1"} {
		b, err := os.ReadFile(repoFile(t, "scripts", "desktop", script))
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Contains(b, []byte("internal/catalog/engine.json")) {
			t.Errorf("%s 未读取运行时清单", script)
		}
		if m := hardcoded.Find(b); m != nil {
			t.Errorf("%s 写死了 audio.cpp 版本或校验值：%s", script, m)
		}
	}
}
