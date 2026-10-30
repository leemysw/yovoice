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

const Revision = "874fcb41ececda20bcbc0782d6b4ea7f7d069ea8"

// ModelScopeRevision 固定 ModelScope 上 audio.cpp 模型镜像的提交。镜像会随上游整体刷新，
// 跟随 master 时文件大小与 SHA256 都会和目录清单对不上，导致下载失败；
// 该提交下目录清单中的全部文件与清单一致，升级模型时与 Revision 一起更新。
const ModelScopeRevision = "c5046e531f656253f082b7f74384ca59ec6d2a4c"

type ModelPackage struct {
	Revision string `json:"revision,omitempty"`
	// Repo 为空时来自 audio.cpp 的模型仓库；音色库等其他资源写明 Hugging Face 仓库路径，
	// ModelScope 没有镜像时改用 hf-mirror。
	Repo string `json:"repo,omitempty"`
	// ModelScope 是 Repo 在 ModelScope 上的同名镜像仓库，填写后 ModelScope 源直接从该仓库下载。
	ModelScope string `json:"modelScope,omitempty"`
	// EngineMinimum 是该模型需要的最低内核版本，为空时只要求应用的最低版本。
	EngineMinimum string   `json:"engineMinimum,omitempty"`
	Voices        []string `json:"voices,omitempty"`
	Variant       string   `json:"variant,omitempty"`
	// MaxDuration 是模型单次能生成的最长秒数，例如 Stable Audio 3 Small 为 120 秒；0 表示不限制或由其他参数决定。
	MaxDuration int `json:"maxDuration,omitempty"`
	// LoadOptions、SessionOptions 是启动内核时随模型传入的参数，例如 ACE-Step XL 需要指定 DiT 变体，
	// YuE2 需要指定主模型文件。
	LoadOptions    map[string]string `json:"loadOptions,omitempty"`
	SessionOptions map[string]string `json:"sessionOptions,omitempty"`
	// Files 不为空时是多文件模型包：各文件按相对路径下载到 Directory，登记的模型路径是该目录。
	// RemotePath 仍指向主模型文件，用于导入时识别。
	Files       []ModelFile `json:"files,omitempty"`
	Directory   string      `json:"directory,omitempty"`
	StripPrefix string      `json:"stripPrefix,omitempty"`
	Task        string      `json:"task,omitempty"`
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	Family      string      `json:"family"`
	Version     string      `json:"version"`
	Precision   string      `json:"precision"`
	RemotePath  string      `json:"remotePath"`
	Size        int64       `json:"size"`
	SHA256      string      `json:"sha256"`
}

// ModelFile 是多文件模型包中的一个文件。
type ModelFile struct {
	Path   string `json:"path"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

// LegacyModelFiles 冻结本次目录更新前的主文件大小与摘要，不能改成读取运行时目录，
// 否则以后的目录更新会让旧记录冒充新版本。
var LegacyModelFiles = map[string]ModelFile{
	"index-2.5-q8":                   {Size: 3502955328, SHA256: "5e827b2072042e4a1b21ccf24a5cb4f71cb1011403067a0a9b039311d8b38628"},
	"index-2.5-f16":                  {Size: 4547355072, SHA256: "87bed9b82fc8f22119a1a1042332091016c28e37f29b0e93343ccdbfa76ef66a"},
	"index-2.5-orig":                 {Size: 7885093440, SHA256: "2c736df55a306155df4e607f49fe963cf2192fc2193ad449a4bdffb15e52b93a"},
	"index-2-q8":                     {Size: 3633888608, SHA256: "f9be73ac5b6cbdc5f603f04dcb6c9fe37b3a301a365a1ea8d580d3ef7ba22e8e"},
	"index-2-f16":                    {Size: 4646898304, SHA256: "0f7b95d3d32e18bf9352912a7b21a0bd4a8406853a0aaa2c9180f77389c21523"},
	"index-2-orig":                   {Size: 8084552000, SHA256: "c96cb948339b7169b7240f43dbd42ad6354ae3d0a22465e292ec8e090c338e16"},
	"voxcpm2-q8":                     {Size: 2955000480, SHA256: "c8e01ab4416011e12a28f24ede298a1aa5ce64b43f8e8aaad53b1e2fe7c96432"},
	"voxcpm2-bf16":                   {Size: 4772288288, SHA256: "0c0cd2515c7a1145c0ddba06c871724656c36cb53ee3b0118116b34cb4153699"},
	"voxcpm2-orig":                   {Size: 4960716192, SHA256: "13181e01e15d555c9eae7779626eb395c69334f15e948c9ea265ddf37ab50b16"},
	"omnivoice-q8":                   {Size: 1350288416, SHA256: "2f4be637278043c6842de5b85d681532030e9eb6ffe0f8b0e320f68238e3da8b"},
	"omnivoice-bf16":                 {Size: 1639548640, SHA256: "7301a41a0a5a2cb04430c1831a705e3906bfca51562c5cdb2f30a90d505a819c"},
	"omnivoice-f16":                  {Size: 1639548768, SHA256: "7421b6c387351d2cdce7eb8b931fa279739d628ef25acd4ff2062a70e6e1ab63"},
	"qwen3-tts-base-q8":              {Size: 2695175104, SHA256: "b55e06c7890d43c208d15aed8b4ed3f18215f295e47d5960e061b15bff338ab0"},
	"qwen3-tts-base-bf16":            {Size: 4203158464, SHA256: "f5cf4c37b969335e0ffb657119e52025e26192553119590d59fa17b8d36e8b29"},
	"qwen3-tts-base-orig":            {Size: 4544273280, SHA256: "7ab774d56ab9ed9ee7d0ae50917798cda23c7bcc11eaa6c3a4ae32068718b1c1"},
	"qwen3-tts-customvoice-q8":       {Size: 2817044064, SHA256: "3cfaac8e9f13554f6daea3c5e0c53fede71ef5500cbaae7445e5fc3a5bb12e72"},
	"qwen3-tts-customvoice-bf16":     {Size: 4179144352, SHA256: "ef55652c7aa919dc5eeb7967c782a17a6f5d9a8b775337376a4678d37e71a11c"},
	"qwen3-tts-base-0.6b-q8":         {Size: 1991211136, SHA256: "771420bd20ff5f35407b4fa9cf9c5461e153800d3d772ef51c9febc0a520855d"},
	"qwen3-tts-base-0.6b-bf16":       {Size: 2516154496, SHA256: "97d418048b07b5b267628da955b27db4c57b353ded8089de01a469b474255b8d"},
	"qwen3-tts-voicedesign-q8":       {Size: 2816988960, SHA256: "1bcef9a8c021072fca40e00498e00af9091fbe6d3ae4f87567cfee885d6c7554"},
	"qwen3-tts-voicedesign-bf16":     {Size: 4179089248, SHA256: "f4cebcd68023a2db7c3fc8d52d1d28eafb22d4e3b7a64e12c4f946a300536f86"},
	"breeze-tts-2-q8":                {Size: 5079668352, SHA256: "0de52d61560f9f6b2dfeca79f9100f8fce0c2b17c52ec30622e23e150df1ad88"},
	"breeze-tts-2-q4":                {Size: 3794799296, SHA256: "b1c2467ac542d9ba05ad0e7bd331b09137f3752f1be2d3c491bd1b2045df6767"},
	"breeze-tts-2-bf16":              {Size: 7342916800, SHA256: "a00c9f678b4c5ae03d1dcd228f636b329352cda200823faef4e01d3bd97c0a89"},
	"kokoro-82m-q8":                  {Size: 189549408, SHA256: "5d800fd204029302c10313daeafdb31c875c7c29ae31974d0d156cc7f512d1d0"},
	"kokoro-82m-bf16":                {Size: 211954816, SHA256: "51d10c63557d21f70ef5d607e91c11023cf408dbc3af24c283b18106778e1e67"},
	"kokoro-1.1-zh-q8":               {Size: 255319008, SHA256: "44d58f231606d7cb9c17eee649ed195a680f356de368068d03a83d9f188ec9c7"},
	"ace-step-1.5-turbo-bf16":        {Size: 10090398272, SHA256: "93974239a29a1a821b3cc1b1ca7e1c6229b1a900a0e44a1a9770bb2271d2be5f"},
	"ace-step-1.5-turbo-q8":          {Size: 6185460032, SHA256: "cd7bf272588f548d4a253f57483132ef0f8f54a549f26471b09caa72c654270b"},
	"ace-step-1.5-xl-turbo-bf16":     {Size: 15277379424, SHA256: "9529c24b3b929c701b34d0eee3686c76084b99e993539802f95ed171e954ff65"},
	"ace-step-1.5-xl-turbo-q8":       {Size: 10710565056, SHA256: "60ddf6d4ebec685c89fb451af8a7983aca65c58baa6aa6e5e25d168b4b7613f8"},
	"stable-audio-3-small-music-q8":  {Size: 1683570752, SHA256: "89bb22db5fa68ab8f1d90af0a9f88121977c945bdb99a57c96b1e88fa34bf1c8"},
	"stable-audio-3-small-music-f16": {Size: 2358467232, SHA256: "66f36741c19f9ca08e7239f89253141fe08a1f88de92f4459385ad80fc1c0e23"},
	"stable-audio-3-small-sfx-q8":    {Size: 1683570688, SHA256: "5bb1ec653134e63dac46264e336ae198a2590195fc996fcd0605021215e9b26f"},
	"stable-audio-3-small-sfx-f16":   {Size: 2358467168, SHA256: "0d8948b947f137c163983f060973d80e9bb699ea11c303327cd7005402f93918"},
	"stable-audio-3-medium-q8":       {Size: 3582595584, SHA256: "262c8259cfeac055258d28bfc126bcafb5c776fac44165222b186270f99b07ca"},
	"stable-audio-3-medium-f16":      {Size: 5834360000, SHA256: "d701796858eb54347ade9e80240a58d4eccf1890a9ccff3ed3b0640be5273a23"},
	"yue2-3b-q8":                     {Size: 4264195616, SHA256: "52be345b5155bf9ef0b2411e7df8d1d2b8e13b6d977a2f70c35612ec69b1f591"},
	"yue2-3b-bf16":                   {Size: 7261484576, SHA256: "4cf3fdffbaaed2d8e30a3122ac7cd27d0c96f8921805f173da9758c685b3c7d6"},
	"yue2-3b-q4":                     {Size: 2665641504, SHA256: "b80215b59a7fe41a4c76b6163c0ae1031672f892b5951d66fefaa2053a815029"},
	"sheetsage2-orig":                {Size: 2708224256, SHA256: "d858bfdf5ac7be16261ac6ee38754d6fca502149131b44a5262b4039fb72876e"},
	"lyric-align-q8":                 {Size: 1129966496, SHA256: "75209490b11cec2b0db749ca5f4ff92266f58efd30f7fd04d9eb2a3ac9cc929f"},
	"musescore-general-sf2":          {Size: 215614036, SHA256: "ee51d2c4b1525e70f19a45909c4fd7a2e26d91d115fa89dbf5a6bc413d8b9bf3"},
	"generaluser-gs-sf2":             {Size: 32319396, SHA256: "9575028c7a1f589f5770fccc8cff2734566af40cd26ed836944e9a5152688cfe"},
	"sgm-v2-sf2":                     {Size: 247406594, SHA256: "86f2dc4b6983257ce7f983e62afedd22ea35e6e53e3f391360d9f125ce1ea088"},
}

//go:embed catalog.json
var catalogJSON []byte
var Models = []ModelPackage{}

// engine.json 是 audio.cpp 版本与运行包校验值的唯一来源，桌面打包脚本也读取它。
//
//go:embed engine.json
var engineJSON []byte

// ocho.json 是随包分发的 ocho 运行时版本与校验值的唯一来源，打包脚本也读取它。
//
//go:embed ocho.json
var ochoJSON []byte

// EngineVersion 是在线安装与打包使用的推荐 audio.cpp 版本；EngineMinimum 是当前应用
// 请求格式与模型包所需的最低版本。内核不低于最低版本即可使用，升级到推荐版本可选。
var EngineVersion, EngineMinimum string
var archives = map[string]string{}

// OchoVersion 是随包分发的 ocho 版本；校验值为 64 个 0 时表示版本尚未发布，
// 首版上架后由打包脚本回填真实摘要。
var OchoVersion string
var ochoArchives = map[string]string{}

// kokoro.json 是 Kokoro 发音库（eSpeak NG 与 MeCab 原生库）的唯一来源：安装包不再内置，
// 下载 Kokoro 模型时从 PyPI 取固定版本的 wheel 解出原生库。
//
//go:embed kokoro.json
var kokoroJSON []byte

// KokoroWheel 是发音库所需的一个 PyPI wheel；Path 为 PyPI 文件地址中 packages/ 之后的部分。
type KokoroWheel struct {
	Platform string `json:"platform"`
	Project  string `json:"project"`
	Path     string `json:"path"`
	Size     int64  `json:"size"`
	SHA256   string `json:"sha256"`
}

var kokoroWheels []KokoroWheel

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
	var ocho struct {
		Version  string            `json:"version"`
		Archives map[string]string `json:"archives"`
	}
	if e := json.Unmarshal(ochoJSON, &ocho); e != nil {
		panic(e)
	}
	OchoVersion, ochoArchives = ocho.Version, ocho.Archives
	if parseVersion(OchoVersion) == nil {
		panic("ocho.json 版本无效")
	}
	var kokoro struct {
		Wheels []KokoroWheel `json:"wheels"`
	}
	if e := json.Unmarshal(kokoroJSON, &kokoro); e != nil {
		panic(e)
	}
	kokoroWheels = kokoro.Wheels
}

// KokoroWheels 返回当前平台发音库所需的 wheel。
func KokoroWheels() ([]KokoroWheel, error) {
	platform := runtime.GOOS + "/" + runtime.GOARCH
	result := []KokoroWheel{}
	for _, w := range kokoroWheels {
		if w.Platform == platform {
			result = append(result, w)
		}
	}
	if len(result) == 0 {
		return nil, msg.Err(msg.ErrPlatformArch, nil)
	}
	return result, nil
}

// URL 返回 wheel 的下载地址：Hugging Face 源直连 PyPI；ModelScope 与镜像源改用阿里云 PyPI 镜像，
// 两者的文件路径一致，下载后都按 SHA256 校验。
func (w KokoroWheel) URL(source string) (string, error) {
	switch source {
	case "huggingface":
		return "https://files.pythonhosted.org/packages/" + w.Path, nil
	case "modelscope", "mirror":
		return "https://mirrors.aliyun.com/pypi/packages/" + w.Path, nil
	}
	return "", msg.Err(msg.ErrDownloadSource, nil)
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

// IsMusic 判断模型家族是否用于音乐作品：歌曲（风格 + 歌词）或 Stable Audio 的纯音乐与音效。
func IsMusic(family string) bool {
	return family == "ace_step" || family == "yue2" || family == "stable_audio"
}

// PackageFiles 返回需要下载的文件；单文件模型只有主模型一项。
func (m ModelPackage) PackageFiles() []ModelFile {
	if len(m.Files) > 0 {
		return m.Files
	}
	return []ModelFile{{Path: m.RemotePath, Size: m.Size, SHA256: m.SHA256}}
}

// LocalPath 返回包内文件在本地的相对路径；远程下载地址仍使用原始路径。
func (m ModelPackage) LocalPath(path string) string {
	return strings.TrimPrefix(path, strings.TrimSuffix(m.StripPrefix, "/")+"/")
}

// MainFile 返回用于识别模型文件版本的主文件。
func (m ModelPackage) MainFile() ModelFile {
	for _, file := range m.PackageFiles() {
		if file.Path == m.RemotePath {
			return file
		}
	}
	return ModelFile{Path: m.RemotePath, Size: m.Size, SHA256: m.SHA256}
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
	return m.FileURL(source, m.RemotePath)
}

// FileURL 返回模型包内某个文件的下载地址。
func (m ModelPackage) FileURL(source, path string) (string, error) {
	if path == "" {
		return "", msg.Err(msg.ErrModelUnsupported, nil)
	}
	revision := m.Revision
	if revision == "" {
		revision = Revision
	}
	if m.Repo != "" {
		switch source {
		case "huggingface":
			return "https://huggingface.co/" + m.Repo + "/resolve/" + revision + "/" + path, nil
		case "modelscope":
			if m.ModelScope != "" {
				return "https://modelscope.cn/models/" + m.ModelScope + "/resolve/master/" + path, nil
			}
			return "https://hf-mirror.com/" + m.Repo + "/resolve/" + revision + "/" + path, nil
		case "mirror":
			return "https://hf-mirror.com/" + m.Repo + "/resolve/" + revision + "/" + path, nil
		}
		return "", msg.Err(msg.ErrDownloadSource, nil)
	}
	switch source {
	case "huggingface":
		return "https://huggingface.co/audio-cpp/audio.cpp-gguf/resolve/" + revision + "/" + path, nil
	case "mirror":
		return "https://hf-mirror.com/audio-cpp/audio.cpp-gguf/resolve/" + revision + "/" + path, nil
	case "modelscope":
		return "https://modelscope.cn/models/HereIsMark/audio.cpp-gguf/resolve/" + ModelScopeRevision + "/" + path, nil
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
