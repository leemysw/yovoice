// Package testkit 提供多个包共用的测试辅助，仅由测试引用，不进入发布程序。
package testkit

import (
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"unicode"
)

func Must(t testing.TB, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

// WAV 返回一秒 16 kHz 单声道静音。
func WAV() []byte {
	b := make([]byte, 44+32000)
	copy(b, "RIFF")
	binary.LittleEndian.PutUint32(b[4:], uint32(len(b)-8))
	copy(b[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(b[16:], 16)
	binary.LittleEndian.PutUint16(b[20:], 1)
	binary.LittleEndian.PutUint16(b[22:], 1)
	binary.LittleEndian.PutUint32(b[24:], 16000)
	binary.LittleEndian.PutUint32(b[28:], 32000)
	binary.LittleEndian.PutUint16(b[32:], 2)
	binary.LittleEndian.PutUint16(b[34:], 16)
	copy(b[36:], "data")
	binary.LittleEndian.PutUint32(b[40:], 32000)
	return b
}

// VocalWAV 是模拟分离出的人声：4 秒 16 kHz 单声道，0.5–1 秒和 2.5–3 秒各有一段正弦音，其余静音。
func VocalWAV() []byte {
	const rate = 16000
	b := make([]byte, 44+4*rate*2)
	copy(b, WAV()[:44])
	binary.LittleEndian.PutUint32(b[4:], uint32(len(b)-8))
	binary.LittleEndian.PutUint32(b[40:], uint32(len(b)-44))
	for i := 0; i < 4*rate; i++ {
		if t := float64(i) / rate; (t >= .5 && t < 1) || (t >= 2.5 && t < 3) {
			binary.LittleEndian.PutUint16(b[44+i*2:], uint16(int16(8000*math.Sin(2*math.Pi*220*t))))
		}
	}
	return b
}

// RepoFile 定位仓库内文件，跨端一致性检查不依赖测试的工作目录。
func RepoFile(t testing.TB, parts ...string) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("caller")
	}
	return filepath.Join(append([]string{filepath.Dir(file), "..", ".."}, parts...)...)
}

// RunFakeEngine 在测试二进制被当作推理引擎启动时提供模拟服务，并在服务结束后退出进程。
// 正文为“等待取消”时挂起至请求取消；以“模拟生成失败”结尾时返回错误。
func RunFakeEngine() {
	if len(os.Args) <= 2 || os.Args[1] != "--config" {
		return
	}
	b, e := os.ReadFile(os.Args[2])
	if e != nil {
		os.Exit(2)
	}
	var config struct {
		Port   int `json:"port"`
		Models []struct {
			Task    string         `json:"task"`
			Session map[string]any `json:"session_options"`
		} `json:"models"`
	}
	if json.Unmarshal(b, &config) != nil {
		os.Exit(2)
	}
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("{}")) })
	http.HandleFunc("/v1/tasks/run", func(w http.ResponseWriter, r *http.Request) {
		var p struct {
			Request struct {
				Text     string         `json:"text"`
				Audio    string         `json:"audio"`
				Language string         `json:"language"`
				Options  map[string]any `json:"options"`
			} `json:"request"`
		}
		_ = json.NewDecoder(r.Body).Decode(&p)
		if p.Request.Text == "等待取消" {
			<-r.Context().Done()
			return
		}
		if strings.HasSuffix(p.Request.Text, "模拟生成失败") {
			http.Error(w, "模拟生成失败", http.StatusInternalServerError)
			return
		}
		// 歌词对齐：分离任务返回人声分轨；对齐任务把每个非空白字符记作一个字，每字 0.25 秒（16 kHz 样本数）。
		switch config.Models[0].Task {
		case "sep":
			if config.Models[0].Session["bs_roformer.num_overlap"] != "1" {
				http.Error(w, "分离应单遍推理", http.StatusBadRequest)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"named_audio_outputs": []any{map[string]any{"id": "vocals", "audio": base64.StdEncoding.EncodeToString(VocalWAV())}}})
			return
		case "align":
			words := []any{}
			for _, r := range strings.Join(strings.Fields(p.Request.Text), "") {
				n := len(words)
				words = append(words, map[string]any{"word": string(r), "start_sample": n * 4000, "end_sample": n*4000 + 3000, "confidence": 1})
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"text": p.Request.Text, "language": p.Request.Language, "words": words})
			return
		case "asr":
			// 语音识别只接受 16 kHz 输入（WAV 头第 24–27 字节是采样率），返回固定的识别文字。
			b, e := os.ReadFile(p.Request.Audio)
			if e != nil || len(b) < 28 || binary.LittleEndian.Uint32(b[24:28]) != 16000 {
				http.Error(w, "识别输入应为 16 kHz WAV", http.StatusBadRequest)
				return
			}
			// 会话里要配置包内的对齐模型；要求时间时整段送入，每个字 0.25 秒。
			if aligner, _ := config.Models[0].Session["qwen3_asr.forced_aligner_path"].(string); !strings.Contains(aligner, "qwen3-forced-aligner") {
				http.Error(w, "识别会话缺少对齐模型", http.StatusBadRequest)
				return
			}
			reply := map[string]any{"text": " " + RecognizedText + "\n", "language": "Chinese"}
			if p.Request.Options["return_timestamps"] == "true" {
				if p.Request.Options["audio_chunk_mode"] != "none" {
					http.Error(w, "带时间的识别应整段送入", http.StatusBadRequest)
					return
				}
				words := []any{}
				for _, r := range RecognizedText {
					if unicode.IsLetter(r) {
						n := len(words)
						words = append(words, map[string]any{"word": string(r), "start_sample": n * 4000, "end_sample": n*4000 + 3000})
					}
				}
				reply["words"] = words
			}
			_ = json.NewEncoder(w).Encode(reply)
			return
		}
		result := map[string]any{}
		// YuE2 自己规划（cot 非 off 且未给谱）或 SheetSage2 扒谱时附带旋律谱；只出谱或扒谱时没有音频。
		_, given := p.Request.Options["abc"]
		if (p.Request.Options["cot"] != nil && p.Request.Options["cot"] != "off" && !given) || p.Request.Audio != "" {
			result["artifacts"] = []any{map[string]any{"id": "score", "kind": "custom", "payload": base64.StdEncoding.EncodeToString([]byte(ABC)), "meta": map[string]string{"format": "abc", "truncated": "false"}}}
		}
		if p.Request.Options["stop_after"] != "abc" && p.Request.Audio == "" {
			result["audio"] = base64.StdEncoding.EncodeToString(WAV())
		}
		_ = json.NewEncoder(w).Encode(result)
	})
	_ = http.ListenAndServe(fmt.Sprintf("127.0.0.1:%d", config.Port), nil)
	os.Exit(0)
}

// RecognizedText 是模拟引擎识别任何声音样本得到的文字。
const RecognizedText = "今天天气真好，我们去散步吧。"

// ABC 是模拟引擎返回的 YuE2 旋律谱：两小节，带和弦与段落。
const ABC = `X:1
T:
M:4/4
L:1/32
Q:1/4=120
V: Vocal clef=treble name="Vocal Melody" snm="Vocal"
V: Ins clef=treble name="Ins Melody" snm="Inst."
K:C
% verse
V: Vocal
"C"E8G8c16|"G"B8G8D16|
V: Ins
Z2|
`
