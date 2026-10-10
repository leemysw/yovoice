// Package catalog 提供受支持的模型包、推理运行时包、生成参数定义与 OmniVoice 属性。
package catalog

import (
	_ "embed"
	"encoding/json"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"yovoice/internal/msg"
)

const Revision = "6d5436fc85f7a20c2e9f4e472b7f3a532f686444"

type ModelPackage struct {
	Revision string `json:"revision,omitempty"`
	// EngineMinimum 是该模型需要的最低内核版本，为空时只要求应用的最低版本。
	EngineMinimum string   `json:"engineMinimum,omitempty"`
	Voices        []string `json:"voices,omitempty"`
	Variant       string   `json:"variant,omitempty"`
	Task          string   `json:"task,omitempty"`
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	Family        string   `json:"family"`
	Version       string   `json:"version"`
	Precision     string   `json:"precision"`
	RemotePath    string   `json:"remotePath"`
	Size          int64    `json:"size"`
	SHA256        string   `json:"sha256"`
}

//go:embed catalog.json
var catalogJSON []byte
var Models = []ModelPackage{}

// engine.json 是 audio.cpp 版本与运行包校验值的唯一来源，桌面打包脚本也读取它。
//
//go:embed engine.json
var engineJSON []byte

// EngineVersion 是在线安装与打包使用的推荐 audio.cpp 版本；EngineMinimum 是当前应用
// 请求格式与模型包所需的最低版本。内核不低于最低版本即可使用，升级到推荐版本可选。
var EngineVersion, EngineMinimum string
var archives = map[string]string{}

func init() {
	if e := json.Unmarshal(catalogJSON, &Models); e != nil {
		panic(e)
	}
	var engine struct {
		Version  string            `json:"version"`
		Minimum  string            `json:"minimum"`
		Archives map[string]string `json:"archives"`
	}
	if e := json.Unmarshal(engineJSON, &engine); e != nil {
		panic(e)
	}
	EngineVersion, EngineMinimum, archives = engine.Version, engine.Minimum, engine.Archives
	if parseVersion(EngineVersion) == nil || parseVersion(EngineMinimum) == nil || !VersionAtLeast(EngineVersion, EngineMinimum) {
		panic("engine.json 版本无效")
	}
}

// parseVersion 解析 vX.Y.Z，格式无效时返回 nil。
func parseVersion(v string) []int {
	parts := strings.Split(strings.TrimPrefix(v, "v"), ".")
	if len(parts) != 3 || !strings.HasPrefix(v, "v") {
		return nil
	}
	result := make([]int, 3)
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return nil
		}
		result[i] = n
	}
	return result
}

// VersionAtLeast 比较 vX.Y.Z 版本号；任一方无效时返回 false。
func VersionAtLeast(v, minimum string) bool {
	a, b := parseVersion(v), parseVersion(minimum)
	if a == nil || b == nil {
		return false
	}
	return slices.Compare(a, b) >= 0
}

// ServerBackend 把界面后端映射为 audio.cpp 的 backend 参数；两种 CUDA 构建都使用 cuda。
func ServerBackend(backend string) string {
	if backend == "cuda13" {
		return "cuda"
	}
	return backend
}
func Lookup(id string) (ModelPackage, error) {
	for _, m := range Models {
		if m.ID == id {
			return m, nil
		}
	}
	return ModelPackage{}, msg.Err(msg.ErrModelUnsupported, nil)
}
func (m ModelPackage) URL(source string) (string, error) {
	if m.RemotePath == "" {
		return "", msg.Err(msg.ErrModelImportRequired, nil)
	}
	revision := m.Revision
	if revision == "" {
		revision = Revision
	}
	switch source {
	case "huggingface":
		return "https://huggingface.co/audio-cpp/audio.cpp-gguf/resolve/" + revision + "/" + m.RemotePath, nil
	case "mirror":
		return "https://hf-mirror.com/audio-cpp/audio.cpp-gguf/resolve/" + revision + "/" + m.RemotePath, nil
	case "modelscope":
		return "https://modelscope.cn/models/HereIsMark/audio.cpp-gguf/resolve/master/" + m.RemotePath, nil
	}
	return "", msg.Err(msg.ErrDownloadSource, nil)
}

type RuntimeArchive struct{ Name, Hash string }

func RuntimeArchives(backend string) ([]RuntimeArchive, error) {
	var names []string
	if runtime.GOOS == "darwin" {
		if backend != "cpu" && backend != "metal" {
			return nil, msg.Err(msg.ErrMacBackend, nil)
		}
		if runtime.GOARCH != "arm64" {
			return nil, msg.Err(msg.ErrMacAppleSilicon, nil)
		}
		names = []string{"bin-macos-arm64-metal.tar.gz"}
	} else if runtime.GOOS == "windows" && runtime.GOARCH == "amd64" {
		switch backend {
		case "cpu":
			names = []string{"bin-windows-x64-cpu-portable.zip"}
		case "vulkan":
			// 上游新构建倾向 AVX-512，便携包兼容更多 CPU。
			names = []string{"bin-windows-x64-vulkan-portable.zip"}
		case "cuda":
			names = []string{"bin-windows-x64-cuda12.4.zip", "cudart-windows-x64-cuda12.4.zip"}
		case "cuda13":
			// CUDA 13 需要较新的驱动，且不再支持部分旧显卡，与 12.4 并列提供。
			names = []string{"bin-windows-x64-cuda13.3.zip", "cudart-windows-x64-cuda13.3.zip"}
		}
	}
	if runtime.GOOS == "linux" && runtime.GOARCH == "amd64" {
		switch backend {
		case "cpu", "vulkan":
			names = []string{"bin-ubuntu-x64-" + backend + "-portable.tar.gz"}
		}
	}
	if len(names) == 0 {
		return nil, msg.Err(msg.ErrBackendUnsupported, nil)
	}
	result := []RuntimeArchive{}
	for _, n := range names {
		n = "audio-" + EngineVersion + "-" + n
		h, ok := archives[n]
		if !ok {
			return nil, msg.Err(msg.ErrPlatformArch, nil)
		}
		result = append(result, RuntimeArchive{n, h})
	}
	return result, nil
}
