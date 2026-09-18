package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
	"yovoice/internal/workbench"
)

var version = "dev"

const usage = `yovoice：独立本地语音生成，无需桌面 App。
用法：
  yovoice status [--data-dir DIR] [--json]
  yovoice setup [--backend metal|cpu|vulkan|cuda]
  yovoice models list
  yovoice models download MODEL [--source modelscope|huggingface|mirror]
  yovoice models import FILE
  yovoice voices list
  yovoice voices import FILE [--name NAME]
  yovoice generate --text-file FILE --reference AUDIO --output WAV
生成选项：--text TEXT（与 --text-file 二选一）、--voice ID（与 --reference 二选一）、
  --model ID、--seed N；IndexTTS：--language zh|en|ja|es|ar、--speed 1、--emotion-text TEXT。
VoxCPM2：--vox-mode design|clone|continuation、--voice-description TEXT、
  --reference-text TEXT、--guidance-scale 2、--inference-steps 10。
VoxCPM2 无参考音频默认声音设计；有参考音频默认克隆，有原文默认精细克隆。
OmniVoice：--voice-mode design|clone、--voice-description TEXT、--reference-text TEXT。
Qwen3-TTS Base：需要参考音频，--reference-text TEXT 可选；不提供原文时仅克隆音色。
Qwen3-TTS CustomVoice：--speaker Vivian、可选 --voice-description TEXT；VoiceDesign：--voice-description TEXT。
OmniVoice / Qwen3-TTS 支持 --language；OmniVoice 支持 --speed、--guidance-scale、--inference-steps。
高级选项：--option 'text_chunk_size=512'、--option 'text_chunk_mode="tag_aware"'，可重复。
所有命令支持 --data-dir DIR、--json。stdout 输出 JSON，进度写 stderr。
生成与下载阻塞至完成；Ctrl-C 取消并清理推理进程。已有输出文件不会被覆盖。
`

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, os.Args[1:], os.Stdout, os.Stderr); err != nil {
		_ = json.NewEncoder(os.Stderr).Encode(map[string]string{"error": err.Error()})
		if errors.Is(err, context.Canceled) {
			os.Exit(130)
		}
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string, out, progress io.Writer) error {
	if len(args) == 0 || args[0] == "--help" || args[0] == "help" {
		_, err := fmt.Fprint(out, usage)
		return err
	}
	if args[0] == "--version" {
		return json.NewEncoder(out).Encode(map[string]string{"version": version})
	}
	command := args[0]
	args = args[1:]
	operand := ""
	if command == "models" || command == "voices" {
		if len(args) == 0 {
			return fmt.Errorf("需要 list、download 或 import 子命令")
		}
		command += " " + args[0]
		args = args[1:]
		if command != "models list" && command != "voices list" && len(args) > 0 && !strings.HasPrefix(args[0], "-") {
			operand = args[0]
			args = args[1:]
		}
	}
	switch command {
	case "status", "setup", "models list", "models download", "models import", "voices list", "voices import", "generate":
	default:
		return fmt.Errorf("未知命令 %q；使用 --help 查看用法", command)
	}
	fs := flag.NewFlagSet(command, flag.ContinueOnError)
	fs.SetOutput(progress)
	root := fs.String("data-dir", "", "数据目录，默认 ~/.yovoice")
	fs.Bool("json", false, "JSON 输出（默认）")
	backend, source, name := "", "", ""
	d := workbench.DefaultDraft()
	d.Title = "CLI 语音"
	d.Text = ""
	d.Mode = "speaker"
	d.EmotionText = ""
	seed := int64(-1)
	nativeOptions := map[string]any{}
	emotionReference, emotionVector := "", ""
	textFile, reference, voice, output := "", "", "", ""
	switch command {
	case "setup":
		initial := "cpu"
		if runtime.GOOS == "darwin" {
			initial = "metal"
		}
		fs.StringVar(&backend, "backend", initial, "推理设备")
	case "models download":
		fs.StringVar(&source, "source", "modelscope", "下载来源")
	case "voices import":
		fs.StringVar(&name, "name", "", "音色名称")
	case "generate":
		fs.Func("option", "模型高级选项 KEY=JSON，可重复；参数见 models list 的 generationOptions", func(value string) error {
			key, raw, ok := strings.Cut(value, "=")
			if !ok || key == "" {
				return fmt.Errorf("--option 需要 KEY=JSON")
			}
			var parsed any
			if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
				return fmt.Errorf("--option %s: %w", key, err)
			}
			nativeOptions[key] = parsed
			return nil
		})
		fs.StringVar(&d.Speaker, "speaker", "", "Qwen3 CustomVoice 内置音色，默认 Vivian")
		fs.StringVar(&d.Text, "text", "", "正文")
		fs.StringVar(&textFile, "text-file", "", "UTF-8 文本文件")
		fs.StringVar(&reference, "reference", "", "1–60 秒参考音频，常见格式自动转换")
		fs.StringVar(&voice, "voice", "", "已有音色 ID")
		fs.StringVar(&output, "output", "", "输出 WAV 路径，不覆盖已有文件")
		fs.StringVar(&d.ModelID, "model", d.ModelID, "模型 ID")
		fs.StringVar(&d.Language, "language", "zh", "语言")
		fs.Float64Var(&d.Speed, "speed", 1, "语速 0.5–2")
		fs.StringVar(&d.Mode, "emotion-mode", "speaker", "IndexTTS：speaker、reference、vector、text")
		fs.StringVar(&emotionReference, "emotion-reference", "", "IndexTTS 演绎参考音频")
		fs.StringVar(&emotionVector, "emotion-vector", "", "IndexTTS 八维情绪，逗号分隔")
		fs.Float64Var(&d.EmotionStrength, "emotion-strength", d.EmotionStrength, "IndexTTS 情绪强度 0–1")
		fs.BoolVar(&d.InferEmotion, "infer-emotion", false, "从正文推断情绪")
		fs.BoolVar(&d.RandomEmotion, "random-emotion", false, "随机情绪采样")
		fs.BoolVar(&d.DoSample, "do-sample", d.DoSample, "IndexTTS 随机采样")
		fs.Float64Var(&d.Temperature, "temperature", d.Temperature, "IndexTTS 采样温度")
		fs.Float64Var(&d.TopP, "top-p", d.TopP, "IndexTTS Top P")
		fs.IntVar(&d.TopK, "top-k", d.TopK, "IndexTTS Top K")
		fs.Float64Var(&d.RepetitionPenalty, "repetition-penalty", d.RepetitionPenalty, "IndexTTS 重复惩罚")
		fs.IntVar(&d.MaxTokens, "max-tokens", d.MaxTokens, "IndexTTS 最大生成长度")
		fs.IntVar(&d.IntervalSilenceMs, "interval-silence-ms", d.IntervalSilenceMs, "IndexTTS 段间停顿毫秒")
		fs.IntVar(&d.NumBeams, "num-beams", d.NumBeams, "IndexTTS 束搜索数量")
		fs.Float64Var(&d.LengthPenalty, "length-penalty", d.LengthPenalty, "IndexTTS 长度惩罚")
		fs.StringVar(&d.EmotionText, "emotion-text", "", "IndexTTS 文字情绪指导")
		fs.StringVar(&d.VoiceMode, "voice-mode", "", "OmniVoice：design 或 clone")
		fs.StringVar(&d.VoxMode, "vox-mode", "", "VoxCPM2：design、clone 或 continuation")
		fs.StringVar(&d.VoiceDescription, "voice-description", "", "VoxCPM2 / OmniVoice / Qwen3-TTS 声音描述")
		fs.StringVar(&d.ReferenceText, "reference-text", "", "参考音频原文")
		fs.Float64Var(&d.GuidanceScale, "guidance-scale", 2, "VoxCPM2 引导强度")
		fs.IntVar(&d.InferenceSteps, "inference-steps", 10, "VoxCPM2 推理步数")
		fs.Int64Var(&seed, "seed", -1, "随机种子，-1 为自动")
	}
	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return err
	}
	if fs.NArg() != 0 {
		return fmt.Errorf("多余参数：%s", strings.Join(fs.Args(), " "))
	}
	if (command == "models download" || command == "models import" || command == "voices import") && operand == "" {
		return fmt.Errorf("缺少模型 ID 或文件路径")
	}
	if command == "generate" {
		if (d.Text == "") == (textFile == "") {
			return fmt.Errorf("--text 和 --text-file 必须且只能指定一个")
		}
		vox := strings.HasPrefix(d.ModelID, "voxcpm2-")
		omni := strings.HasPrefix(d.ModelID, "omnivoice-")
		qwen := strings.HasPrefix(d.ModelID, "qwen3-tts-")
		var unsupported string
		fs.Visit(func(f *flag.Flag) {
			if vox || omni || qwen {
				switch f.Name {
				case "emotion-mode", "emotion-reference", "emotion-vector", "emotion-strength", "infer-emotion", "random-emotion", "do-sample", "temperature", "top-p", "top-k", "repetition-penalty", "max-tokens", "interval-silence-ms", "num-beams", "length-penalty":
					unsupported = f.Name
				}
			}
			if vox && f.Name == "language" || (vox || qwen) && f.Name == "speed" || (vox || omni || qwen) && f.Name == "emotion-text" ||
				!vox && f.Name == "vox-mode" || !(vox || omni) && (f.Name == "guidance-scale" || f.Name == "inference-steps") ||
				!strings.Contains(d.ModelID, "customvoice") && f.Name == "speaker" ||
				!omni && f.Name == "voice-mode" ||
				!(vox || omni || strings.Contains(d.ModelID, "customvoice") || strings.Contains(d.ModelID, "voicedesign")) && f.Name == "voice-description" ||
				!(vox || omni || qwen) && f.Name == "reference-text" {
				unsupported = f.Name
			}
		})
		family := ""
		for _, model := range workbench.Catalog {
			if model.ID == d.ModelID {
				family = model.Family
				break
			}
		}
		if family == "" {
			return fmt.Errorf("未知模型：%s", d.ModelID)
		}
		d.ModelOptions = map[string]map[string]any{family: nativeOptions}
		if omni || qwen {
			d.SynthesisLanguage = "auto"
			fs.Visit(func(f *flag.Flag) {
				if f.Name == "language" {
					d.SynthesisLanguage = d.Language
				}
				if omni && f.Name == "speed" {
					d.OmniSpeed = d.Speed
				}
				if omni && f.Name == "guidance-scale" {
					nativeOptions["guidance_scale"] = d.GuidanceScale
				}
				if omni && f.Name == "inference-steps" {
					nativeOptions["num_inference_steps"] = float64(d.InferenceSteps)
				}
			})
		}
		if unsupported != "" {
			return fmt.Errorf("当前模型不支持 --%s", unsupported)
		}
		if vox && (d.GuidanceScale < 0.5 || d.InferenceSteps < 1) {
			return fmt.Errorf("引导强度需为 0.5–5，推理步数需为 1–50")
		}
		if vox && d.VoxMode == "" {
			d.VoxMode = "design"
			if reference != "" || voice != "" {
				d.VoxMode = "clone"
			}
			if d.ReferenceText != "" {
				d.VoxMode = "continuation"
			}
		}
		if omni && d.VoiceMode == "" {
			d.VoiceMode = "design"
			if reference != "" || voice != "" {
				d.VoiceMode = "clone"
			}
		}
		if omni && ((d.VoiceMode == "design" && d.ReferenceText != "") || (d.VoiceMode == "clone" && d.VoiceDescription != "")) {
			return fmt.Errorf("OmniVoice 声音设计使用 --voice-description；克隆使用参考音频和 --reference-text")
		}
		if reference != "" && voice != "" {
			return fmt.Errorf("--reference 和 --voice 只能指定一个")
		}
		if d.RequiresVoice() && reference == "" && voice == "" {
			return fmt.Errorf("当前模式需要 --reference 或 --voice")
		}
		if !d.RequiresVoice() && (reference != "" || voice != "") {
			return fmt.Errorf("声音设计不使用参考音频，请选择 clone 或 continuation")
		}
		if qwen && !d.RequiresVoice() && d.ReferenceText != "" {
			return fmt.Errorf("仅 Base 模型使用 --reference-text")
		}
		if vox && d.VoxMode != "continuation" && d.ReferenceText != "" {
			return fmt.Errorf("--reference-text 需要 continuation 模式")
		}
		if vox && d.VoxMode == "continuation" && d.VoiceDescription != "" {
			return fmt.Errorf("精细克隆不使用 --voice-description")
		}
		if seed < -1 || seed > 2147483647 {
			return fmt.Errorf("随机种子必须在 0–2147483647 之间，或 -1 自动")
		}
		if seed >= 0 {
			n := int(seed)
			d.Seed = &n
		}
		if textFile != "" {
			b, e := os.ReadFile(textFile)
			if e != nil {
				return e
			}
			d.Text = string(b)
		}
		count := 0
		if d.EmotionText != "" || d.InferEmotion {
			d.Mode = "text"
			count++
		}
		if emotionReference != "" {
			d.Mode = "reference"
			count++
		}
		if emotionVector != "" {
			d.Mode = "vector"
			count++
			d.Emotions = nil
			for _, item := range strings.Split(emotionVector, ",") {
				value, err := strconv.ParseFloat(strings.TrimSpace(item), 64)
				if err != nil {
					return fmt.Errorf("无效情绪向量：%w", err)
				}
				d.Emotions = append(d.Emotions, value)
			}
		}
		if count > 1 {
			return fmt.Errorf("情绪文字、向量和参考音频只能选择一种")
		}
		if !vox && !omni && !qwen && d.Mode == "reference" && emotionReference == "" {
			return fmt.Errorf("参考演绎需要 --emotion-reference")
		}
		if !vox && !omni && !qwen && d.Mode == "text" && d.EmotionText == "" && !d.InferEmotion {
			return fmt.Errorf("文字情绪需要 --emotion-text 或 --infer-emotion")
		}
		if err := workbench.Validate(d); err != nil {
			return err
		}
		if output == "" || !strings.EqualFold(filepath.Ext(output), ".wav") {
			return fmt.Errorf("请通过 --output 指定 WAV 文件")
		}
		if _, err := os.Lstat(output); err == nil {
			return fmt.Errorf("输出文件已存在：%s", output)
		} else if !os.IsNotExist(err) {
			return err
		}
	}
	if *root == "" {
		var err error
		*root, err = workbench.DefaultDirectory()
		if err != nil {
			return err
		}
	}
	abs, err := filepath.Abs(*root)
	if err != nil {
		return err
	}
	if err = os.MkdirAll(abs, 0700); err != nil {
		return err
	}
	lock, err := workbench.Lock(filepath.Join(abs, "service.lock"))
	if err != nil {
		return fmt.Errorf("数据目录正在使用，请退出 App 或指定独立 --data-dir：%w", err)
	}
	defer lock.Close()
	w, err := workbench.New(abs)
	if err != nil {
		return err
	}
	defer w.Close()
	invoke := func(method string, data any) (any, error) {
		b, e := json.Marshal(data)
		if e != nil {
			return nil, e
		}
		return w.Call(method, b)
	}
	wait := func(method string, data any) error {
		if _, e := invoke(method, data); e != nil {
			return e
		}
		return waitOperation(ctx, w, progress)
	}
	var result any
	switch command {
	case "status":
		result = map[string]any{"dataDirectory": abs, "state": w.Store.Read(), "engineVersion": workbench.EngineVersion}
	case "models list":
		result = map[string]any{"catalog": workbench.Catalog, "installed": w.Store.Read().Models, "generationOptions": workbench.GenerationOptions}
	case "voices list":
		result = w.Store.Read().Voices
	case "voices import":
		result, err = w.ImportVoice(ctx, operand, name)
	case "models import":
		err = wait("model.import", map[string]string{"path": operand})
		result = w.Store.Read().Models
	case "setup":
		p := w.Store.Read().Preferences
		p.Backend = backend
		if _, err = invoke("preferences.save", p); err == nil {
			err = wait("runtime.install", map[string]string{})
		}
		result = w.Store.Read().RuntimePath
	case "models download":
		p := w.Store.Read().Preferences
		p.DownloadSource = source
		if _, err = invoke("preferences.save", p); err == nil {
			err = wait("model.download", map[string]string{"id": operand})
		}
		result = w.Store.Read().Models
	case "generate":
		if reference != "" {
			var v workbench.Voice
			v, err = w.ImportVoice(ctx, reference, "")
			if err != nil {
				return err
			}
			voice = v.ID
		}
		if emotionReference != "" {
			v, e := w.ImportVoice(ctx, emotionReference, "")
			if e != nil {
				return e
			}
			d.EmotionVoiceID = &v.ID
		}
		if voice != "" {
			d.VoiceID = &voice
		}
		if err = wait("generation.start", d); err != nil {
			return err
		}
		history := w.Store.Read().History
		if len(history) == 0 || history[0].Settings.ID != d.ID {
			return fmt.Errorf("生成结果未找到")
		}
		g := history[0]
		var path string
		path, err = w.MediaFile("outputs", g.ID)
		if err != nil {
			return err
		}
		output, err = filepath.Abs(output)
		if err != nil {
			return err
		}
		if err = copyOutput(path, output); err != nil {
			return err
		}
		result = map[string]any{"id": g.ID, "path": output, "duration": g.Duration, "model": d.ModelID, "voice": voice}
	}
	if err != nil {
		return err
	}
	return json.NewEncoder(out).Encode(result)
}

// 订阅前后都读取状态，避免短任务结束时丢失通知；取消会等待核心收尾。
func waitOperation(ctx context.Context, w *workbench.Workbench, out io.Writer) error {
	events, unsubscribe := w.Store.Subscribe()
	defer unsubscribe()
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	last := ""
	for {
		if err := ctx.Err(); err != nil {
			w.Close()
			return err
		}
		a := w.Store.Read().Activity
		if a == nil {
			return fmt.Errorf("操作未启动")
		}
		message := fmt.Sprintf("%s (%d/%d)", a.Code, a.Received, a.Total)
		if message != last {
			fmt.Fprintln(out, message)
			last = message
		}
		switch a.Status {
		case "completed":
			return nil
		case "failed":
			if a.ErrorCode != nil {
				return errors.New(string(*a.ErrorCode))
			}
			return fmt.Errorf("操作失败")
		case "cancelled":
			return context.Canceled
		case "running":
		default:
			return fmt.Errorf("操作已中断：%s", a.Status)
		}
		select {
		case <-ctx.Done():
		case <-events:
		case <-ticker.C:
		}
	}
}

func copyOutput(source, destination string) (err error) {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	if err = os.MkdirAll(filepath.Dir(destination), 0700); err != nil {
		return err
	}
	output, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			os.Remove(destination)
		}
	}()
	_, err = io.Copy(output, input)
	closeErr := output.Close()
	if err == nil {
		err = closeErr
	}
	return err
}
