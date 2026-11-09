package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
	"yovoice/internal/audio"
	"yovoice/internal/catalog"
	"yovoice/internal/platform"
	"yovoice/internal/schema"
	"yovoice/internal/store"
)

func wave() []byte {
	b := make([]byte, 32044)
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

// 测试进程充当引擎，覆盖 CLI 的真实启动、协议、结果落盘和取消流程。
func TestMain(m *testing.M) {
	if len(os.Args) > 2 && os.Args[1] == "--config" {
		b, _ := os.ReadFile(os.Args[2])
		var c struct{ Port int }
		_ = json.Unmarshal(b, &c)
		http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, "{}") })
		http.HandleFunc("/v1/tasks/run", func(w http.ResponseWriter, r *http.Request) {
			var p struct {
				Request struct {
					Text, Audio string
				}
			}
			_ = json.NewDecoder(r.Body).Decode(&p)
			if p.Request.Text == "等待取消" {
				<-r.Context().Done()
				return
			}
			// 语音识别：送入音频、正文为空，返回文字和以样本数计的逐字时间。
			if p.Request.Audio != "" && p.Request.Text == "" {
				words := []map[string]any{}
				for i, w := range []string{"你", "好", "世", "界"} {
					words = append(words, map[string]any{"word": w, "start_sample": i * 3200, "end_sample": i*3200 + 2400})
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"text": "你好，世界。", "language": "Chinese", "words": words})
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"audio": base64.StdEncoding.EncodeToString(wave())})
		})
		_ = http.ListenAndServe(fmt.Sprintf("127.0.0.1:%d", c.Port), nil)
		os.Exit(0)
	}
	os.Exit(m.Run())
}
func TestStandalone(t *testing.T) {
	root := t.TempDir()
	s, e := store.New(root)
	if e != nil {
		t.Fatal(e)
	}
	exe, _ := os.Executable()
	model := filepath.Join(root, "model.gguf")
	if e = os.WriteFile(model, []byte("test"), 0600); e != nil {
		t.Fatal(e)
	}
	// 语音识别是多文件包：按目录里的各个文件放好占位文件。
	asr := filepath.Join(root, "Qwen3-ASR-GGUF")
	if p, err := catalog.Lookup("qwen3-asr-0.6b-q8"); err == nil {
		for _, f := range p.Files {
			path := filepath.Join(asr, filepath.FromSlash(f.Path))
			if os.MkdirAll(filepath.Dir(path), 0700) != nil || os.WriteFile(path, []byte("test"), 0600) != nil {
				t.Fatal("准备识别模型失败")
			}
		}
	}
	e = s.Update(func(s *schema.State) {
		s.RuntimePath = &exe
		b := "cpu"
		s.RuntimeBackend = &b
		v := catalog.EngineVersion
		s.RuntimeVersion = &v
		s.Models = []schema.InstalledModel{{ID: "index-2.5-q8", Path: model}, {ID: "voxcpm2-q8", Path: model}, {ID: "omnivoice-q8", Path: model}, {ID: "qwen3-tts-base-q8", Path: model}, {ID: "qwen3-tts-customvoice-q8", Path: model}, {ID: "qwen3-tts-voicedesign-q8", Path: model}, {ID: "ming3-tts-0.5b-q8", Path: model}, {ID: "ace-step-1.5-turbo-q8", Path: model}, {ID: "yue2-3b-q8", Path: model}, {ID: "stable-audio-3-small-sfx-q8", Path: model}, {ID: "qwen3-asr-0.6b-q8", Path: asr}}
	}, true)
	if e != nil {
		t.Fatal(e)
	}
	var rejected bytes.Buffer
	if err := run(context.Background(), []string{"models", "import", model, "--data-dir", root}, &rejected, &rejected); err == nil {
		t.Fatal("模型校验失败必须返回错误，不能提前报告成功")
	}
	ref := filepath.Join(root, "ref.wav")
	if e = os.WriteFile(ref, wave(), 0600); e != nil {
		t.Fatal(e)
	}
	output := filepath.Join(root, "result.wav")
	var out, progress bytes.Buffer
	args := []string{"generate", "--text", "你好", "--reference", ref, "--output", output, "--data-dir", root, "--json"}
	// 整个用例串行启动十余次假引擎，Windows 加 -race 时接近 15 秒，仅作为卡死保护。
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	if e = run(ctx, args, &out, &progress); e != nil {
		t.Fatal(e)
	}
	var result struct {
		Path     string
		Duration float64
		ID       string
	}
	if e = json.Unmarshal(out.Bytes(), &result); e != nil || result.Path != output || result.Duration != 1 || result.ID == "" {
		t.Fatalf("%s %v", out.String(), e)
	}
	if e = run(ctx, args, &out, &progress); e == nil {
		t.Fatal("不能覆盖已有输出")
	}
	if duration, e := audio.Duration(output); e != nil || duration != 1 {
		t.Fatal(duration, e)
	}
	args[2] = "等待取消"
	args[6] = filepath.Join(root, "cancelled.wav")
	cancelled, stop := context.WithTimeout(ctx, time.Second)
	defer stop()
	if e = run(cancelled, args, &out, &progress); !errors.Is(e, context.DeadlineExceeded) {
		t.Fatal(e)
	}
	if _, e = os.Stat(args[6]); !os.IsNotExist(e) {
		t.Fatal("取消仍导出音频")
	}

	for _, mode := range []string{"design", "clone", "continuation"} {
		voxArgs := []string{"generate", "--model", "voxcpm2-q8", "--text", "你好", "--vox-mode", mode, "--output", filepath.Join(root, mode+".wav"), "--data-dir", root}
		if mode != "design" {
			voxArgs = append(voxArgs, "--reference", ref)
		}
		if mode == "continuation" {
			voxArgs = append(voxArgs, "--reference-text", "原文")
		}
		out.Reset()
		if err := run(ctx, voxArgs, &out, &progress); err != nil {
			t.Fatal(mode, err)
		}
		var generated map[string]any
		if err := json.Unmarshal(out.Bytes(), &generated); err != nil || generated["model"] != "voxcpm2-q8" {
			t.Fatal(out.String(), err)
		}
		config, err := os.ReadFile(filepath.Join(root, "runtime", "server.json"))
		if err != nil || !bytes.Contains(config, []byte(`"family":"voxcpm2"`)) {
			t.Fatal(string(config), err)
		}
	}
	for i, test := range []struct {
		model, family string
		flags         []string
	}{
		{"omnivoice-q8", "omnivoice", []string{"--voice-description", "female, young adult", "--language", "zh", "--speed", "1.1", "--inference-steps", "32"}},
		{"index-2.5-q8", "index_tts2", []string{"--reference", ref, "--emotion-reference", ref}},
		{"index-2.5-q8", "index_tts2", []string{"--reference", ref, "--emotion-vector", "0.4,0,0,0,0,0,0.1,0", "--temperature", "0.7"}},
		{"omnivoice-q8", "omnivoice", []string{"--voice-mode", "clone", "--reference", ref, "--reference-text", "原文"}},
		{"qwen3-tts-base-q8", "qwen3_tts", []string{"--reference", ref, "--language", "ja", "--option", "temperature=0.7"}},
		{"qwen3-tts-customvoice-q8", "qwen3_tts", []string{"--speaker", "Ryan", "--voice-description", "Warm"}},
		{"qwen3-tts-voicedesign-q8", "qwen3_tts", []string{"--voice-description", "Warm narrator"}},
		{"ming3-tts-0.5b-q8", "ming3_tts", []string{"--voice-description", "Warm narrator", "--language", "ja", "--option", "trim_silence=false"}},
		{"ming3-tts-0.5b-q8", "ming3_tts", []string{"--voice-mode", "clone", "--reference", ref, "--reference-text", "原文"}},
		{"ace-step-1.5-turbo-q8", "ace_step", []string{"--lyrics", "[verse]\n晚风吹过海岸线", "--language", "zh", "--option", "duration_seconds=30"}},
		{"yue2-3b-q8", "yue2", []string{"--lyrics", "[Verse]\n晚风吹过海岸线", "--option", `cot="off"`, "--seed", "7"}},
		{"stable-audio-3-small-sfx-q8", "stable_audio", []string{"--option", "duration_seconds=3"}},
	} {
		args := []string{"generate", "--model", test.model, "--text", "你好", "--output", filepath.Join(root, fmt.Sprintf("new-model-%d.wav", i)), "--data-dir", root}
		out.Reset()
		if err := run(ctx, append(args, test.flags...), &out, &progress); err != nil {
			t.Fatal(test.model, err)
		}
		config, err := os.ReadFile(filepath.Join(root, "runtime", "server.json"))
		if err != nil || !bytes.Contains(config, []byte(`"family":"`+test.family+`"`)) {
			t.Fatal(string(config), err)
		}
		if test.model == "yue2-3b-q8" && !bytes.Contains(out.Bytes(), []byte(`"seed":7`)) {
			t.Fatal("音乐生成应返回实际种子", out.String())
		}
		if test.model == "qwen3-tts-voicedesign-q8" && !bytes.Contains(config, []byte(`"task":"vdes"`)) {
			t.Fatal(string(config))
		}
		if !bytes.Contains(config, []byte(`"mode":"offline"`)) {
			t.Fatal(string(config))
		}
	}
	// 转写：有声音的 WAV 直接识别，按扩展名写出字幕，同时留下一份转写记录。
	speech := filepath.Join(root, "speech.wav")
	tone := make([]float32, 16000)
	for i := range tone {
		tone[i] = float32(.3 * math.Sin(float64(i)*.1))
	}
	if e = audio.WriteMono(speech, tone, 16000); e != nil {
		t.Fatal(e)
	}
	srt := filepath.Join(root, "speech.srt")
	out.Reset()
	if e = run(ctx, []string{"transcribe", speech, "--output", srt, "--data-dir", root}, &out, &progress); e != nil {
		t.Fatal(e, progress.String())
	}
	if b, _ := os.ReadFile(srt); string(b) != "1\n00:00:00,000 --> 00:00:00,750\n你好，世界\n" {
		t.Fatalf("%q %s", b, out.String())
	}
	if e = run(ctx, []string{"transcribe", speech, "--output", srt, "--data-dir", root}, &out, &progress); e == nil {
		t.Fatal("不能覆盖已有字幕")
	}
	if e = run(ctx, []string{"transcribe", speech, "--output", filepath.Join(root, "speech.docx"), "--data-dir", root}, &out, &progress); e == nil {
		t.Fatal("未知字幕格式应拒绝")
	}
	if e = run(ctx, []string{"separate", speech, "--output-dir", filepath.Join(root, "stems"), "--data-dir", root}, &out, &progress); e == nil {
		t.Fatal("没装分轨模型时应失败")
	}
	lock, e := platform.Lock(filepath.Join(root, "service.lock"))
	if e != nil {
		t.Fatal(e)
	}
	if e = run(ctx, []string{"status", "--data-dir", root}, &out, &progress); e == nil {
		t.Fatal("未阻止并发访问")
	}
	lock.Close()
	out.Reset()
	if e = run(ctx, []string{"voices", "list", "--data-dir", root}, &out, &progress); e != nil || !json.Valid(out.Bytes()) {
		t.Fatal(e, out.String())
	}
}

func TestModelSpecificFlags(t *testing.T) {
	for _, flags := range [][]string{
		{"--model", "voxcpm2-q8", "--language", "zh"},
		{"--model", "index-2.5-q8", "--voice-description", "温柔"},
		{"--model", "voxcpm2-q8", "--vox-mode", "clone"},
		{"--model", "voxcpm2-q8", "--vox-mode", "design", "--reference", "unused.wav"},
		{"--model", "voxcpm2-q8", "--reference", "unused.wav", "--voice", "unused"},
		{"--model", "voxcpm2-q8", "--inference-steps", "0"},
		{"--model", "omnivoice-q8", "--voice-mode", "clone", "--reference", "unused.wav"},
		{"--model", "qwen3-tts-voicedesign-q8"},
		{"--model", "qwen3-tts-customvoice-q8", "--speaker", "unknown"},
		{"--model", "omnivoice-q8", "--option", "streaming=true"},
		{"--model", "voxcpm2-q8", "--option", "max_tokens=100", "--option", "min_tokens=101"},
		{"--model", "index-2.5-q8", "--lyrics", "歌词"},
		{"--model", "ace-step-1.5-turbo-q8", "--reference", "unused.wav"},
		{"--model", "ace-step-1.5-turbo-q8", "--abc-file", "unused.abc"},
		{"--model", "yue2-3b-q8", "--language", "zh", "--lyrics", "歌词"},
		{"--model", "yue2-3b-q8"},
		{"--model", "yue2-3b-q8", "--lyrics", "歌词", "--option", "candidates=2"},
	} {
		var out bytes.Buffer
		args := append([]string{"generate", "--text", "你好", "--output", "unused.wav"}, flags...)
		if err := run(context.Background(), args, &out, &out); err == nil {
			t.Fatal("应在访问文件或启动引擎前拒绝不匹配的参数", flags)
		}
	}
}

// 桌面应用迁移过数据目录后，命令行默认跟随新位置，而不是迁移后会被删除的 ~/.yovoice。
func TestDefaultDataDirFollowsRelocation(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows 配置位于 APPDATA")
	}
	home := t.TempDir()
	t.Setenv("HOME", home)
	got, err := defaultDataDir()
	if err != nil || got != filepath.Join(home, ".yovoice") {
		t.Fatalf("未迁移时应为 ~/.yovoice: %q %v", got, err)
	}
	moved := filepath.Join(t.TempDir(), "data")
	if err = store.WriteConfig(store.StorageConfig{DataPath: moved}); err != nil {
		t.Fatal(err)
	}
	if got, err = defaultDataDir(); err != nil || got != moved {
		t.Fatalf("迁移后应使用新目录: %q %v", got, err)
	}
}
