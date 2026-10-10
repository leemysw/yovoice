// Package catalog 提供受支持的模型包、推理运行时包、生成参数定义与 OmniVoice 属性。
package catalog

import (
	_ "embed"
	"encoding/json"
	"runtime"
	"yovoice/internal/msg"
)

const Revision = "6d5436fc85f7a20c2e9f4e472b7f3a532f686444"

type ModelPackage struct {
	Revision   string   `json:"revision,omitempty"`
	Voices     []string `json:"voices,omitempty"`
	Variant    string   `json:"variant,omitempty"`
	Task       string   `json:"task,omitempty"`
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Family     string   `json:"family"`
	Version    string   `json:"version"`
	Precision  string   `json:"precision"`
	RemotePath string   `json:"remotePath"`
	Size       int64    `json:"size"`
	SHA256     string   `json:"sha256"`
}

//go:embed catalog.json
var catalogJSON []byte
var Models = []ModelPackage{}

// engine.json 是 audio.cpp 版本与运行包校验值的唯一来源，桌面打包脚本也读取它。
//
//go:embed engine.json
var engineJSON []byte

// EngineVersion 是当前应用验证过的 audio.cpp 版本；已安装内核版本不同时需要重新安装。
var EngineVersion string
var archives = map[string]string{}

func init() {
	if e := json.Unmarshal(catalogJSON, &Models); e != nil {
		panic(e)
	}
	var engine struct {
		Version  string            `json:"version"`
		Archives map[string]string `json:"archives"`
	}
	if e := json.Unmarshal(engineJSON, &engine); e != nil {
		panic(e)
	}
	EngineVersion, archives = engine.Version, engine.Archives
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
