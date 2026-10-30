package catalog

import (
	"bytes"
	"os"
	"regexp"
	"testing"
)

// ocho 清单的资产名必须由版本号拼出，摘要是 64 位十六进制（发布前为 64 个 0 的占位值）。
func TestOchoArchives(t *testing.T) {
	if !regexp.MustCompile(`^v\d+\.\d+\.\d+$`).MatchString(OchoVersion) {
		t.Fatalf("OchoVersion %q 格式无效", OchoVersion)
	}
	digest := regexp.MustCompile(`^[0-9a-f]{64}$`)
	for _, suffix := range []string{"darwin-arm64.tar.gz", "windows-amd64.zip", "linux-amd64.tar.gz"} {
		name := "ocho-" + OchoVersion + "-" + suffix
		hash, ok := ochoArchives[name]
		if !ok {
			t.Errorf("清单缺少 %s", name)
			continue
		}
		if !digest.MatchString(hash) {
			t.Errorf("%s 的摘要 %q 无效", name, hash)
		}
	}
}

// 升级 ocho 时只改 ocho.json：打包脚本必须读取清单，不得写死版本或摘要。
func TestOchoVersionConsistent(t *testing.T) {
	hardcoded := regexp.MustCompile(`ocho-v\d+\.\d+\.\d+-|releases/download/v\d+\.\d+\.\d+/|[0-9a-f]{64}`)
	script, err := os.ReadFile(repoFile(t, "scripts", "package-ocho.py"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(script, []byte("internal/catalog/ocho.json")) {
		t.Error("package-ocho.py 未读取 ocho 清单")
	}
	if m := hardcoded.Find(script); m != nil {
		t.Errorf("package-ocho.py 写死了 ocho 版本或校验值：%s", m)
	}
}
