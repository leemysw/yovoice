package catalog

import (
	"bytes"
	"os"
	"regexp"
	"strings"
	"testing"
)

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
	for _, script := range []string{"build-macos.sh", "build-windows.ps1", "package-windows.ps1"} {
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

func TestVersionAtLeast(t *testing.T) {
	for _, c := range []struct {
		v, minimum string
		want       bool
	}{{"v0.9.1", "v0.9.1", true}, {"v0.10.0", "v0.9.1", true}, {"v1.0.0", "v0.99.99", true}, {"v0.9.0", "v0.9.1", false}, {"", "v0.9.1", false}, {"0.9.1", "v0.9.1", false}, {"v0.9", "v0.9.1", false}} {
		if VersionAtLeast(c.v, c.minimum) != c.want {
			t.Errorf("VersionAtLeast(%q, %q) 应为 %v", c.v, c.minimum, c.want)
		}
	}
	if ServerBackend("cuda13") != "cuda" || ServerBackend("cuda") != "cuda" || ServerBackend("cpu") != "cpu" {
		t.Error("两种 CUDA 构建都应使用 audio.cpp 的 cuda 后端")
	}
}

// 模型要求的内核版本必须能被推荐版本满足，否则用户无法通过更新内核使用该模型。
func TestModelEngineMinimum(t *testing.T) {
	for _, m := range Models {
		if m.EngineMinimum != "" && (parseVersion(m.EngineMinimum) == nil || !VersionAtLeast(EngineVersion, m.EngineMinimum)) {
			t.Errorf("%s 的 engineMinimum %q 无效或高于推荐版本 %s", m.ID, m.EngineMinimum, EngineVersion)
		}
	}
}

// 自有仓库的模型在 ModelScope 有镜像时直接从镜像下载，否则 ModelScope 源改用 hf-mirror。
func TestPackageLocalPath(t *testing.T) {
	m := ModelPackage{StripPrefix: "q8_0"}
	if got := m.LocalPath("q8_0/model.gguf"); got != "model.gguf" {
		t.Fatal(got)
	}
	if got := m.LocalPath("q4_k_m/model.gguf"); got != "q4_k_m/model.gguf" {
		t.Fatal(got)
	}
}

func TestRepoFileURL(t *testing.T) {
	m := ModelPackage{Repo: "owner/repo", Revision: "abc", RemotePath: "m.gguf"}
	if url, _ := m.URL("modelscope"); url != "https://hf-mirror.com/owner/repo/resolve/abc/m.gguf" {
		t.Fatal(url)
	}
	m.ModelScope = "owner/ms-repo"
	for source, want := range map[string]string{
		"modelscope":  "https://modelscope.cn/models/owner/ms-repo/resolve/master/m.gguf",
		"huggingface": "https://huggingface.co/owner/repo/resolve/abc/m.gguf",
		"mirror":      "https://hf-mirror.com/owner/repo/resolve/abc/m.gguf",
	} {
		if url, _ := m.URL(source); url != want {
			t.Fatal(source, url)
		}
	}
}
