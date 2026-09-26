package workbench

import (
	_ "embed"
	"encoding/json"
	"runtime"
)

const Revision = "6d5436fc85f7a20c2e9f4e472b7f3a532f686444"
const EngineVersion = "v0.7.4"

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
	return ModelPackage{}, Err(MsgErrModelUnsupported, nil)
}
func (m ModelPackage) URL(source string) (string, error) {
	if m.RemotePath == "" {
		return "", Err(MsgErrModelImportRequired, nil)
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
	return "", Err(MsgErrDownloadSource, nil)
}

type runtimeArchive struct{ Name, Hash string }

var archives = map[string]string{
	"audio-v0.7.4-bin-ubuntu-x64-cpu-portable.tar.gz":    "8a93751b832c533e3261e760b4fd24af2397af3a193c862315653afd0dccc6ad",
	"audio-v0.7.4-bin-ubuntu-x64-vulkan-portable.tar.gz": "34a46387c4151bf8bd0bbbaac46fc6de57df539a177ab23d52ecd5aa940173b1",
	"audio-v0.7.4-bin-macos-arm64-metal.tar.gz":          "639926715b1cb537f82aa31656aabbae5d9a85ac36568c402026968f3072e2b3",
	"audio-v0.7.4-bin-windows-x64-cpu-portable.zip":      "d241c56ba78fd3c1b28bf289792fb8ec258d36586b4e0c8d667080ec248c0d2f",
	"audio-v0.7.4-bin-windows-x64-vulkan.zip":            "057332f9e3fb37706a8ecb5075ac1797efcd85fdccd739f7b65761a5920f2828",
	"audio-v0.7.4-bin-windows-x64-cuda12.4.zip":          "83fdd5b6e7bd4362604c10cc88d7d3564ef82030dc1d21c693a62cdcbe2e5e38",
	"audio-v0.7.4-cudart-windows-x64-cuda12.4.zip":       "88d8943a2a8011f02c2a4efa7dbbe258608362615cce51e7f0e0e3a0c62f5a43",
}

func runtimeArchives(backend string) ([]runtimeArchive, error) {
	var names []string
	if runtime.GOOS == "darwin" {
		if backend != "cpu" && backend != "metal" {
			return nil, Err(MsgErrMacBackend, nil)
		}
		if runtime.GOARCH != "arm64" {
			return nil, Err(MsgErrMacAppleSilicon, nil)
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
	if runtime.GOOS == "linux" && runtime.GOARCH == "amd64" {
		switch backend {
		case "cpu", "vulkan":
			names = []string{"audio-v0.7.4-bin-ubuntu-x64-" + backend + "-portable.tar.gz"}
		}
	}
	if len(names) == 0 {
		return nil, Err(MsgErrBackendUnsupported, nil)
	}
	result := []runtimeArchive{}
	for _, n := range names {
		h, ok := archives[n]
		if !ok {
			return nil, Err(MsgErrPlatformArch, nil)
		}
		result = append(result, runtimeArchive{n, h})
	}
	return result, nil
}
