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

// 包内写明来源仓库的文件从该仓库下载，其余文件仍来自 audio.cpp 的模型仓库与 ModelScope 镜像。
func TestPackageFileURL(t *testing.T) {
	m, err := Lookup("confucius4-r2t2-q8")
	if err != nil {
		t.Fatal(err)
	}
	main, _ := m.URL("modelscope")
	aligner, _ := m.PackageFileURL("modelscope", m.Files[len(m.Files)-1])
	if main != "https://hf-mirror.com/davidxifeng/Confucius4-R2T2-gguf/resolve/a8e6b385d7df7eae9519363e07034a209004797a/r2t2-q8_0.gguf" ||
		aligner != "https://modelscope.cn/models/HereIsMark/audio.cpp-gguf/resolve/"+ModelScopeRevision+"/Qwen3-ForcedAligner-0.6B-GGUF/qwen3-forced-aligner-0.6b-q8_0.gguf" {
		t.Fatal(main, aligner)
	}
}

// 旧版本按当时的提交下载：三个下载源都指向那次提交，文件大小与摘要取旧值，未知版本报错。
func TestModelVersionAt(t *testing.T) {
	m, err := Lookup("kokoro-82m-q8")
	if err != nil || len(m.History) == 0 {
		t.Fatal(err, m.History)
	}
	latest, _ := m.At("")
	if same, _ := m.At(m.SHA256); latest.SHA256 != m.SHA256 || same.SHA256 != m.SHA256 {
		t.Fatal("最新版应保持不变")
	}
	v := m.History[0]
	old, err := m.At(v.SHA256)
	if err != nil || old.Size != v.Size || old.MainFile().SHA256 != v.SHA256 || len(old.History) != 0 {
		t.Fatal(err, old)
	}
	for source, want := range map[string]string{
		"huggingface": "https://huggingface.co/audio-cpp/audio.cpp-gguf/resolve/" + v.Revision + "/" + m.RemotePath,
		"mirror":      "https://hf-mirror.com/audio-cpp/audio.cpp-gguf/resolve/" + v.Revision + "/" + m.RemotePath,
		"modelscope":  "https://modelscope.cn/models/HereIsMark/audio.cpp-gguf/resolve/" + v.ModelScopeRevision + "/" + m.RemotePath,
	} {
		if url, _ := old.URL(source); url != want {
			t.Fatal(source, url)
		}
	}
	if url, _ := m.URL("modelscope"); !strings.Contains(url, ModelScopeRevision) {
		t.Fatal("最新版仍用当前 ModelScope 提交", url)
	}
	if _, err := m.At(strings.Repeat("0", 64)); err == nil {
		t.Fatal("未知版本应报错")
	}
}

// 目录里的旧版本必须可下载：固定完整提交号，主文件摘要与最新版不同，多文件包列全文件且包含主文件。
func TestModelHistoryComplete(t *testing.T) {
	commit := regexp.MustCompile(`^[0-9a-f]{40}$`)
	digest := regexp.MustCompile(`^[0-9a-f]{64}$`)
	for _, m := range Models {
		for _, v := range m.History {
			old, err := m.At(v.SHA256)
			if v.SHA256 == "" && len(v.Files) > 0 {
				old, err = m.At(ModelPackage{RemotePath: m.RemotePath, Files: v.Files}.MainFile().SHA256)
			}
			if err != nil || !commit.MatchString(v.Revision) || !commit.MatchString(v.ModelScopeRevision) || v.Size <= 0 || v.Replaced == "" {
				t.Fatal(m.ID, err, v)
			}
			if old.MainFile().SHA256 == m.MainFile().SHA256 || !digest.MatchString(old.MainFile().SHA256) {
				t.Fatal(m.ID, "旧版本主文件与最新版相同或缺少摘要")
			}
			if (len(v.Files) > 0) != (len(m.Files) > 0) {
				t.Fatal(m.ID, "旧版本与最新版的文件结构不同")
			}
			if legacy, ok := LegacyModelFiles[m.ID]; ok && legacy.SHA256 != old.MainFile().SHA256 {
				t.Fatal(m.ID, "旧版本应与冻结表一致")
			}
		}
	}
}
