// Package engine 管理 audio.cpp 推理进程，并把作品参数转换为引擎请求。
package engine

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"yovoice/internal/audio"
	"yovoice/internal/catalog"
	"yovoice/internal/diag"
	"yovoice/internal/msg"
	"yovoice/internal/platform"
	"yovoice/internal/schema"
)

// Engine 可被并发调用：同一时间只运行一个推理请求，停止会等待当前请求结束。
type Engine struct {
	mu      sync.Mutex
	root    string
	process *exec.Cmd
	done    chan error
	// stopping 标记当前进程是被主动结束的，退出日志据此区分正常停止与意外退出。
	stopping      *atomic.Bool
	endpoint, key string
	client        *http.Client
}

func New(root string) *Engine {
	ReapOrphan(root)
	return &Engine{root: root, client: &http.Client{Transport: &http.Transport{Proxy: nil}}}
}

// KokoroDir 是 Kokoro 发音库的安装目录；发音库不随安装包分发，下载 Kokoro 模型时写入。
func KokoroDir(root string) string { return filepath.Join(root, "runtime", "kokoro") }

// KokoroLibraries 返回当前系统 eSpeak NG 与 MeCab 动态库的文件名。
func KokoroLibraries() [2]string {
	switch runtime.GOOS {
	case "darwin":
		return [2]string{"libespeak-ng.dylib", "libmecab.2.dylib"}
	case "windows":
		return [2]string{"espeak-ng.dll", "libmecab.dll"}
	}
	return [2]string{"libespeak-ng.so", "libmecab.so.2"}
}

// KokoroReady 判断发音库的两个动态库与 eSpeak 数据是否齐全。
func KokoroReady(root string) bool {
	dir, names := KokoroDir(root), KokoroLibraries()
	for _, name := range []string{names[0], names[1], filepath.Join("espeak-ng-data", "phontab")} {
		if info, err := os.Stat(filepath.Join(dir, name)); err != nil || !info.Mode().IsRegular() {
			return false
		}
	}
	return true
}

func pidPath(root string) string { return filepath.Join(root, "runtime", "engine.pid") }

// ReapOrphan 结束上次服务异常退出后残留的推理进程：它仍占用显存和端口，Windows 上还会锁住内核文件。
// 只结束命令行包含本数据目录 server.json 的进程，避免误杀 PID 被复用的其他程序；
// 数据目录由 service.lock 独占，此时不可能有其他服务正在使用这个推理进程。
func ReapOrphan(root string) {
	path := pidPath(root)
	b, err := os.ReadFile(path)
	if err != nil {
		return
	}
	defer os.Remove(path)
	pid, err := strconv.Atoi(strings.TrimSpace(string(b)))
	if err != nil || pid <= 1 || pid == os.Getpid() {
		return
	}
	command, err := platform.ProcessCommand(pid)
	if err != nil || !strings.Contains(command, filepath.Join(root, "runtime", "server.json")) {
		return
	}
	platform.KillGroup(pid)
	diag.Log(root, "engine.orphan_killed", "pid", pid)
}
func (e *Engine) Stop() {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.stop()
}

// stop 要求调用方持有 mu。
func (e *Engine) stop() {
	if e.process != nil {
		e.stopping.Store(true)
		select {
		case <-e.done:
			// 进程已自行退出：PID 可能已被别的程序复用，不能再按它结束。
		default:
			platform.KillProcess(e.process)
			<-e.done
		}
		e.process = nil
		e.key = ""
		_ = os.Remove(pidPath(e.root))
	}
}
func (e *Engine) start(ctx context.Context, executable, model string, definition catalog.ModelPackage, backend string, performanceFirst bool, encoderSamples int, progress func(msg.Code, msg.Params)) error {
	family, task := definition.Family, definition.Task
	if performanceFirst && (backend == "cuda" || backend == "cuda13") {
		switch family {
		case "ace_step", "qwen3_tts", "yue2", "voxcpm2", "fish_drama3":
			sessionOptions := make(map[string]string, len(definition.SessionOptions)+1)
			for key, value := range definition.SessionOptions {
				sessionOptions[key] = value
			}
			sessionOptions[family+".perf_mode"] = "cuda_perf"
			definition.SessionOptions = sessionOptions
		}
	}
	if task == "" {
		task = "tts"
	}
	key := fmt.Sprintf("%s|%s|%s|%s|%s|%v|%v|%d", executable, model, family, task, backend, definition.LoadOptions, definition.SessionOptions, encoderSamples)
	if e.process != nil && e.key == key {
		select {
		case <-e.done:
			e.process = nil
		default:
			return nil
		}
	}
	e.stop()
	if _, err := os.Stat(executable); err != nil {
		return msg.Err(msg.ErrRuntimeMissing, nil)
	}
	if _, err := os.Stat(model); err != nil {
		return msg.Err(msg.ErrModelMoved, nil)
	}
	progress(msg.ActivityEngineStart, nil)
	l, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return err
	}
	port := l.Addr().(*net.TCPAddr).Port
	l.Close()
	entry := map[string]any{"id": "index", "family": family, "path": model, "task": task, "mode": "offline"}
	if len(definition.LoadOptions) > 0 {
		entry["load_options"] = definition.LoadOptions
	}
	session := map[string]any{}
	for k, v := range definition.SessionOptions {
		session[k] = v
	}
	if encoderSamples > 0 {
		session["voxcpm2.audiovae_encoder_sample_capacity"] = encoderSamples
	}
	if len(session) > 0 {
		entry["session_options"] = session
	}
	config := map[string]any{"host": "127.0.0.1", "port": port, "backend": catalog.ServerBackend(backend), "device": 0, "threads": max(1, min(runtime.NumCPU()/2, 8)), "lazy_load": true, "max_loaded_models": 1, "idle_unload_ms": 300000, "log_request_body": false, "max_request_body_bytes": 1048576, "models": []any{entry}}
	b, err := json.Marshal(config)
	if err != nil {
		return err
	}
	path := filepath.Join(e.root, "runtime", "server.json")
	if err = platform.WriteFileAtomic(path, b, 0600); err != nil {
		return err
	}
	c := exec.Command(executable, "--config", path, "--no-ui")
	c.Dir = filepath.Dir(executable)
	if family == "kokoro_tts" {
		if !KokoroReady(e.root) {
			return msg.Err(msg.ErrRuntimeMissing, nil)
		}
		dir, names := KokoroDir(e.root), KokoroLibraries()
		c.Env = append(os.Environ(),
			"AUDIOCPP_ESPEAK_LIBRARY="+filepath.Join(dir, names[0]),
			"AUDIOCPP_MECAB_LIBRARY="+filepath.Join(dir, names[1]),
			// 官方小包不包含 eSpeak 数据，统一使用发音库自带的数据目录。
			"AUDIOCPP_ESPEAK_DATA="+filepath.Join(dir, "espeak-ng-data"))
	}
	platform.ConfigureProcess(c)
	// 推理日志追加写入，崩溃后重试重新启动引擎时，上一轮的出错原因仍保留在同一文件中。
	out, err := diag.OpenProcessLog(filepath.Join(e.root, "logs", "engine.log.out"), "engine "+family)
	if err != nil {
		return err
	}
	defer out.Close()
	stderr, err := diag.OpenProcessLog(filepath.Join(e.root, "logs", "engine.log"), "engine "+family)
	if err != nil {
		return err
	}
	defer stderr.Close()
	c.Stdout = out
	c.Stderr = stderr
	if err = c.Start(); err != nil {
		return err
	}
	// 服务崩溃或被强制结束时不能留下推理进程：Windows 绑定作业对象，其他系统记录 PID 供下次启动清理。
	if err := platform.TieToParent(c); err != nil {
		diag.Log(e.root, "engine.tie_failed", "error", diag.Error(err))
	}
	if err := os.WriteFile(pidPath(e.root), []byte(strconv.Itoa(c.Process.Pid)), 0600); err != nil {
		// 没有 PID 文件，服务崩溃后下次启动无法回收这个推理进程，至少留下记录。
		diag.Log(e.root, "engine.pid_write_failed", "error", diag.Error(err))
	}
	e.process = c
	e.done = make(chan error, 1)
	e.stopping = new(atomic.Bool)
	done, stopping, pid, launched := e.done, e.stopping, c.Process.Pid, time.Now()
	diag.Log(e.root, "engine.started", "family", family, "task", task, "backend", backend, "pid", pid)
	diag.Go(e.root, "engine.wait", func() {
		err := c.Wait()
		event := "engine.exited"
		if stopping.Load() {
			event = "engine.stopped"
		}
		exit := ""
		if err != nil {
			exit = err.Error()
		}
		// 意外退出时 engine.log 里有推理进程自己的错误输出。
		diag.Log(e.root, event, "family", family, "pid", pid, "uptime_s", int(time.Since(launched).Seconds()), "exit", exit)
		done <- err
		close(done)
	})
	e.endpoint = fmt.Sprintf("http://127.0.0.1:%d/", port)
	attempts := 120
	if family == "kokoro_tts" {
		// 多语言包包含日文词典；首次读取内嵌资源需要更长时间。
		attempts = 1200
	}
	for i := 0; i < attempts; i++ {
		if err = ctx.Err(); err != nil {
			return err
		}
		select {
		case <-e.done:
			e.process = nil
			diag.Log(e.root, "engine.start_failed", "family", family, "pid", pid)
			return msg.Err(msg.ErrEngineStartFailed, nil)
		default:
		}
		probe, cancel := context.WithTimeout(ctx, 1500*time.Millisecond)
		req, _ := http.NewRequestWithContext(probe, "GET", e.endpoint+"health", nil)
		res, err := e.client.Do(req)
		healthy := err == nil && res.StatusCode == 200
		if res != nil {
			res.Body.Close()
		}
		cancel()
		if healthy {
			e.key = key
			diag.Log(e.root, "engine.ready", "family", family, "pid", pid, "startup_ms", time.Since(launched).Milliseconds())
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(250 * time.Millisecond):
		}
	}
	diag.Log(e.root, "engine.start_timeout", "family", family, "pid", pid, "attempts", attempts)
	return msg.Err(msg.ErrEngineStartTimeout, nil)
}

// Generate 生成音频写入 output；YuE2 自己规划旋律时一并返回这次所用的旋律谱，其余模型返回空串。
func (e *Engine) Generate(ctx context.Context, executable string, m schema.InstalledModel, backend string, performanceFirst bool, d schema.Draft, voice, emotion, output string, progress func(msg.Code, msg.Params)) (score string, err error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	defer func() {
		if err != nil {
			e.stop()
		}
		_ = os.Remove(output + ".part")
	}()
	payload, err := BuildRequest(d, voice, emotion)
	if err != nil {
		return "", err
	}
	definition, err := catalog.Lookup(m.ID)
	if err != nil {
		return "", err
	}
	encoderSamples := 0
	if definition.Family == "xtts_v2" {
		duration, audioErr := audio.Duration(voice)
		if audioErr != nil {
			return "", audioErr
		}
		if duration < 6 || duration > 30 {
			return "", msg.Err(msg.ErrXTTSReferenceDuration, nil)
		}
	}
	if definition.Family == "voxcpm2" {
		encoderSamples = 240000
		if d.RequiresVoice() {
			duration, audioErr := audio.Duration(voice)
			if audioErr != nil {
				return "", audioErr
			}
			if duration < 1 || duration > 60 {
				return "", msg.Err(msg.ErrAudioDuration, nil)
			}
			// VoxCPM2 先重采样到 16 kHz，再按 4 × 640 个采样点补齐；长参考音频按需扩容。
			encoderSamples = max(encoderSamples, int(math.Ceil(duration*16000/2560))*2560)
		}
	}
	if err = e.start(ctx, executable, m.Path, definition, backend, performanceFirst, encoderSamples, progress); err != nil {
		return "", err
	}
	// YuE2 纯音乐：没谱时先在同一个会话里出谱，再把人声旋律移到器乐声部后生成；
	// 返回实际演奏的谱，存进这一版，之后可以载入编辑。
	played := ""
	if definition.Family == "yue2" && d.Instrumental {
		if strings.TrimSpace(d.Abc) == "" {
			plan, _ := payload["request"].(map[string]any)["options"].(map[string]any)
			plan["stop_after"] = "abc"
			progress(msg.ActivityPlanMelody, nil)
			planned, err := e.run(ctx, payload)
			if err != nil {
				return "", err
			}
			if d.Abc, _, _ = planned.score(); d.Abc == "" {
				return "", msg.Err(msg.ErrMelodyEmpty, nil)
			}
		}
		if played, err = instrumentalScore(d.Abc); err != nil {
			return "", err
		}
		if payload, err = BuildRequest(d, voice, emotion); err != nil {
			return "", err
		}
	}
	progress(msg.ActivitySynthesizing, nil)
	result, err := e.run(ctx, payload)
	if err != nil {
		return "", err
	}
	if result.Audio == "" {
		return "", msg.Err(msg.ErrEngineNoAudio, nil)
	}
	progress(msg.ActivitySavingAudio, nil)
	wav, err := base64.StdEncoding.DecodeString(result.Audio)
	if err != nil {
		return "", err
	}
	if err = os.WriteFile(output+".part", wav, 0600); err != nil {
		return "", err
	}
	if _, err = audio.Duration(output + ".part"); err != nil {
		return "", err
	}
	if err = ctx.Err(); err != nil {
		return "", err
	}
	if score, _, _ = result.score(); played != "" {
		score = played
	}
	return score, os.Rename(output+".part", output)
}

// PlanMelody 只运行 YuE2 的规划阶段（stop_after=abc），返回带和弦的旋律谱和是否因长度上限被截断。
func (e *Engine) PlanMelody(ctx context.Context, executable string, m schema.InstalledModel, backend string, performanceFirst bool, d schema.Draft, progress func(msg.Code, msg.Params)) (score string, truncated bool, err error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	defer func() {
		if err != nil {
			e.stop()
		}
	}()
	d.Abc = ""
	payload, err := BuildRequest(d, "", "")
	if err != nil {
		return "", false, err
	}
	definition, err := catalog.Lookup(m.ID)
	if err != nil {
		return "", false, err
	}
	if definition.Family != "yue2" {
		return "", false, msg.Err(msg.ErrModelUnsupported, nil)
	}
	payload["request"].(map[string]any)["options"].(map[string]any)["stop_after"] = "abc"
	if err = e.start(ctx, executable, m.Path, definition, backend, performanceFirst, 0, progress); err != nil {
		return "", false, err
	}
	progress(msg.ActivityPlanMelody, nil)
	result, err := e.run(ctx, payload)
	if err != nil {
		return "", false, err
	}
	score, truncated, ok := result.score()
	if !ok {
		return "", false, msg.Err(msg.ErrMelodyEmpty, nil)
	}
	return score, truncated, nil
}

// Transcribe 用 SheetSage2 把一首歌扒成旋律谱；wav 是已转换好的本地音频路径。
func (e *Engine) Transcribe(ctx context.Context, executable string, m schema.InstalledModel, backend, wav string, progress func(msg.Code, msg.Params)) (score string, err error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	defer func() {
		if err != nil {
			e.stop()
		}
	}()
	definition, err := catalog.Lookup(m.ID)
	if err != nil {
		return "", err
	}
	if definition.Family != "sheetsage2" {
		return "", msg.Err(msg.ErrModelUnsupported, nil)
	}
	if err = e.start(ctx, executable, m.Path, definition, backend, false, 0, progress); err != nil {
		return "", err
	}
	progress(msg.ActivityTranscribe, nil)
	result, err := e.run(ctx, map[string]any{"model": "index", "request": map[string]any{"audio": wav}})
	if err != nil {
		return "", err
	}
	score, _, ok := result.score()
	if !ok {
		return "", msg.Err(msg.ErrMelodyEmpty, nil)
	}
	return score, nil
}

// AlignedWord 是强制对齐给出的一个字（拉丁文为一个词）及其起止秒数。
type AlignedWord struct {
	Word  string  `json:"word"`
	Start float64 `json:"start"`
	End   float64 `json:"end"`
}

// alignerRate 是 Qwen3 Forced Aligner 的输入采样率，返回的时间也以这个采样率的样本数计。
const alignerRate = 16000

// lyricStage 在歌词对齐模型包里找出某一步的模型文件，并给出启动内核所需的家族与任务。
func lyricStage(m schema.InstalledModel, prefix, family, task string) (string, catalog.ModelPackage, error) {
	definition, err := catalog.Lookup(m.ID)
	if err != nil {
		return "", definition, err
	}
	if definition.Family != "lyric_align" {
		return "", definition, msg.Err(msg.ErrModelUnsupported, nil)
	}
	for _, f := range definition.Files {
		if strings.HasPrefix(f.Path, prefix) {
			return filepath.Join(m.Path, filepath.FromSlash(f.Path)), catalog.ModelPackage{ID: definition.ID, Family: family, Task: task}, nil
		}
	}
	return "", definition, msg.Err(msg.ErrModelUnsupported, nil)
}

// SeparateVocals 用歌词对齐模型包里的 BS-RoFormer 从混音分出人声，写到 output；input 须为 44.1 kHz WAV。
func (e *Engine) SeparateVocals(ctx context.Context, executable string, m schema.InstalledModel, backend, input, output string, progress func(msg.Code, msg.Params)) (err error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	defer func() {
		if err != nil {
			e.stop()
		}
	}()
	path, definition, err := lyricStage(m, "BS-RoFormer", "bs_roformer", "sep")
	if err != nil {
		return err
	}
	// 包内默认 4 次重叠推理是为了分轨音质；对齐只需要听得清人声，单遍推理快约 4 倍。
	definition.SessionOptions = map[string]string{"bs_roformer.num_overlap": "1"}
	if err = e.start(ctx, executable, path, definition, backend, false, 0, progress); err != nil {
		return err
	}
	progress(msg.ActivitySeparateVocals, nil)
	result, err := e.run(ctx, map[string]any{"model": "index", "request": map[string]any{"audio": input}})
	if err != nil {
		return err
	}
	for _, stem := range result.Stems {
		if stem.ID != "vocals" {
			continue
		}
		b, err := base64.StdEncoding.DecodeString(stem.Audio)
		if err != nil || len(b) <= 44 {
			return msg.Err(msg.ErrEngineNoAudio, nil)
		}
		return os.WriteFile(output, b, 0600)
	}
	return msg.Err(msg.ErrEngineNoAudio, nil)
}

// AlignWords 用歌词对齐模型包里的 Qwen3 Forced Aligner 把 text 逐字对到 wav（16 kHz 人声）上；
// language 是 Chinese、English 这类英文语言名。返回的时间相对于 wav 开头。
func (e *Engine) AlignWords(ctx context.Context, executable string, m schema.InstalledModel, backend, wav, text, language string, progress func(msg.Code, msg.Params)) (words []AlignedWord, err error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	defer func() {
		if err != nil {
			e.stop()
		}
	}()
	path, definition, err := lyricStage(m, "Qwen3-ForcedAligner", "qwen3_forced_aligner", "align")
	if err != nil {
		return nil, err
	}
	if err = e.start(ctx, executable, path, definition, backend, false, 0, progress); err != nil {
		return nil, err
	}
	result, err := e.run(ctx, map[string]any{"model": "index", "request": map[string]any{"audio": wav, "text": text, "language": language,
		"options": map[string]string{"clamp_timestamps_to_audio": "true"}}})
	if err != nil {
		return nil, err
	}
	for _, w := range result.Words {
		words = append(words, AlignedWord{Word: w.Word, Start: float64(w.StartSample) / alignerRate, End: float64(w.EndSample) / alignerRate})
	}
	return words, nil
}

// taskResult 是 /v1/tasks/run 的结果：音频为 base64 WAV，附加产物（如 ABC 谱）也以 base64 承载；
// 分离任务的各个分轨在 named_audio_outputs，对齐任务的逐字时间在 words（以样本数计）。
type taskResult struct {
	Audio string `json:"audio"`
	Stems []struct {
		ID    string `json:"id"`
		Audio string `json:"audio"`
	} `json:"named_audio_outputs"`
	Words []struct {
		Word        string `json:"word"`
		StartSample int64  `json:"start_sample"`
		EndSample   int64  `json:"end_sample"`
	} `json:"words"`
	Artifacts []struct {
		ID      string            `json:"id"`
		Payload string            `json:"payload"`
		Meta    map[string]string `json:"meta"`
	} `json:"artifacts"`
}

// score 取出 ABC 格式的产物；YuE2 只在自己规划时附带，按给定谱演唱时没有。
func (r taskResult) score() (string, bool, bool) {
	for _, a := range r.Artifacts {
		if a.Meta["format"] != "abc" {
			continue
		}
		b, err := base64.StdEncoding.DecodeString(a.Payload)
		if err != nil || len(bytes.TrimSpace(b)) == 0 {
			continue
		}
		return string(b), a.Meta["truncated"] == "true", true
	}
	return "", false, false
}

// run 要求调用方持有 mu 且引擎已启动。
func (e *Engine) run(ctx context.Context, payload map[string]any) (taskResult, error) {
	var result taskResult
	b, err := json.Marshal(payload)
	if err != nil {
		return result, err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", e.endpoint+"v1/tasks/run", bytes.NewReader(b))
	if err != nil {
		return result, err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := e.client.Do(req)
	if err != nil {
		return result, e.crashed(ctx, err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		b, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
		_ = os.WriteFile(filepath.Join(e.root, "logs", "last-inference-error.txt"), b, 0600)
		return result, msg.Err(msg.ErrGenerateFailed, nil)
	}
	if err = json.NewDecoder(io.LimitReader(res.Body, 256<<20)).Decode(&result); err != nil {
		return result, e.crashed(ctx, err)
	}
	return result, nil
}

// crashed 判断推理中途断开的连接是不是引擎进程退出造成的：Windows 上表现为“远程主机强迫关闭了一个现有的连接”，
// 容易被误认为网络问题。引擎随即退出时改报“引擎意外退出”，并附上 engine.log 的最后一行（通常是断言或内存分配失败）；
// 等它退出也让退出日志先于调用方的 stop 记下，意外退出不会被记成主动停止。
func (e *Engine) crashed(ctx context.Context, err error) error {
	if ctx.Err() != nil {
		return err
	}
	var exit error
	select {
	case exit = <-e.done:
	case <-time.After(2 * time.Second):
		return err
	}
	detail := lastLogError(filepath.Join(e.root, "logs", "engine.log"))
	if detail == "" && exit != nil {
		detail = exit.Error()
	}
	if detail == "" {
		detail = err.Error()
	}
	return msg.Err(msg.ErrEngineCrashed, msg.Params{"detail": detail})
}

// lastLogError 返回本次引擎输出的最后一行错误（断言、内存不足等），只读最后 4 KB；没有时返回空。
func lastLogError(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	if info, err := f.Stat(); err == nil && info.Size() > 4096 {
		_, _ = f.Seek(-4096, io.SeekEnd)
	}
	b, _ := io.ReadAll(f)
	lines := strings.Split(strings.TrimSpace(string(b)), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		line := strings.TrimSpace(lines[i])
		if strings.HasPrefix(line, "=====") {
			return ""
		}
		lower := strings.ToLower(line)
		for _, mark := range []string{"assert", "error", "failed", "abort", "exception", "out of memory"} {
			if strings.Contains(lower, mark) {
				if len(line) > 300 {
					line = line[:300]
				}
				return line
			}
		}
	}
	return ""
}
