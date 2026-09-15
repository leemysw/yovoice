package workbench

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"runtime"
)

const Revision = "6d5436fc85f7a20c2e9f4e472b7f3a532f686444"
const EngineVersion = "v0.7.4"

type ModelPackage struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Version    string `json:"version"`
	Precision  string `json:"precision"`
	RemotePath string `json:"remotePath"`
	Size       int64  `json:"size"`
	SHA256     string `json:"sha256"`
}

//go:embed catalog.json
var catalogJSON []byte
var Catalog = []ModelPackage{}

func init() {
	if e := json.Unmarshal(catalogJSON, &Catalog); e != nil {
		panic(e)
	}
}
func model(id string) (ModelPackage, error) {
	for _, m := range Catalog {
		if m.ID == id {
			return m, nil
		}
	}
	return ModelPackage{}, fmt.Errorf("不支持的模型。")
}
func (m ModelPackage) URL(source string) (string, error) {
	switch source {
	case "huggingface":
		return "https://huggingface.co/audio-cpp/audio.cpp-gguf/resolve/" + Revision + "/" + m.RemotePath, nil
	case "mirror":
		return "https://hf-mirror.com/audio-cpp/audio.cpp-gguf/resolve/" + Revision + "/" + m.RemotePath, nil
	case "modelscope":
		return "https://modelscope.cn/models/HereIsMark/audio.cpp-gguf/resolve/master/" + m.RemotePath, nil
	}
	return "", fmt.Errorf("请选择有效的下载来源。")
}

type runtimeArchive struct{ Name, Hash string }

var archives = map[string]string{
	"audio-v0.7.4-bin-macos-arm64-metal.tar.gz":     "639926715b1cb537f82aa31656aabbae5d9a85ac36568c402026968f3072e2b3",
	"audio-v0.7.4-bin-windows-x64-cpu-portable.zip": "d241c56ba78fd3c1b28bf289792fb8ec258d36586b4e0c8d667080ec248c0d2f",
	"audio-v0.7.4-bin-windows-x64-vulkan.zip":       "057332f9e3fb37706a8ecb5075ac1797efcd85fdccd739f7b65761a5920f2828",
	"audio-v0.7.4-bin-windows-x64-cuda12.4.zip":     "83fdd5b6e7bd4362604c10cc88d7d3564ef82030dc1d21c693a62cdcbe2e5e38",
	"audio-v0.7.4-cudart-windows-x64-cuda12.4.zip":  "88d8943a2a8011f02c2a4efa7dbbe258608362615cce51e7f0e0e3a0c62f5a43",
}

func runtimeArchives(backend string) ([]runtimeArchive, error) {
	var names []string
	if runtime.GOOS == "darwin" {
		if backend != "cpu" && backend != "metal" {
			return nil, fmt.Errorf("macOS 支持 CPU 或 Metal。")
		}
		if runtime.GOARCH != "arm64" {
			return nil, fmt.Errorf("仅支持 M 系列 Mac（Apple Silicon arm64）。")
		}
		names = []string{"audio-v0.7.4-bin-macos-arm64-metal.tar.gz"}
	} else if runtime.GOOS == "windows" && runtime.GOARCH == "amd64" {
		switch backend {
		case "cpu":
			names = []string{"audio-v0.7.4-bin-windows-x64-cpu-portable.zip"}
		case "vulkan":
			names = []string{"audio-v0.7.4-bin-windows-x64-vulkan.zip"}
		case "cuda":
			names = []string{"audio-v0.7.4-bin-windows-x64-cuda12.4.zip", "audio-v0.7.4-cudart-windows-x64-cuda12.4.zip"}
		}
	}
	if len(names) == 0 {
		return nil, fmt.Errorf("不支持的计算设备或平台。")
	}
	result := []runtimeArchive{}
	for _, n := range names {
		h, ok := archives[n]
		if !ok {
			return nil, fmt.Errorf("不支持的平台架构。")
		}
		result = append(result, runtimeArchive{n, h})
	}
	return result, nil
}
