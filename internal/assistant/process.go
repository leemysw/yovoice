package assistant

import (
	"context"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"yovoice/internal/diag"
	"yovoice/internal/msg"
	"yovoice/internal/platform"
)

// process 是一个运行中的 ocho 子进程及其协议连接。
type process struct {
	root string
	cfg  Config
	cmd  *exec.Cmd
	done chan struct{}

	writeMu  sync.Mutex
	stdin    io.WriteCloser
	fatal    error
	stopOnce sync.Once

	bridge *bridge

	// seq 生成宿主发起的 control_request ID；同一进程内不能重复，否则 waiters 会串。
	seq     atomic.Int64
	ctrlMu  sync.Mutex
	waiters map[string]chan wireControlResponse

	// turn 描述进行中的一轮：result 通道与事件回调；读循环在锁内取用。
	turnMu sync.Mutex
	turn   *turnState

	toolsMu sync.Mutex
	toolIDs map[string]string
}

func pidPath(root string) string { return filepath.Join(root, "assistant", "ocho.pid") }

// ReapOrphan 结束上次服务异常退出后残留的 ocho 进程。
// 只结束命令行包含本数据目录 system.md 路径的进程，避免误杀 PID 被复用的其他程序；
// 数据目录由 service.lock 独占，此时不可能有其他服务正在使用这个助手进程。
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
	if err != nil || !strings.Contains(command, systemPromptPath(root)) {
		return
	}
	platform.KillGroup(pid)
	diag.Log(root, "assistant.orphan_killed", "pid", pid)
}

// baseEnvNames 是子进程环境保留的最小集合：PATH、主目录与系统必需项，不继承宿主的其余环境。
var baseEnvNames = []string{
	"PATH", "HOME", "USERPROFILE", "USERNAME", "USERDOMAIN", "TMPDIR", "TMP", "TEMP",
	"LANG", "LC_ALL", "SYSTEMROOT", "SYSTEMDRIVE", "COMSPEC", "PATHEXT", "NUMBER_OF_PROCESSORS",
	"APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMW6432",
}

func childEnv(root string, options Options, extra []string) []string {
	have := map[string]bool{}
	for _, entry := range os.Environ() {
		have[entry[:strings.IndexByte(entry, '=')]] = true
	}
	env := make([]string, 0, len(baseEnvNames)+len(options.ExtraEnv)+len(slimEnv)+len(extra))
	for _, name := range baseEnvNames {
		if have[name] {
			env = append(env, name+"="+os.Getenv(name))
		}
	}
	env = append(env, options.ExtraEnv...)
	env = append(env, slimEnv...)
	return append(env, extra...)
}

// slimEnv 关掉 ocho 面向通用编程场景的能力：自动记忆与整理（偏好由 yovoice 自己保存）、内置子 agent、
// 后台任务、项目说明与 git 提示。系统提示因此缩短约三成，也避免后台模型的额外调用。
var slimEnv = []string{
	"OCHO_DISABLE_AUTO_MEMORY=1", "OCHO_DISABLE_AUTO_DREAM=1", "OCHO_AGENT_SDK_DISABLE_BUILTIN_AGENTS=1",
	"OCHO_DISABLE_BACKGROUND_TASKS=1", "OCHO_DISABLE_PROJECT_INSTRUCTIONS=1", "OCHO_DISABLE_GIT_INSTRUCTIONS=1",
}

func systemPromptPath(root string) string { return filepath.Join(root, "assistant", "system.md") }

// baseTools 是助手可用的 ocho 内置工具。
var baseTools = []string{"Skill", "Read", "Write", "Edit", "Glob", "Grep", "Bash", "WebFetch", "WebSearch"}

func startProcess(ctx context.Context, root string, options Options, cfg Config) (*process, error) {
	if info, err := os.Stat(cfg.Executable); err != nil || !info.Mode().IsRegular() {
		return nil, msg.Err(msg.ErrAssistantMissing, nil)
	}
	if err := writeAssets(root); err != nil {
		return nil, err
	}
	// 子进程日志与服务日志放在一起，目录在这里创建。
	if err := os.MkdirAll(filepath.Join(root, "logs"), 0700); err != nil {
		return nil, err
	}
	workspace := filepath.Join(root, "assistant", "workspace")
	// 开放 yovoice 的 MCP 工具与常规 agent 工具（Skill、文件读写与搜索、命令行、联网）；
	// 计划模式、向用户提问、子 agent 等依赖交互界面的工具不给。
	tools := make([]string, 0, len(options.Tools)+len(baseTools)+1)
	for _, name := range options.Tools {
		tools = append(tools, "mcp__yovoice__"+name)
	}
	tools = append(tools, baseTools...)
	if runtime.GOOS == "windows" {
		tools = append(tools, "PowerShell")
	}
	list := strings.Join(tools, ",")
	cmd := exec.Command(cfg.Executable, "--print", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
		"--include-partial-messages", "--tools", list, "--allowedTools", list, "--model", cfg.Model, "--append-system-prompt-file", systemPromptPath(root))
	cmd.Dir = workspace
	cmd.Env = childEnv(root, options, cfg.Env)
	platform.ConfigureProcess(cmd)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	// stdout 用自建管道而不是 StdoutPipe：Wait 一看到进程退出就会关掉 StdoutPipe 的读端，
	// 读循环可能还没读完最后几行（例如 result）。自建管道由读循环读到 EOF 后自己关闭。
	pr, pw, err := os.Pipe()
	if err != nil {
		return nil, err
	}
	cmd.Stdout = pw
	stderr, err := diag.OpenProcessLog(filepath.Join(root, "logs", "assistant.log"), "assistant "+cfg.Model)
	if err != nil {
		pr.Close()
		pw.Close()
		return nil, err
	}
	cmd.Stderr = stderr
	if err = cmd.Start(); err != nil {
		pr.Close()
		pw.Close()
		stderr.Close()
		return nil, err
	}
	// 写端已交给子进程；父进程不再持有，子进程退出后读端才能读到 EOF。
	pw.Close()
	// 服务崩溃或被强制结束时不能留下助手进程：Windows 绑定作业对象，其他系统记录 PID 供下次启动清理。
	if err = platform.TieToParent(cmd); err != nil {
		diag.Log(root, "assistant.tie_failed", "error", diag.Error(err))
	}
	if err = os.WriteFile(pidPath(root), []byte(strconv.Itoa(cmd.Process.Pid)), 0600); err != nil {
		diag.Log(root, "assistant.pid_write_failed", "error", diag.Error(err))
	}
	p := &process{root: root, cfg: cfg, cmd: cmd, stdin: stdin, waiters: map[string]chan wireControlResponse{}, toolIDs: map[string]string{}}
	// done 只关闭不发值：先发值再关闭时，读走值的一方和随后检查 done 的一方之间有空档，会把已退出的进程当成还活着。
	p.done = make(chan struct{})
	// 命令行不含密钥，可安全记录；Env 不落日志。
	diag.Log(root, "assistant.started", "pid", cmd.Process.Pid, "model", cfg.Model, "tools", list)
	p.bridge = newBridge(context.Background(), root, options.NewServer(), p.writeLine)
	// readDone 在读循环结束后关闭；等待 goroutine 据此保证 done 关闭时本轮输出已全部派发。
	readDone := make(chan struct{})
	go func() {
		defer close(readDone)
		defer pr.Close()
		// 读循环 panic 时本轮不能悬着：转成错误结束进程，等待方据此得到“assistant exited”。
		if err := diag.Catch(root, "assistant.read", func() error { p.readLoop(pr); return nil }); err != nil {
			p.fail(err)
		}
	}()
	diag.Go(root, "assistant.wait", func() {
		defer close(p.done)
		defer stderr.Close()
		_ = cmd.Wait()
		// 进程退出后等读循环读到 EOF，让最后几行（含 result）先派发；
		// 孙进程继承了管道写端时 EOF 可能迟迟不来，最多等 3 秒。
		select {
		case <-readDone:
		case <-time.After(3 * time.Second):
		}
	})
	handshake, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if _, err = p.call(handshake, p.requestID("init"), map[string]any{"subtype": "initialize", "sdkMcpServers": []string{"yovoice"}}); err != nil {
		p.stop()
		return nil, err
	}
	return p, nil
}

// kill 结束子进程；进程已退出时跳过：PID 可能已被复用，按旧 PID 杀会误伤别的进程。
func (p *process) kill() {
	select {
	case <-p.done:
	default:
		platform.KillProcess(p.cmd)
	}
}

// stop 结束子进程并等待退出；幂等。
func (p *process) stop() {
	p.stopOnce.Do(func() {
		p.kill()
		<-p.done
		if p.bridge != nil {
			p.bridge.close()
		}
		_ = os.Remove(pidPath(p.root))
		diag.Log(p.root, "assistant.stopped", "model", p.cfg.Model)
	})
}

// fail 记录首个协议级致命错误并结束进程；后续解析错误不覆盖。
func (p *process) fail(err error) {
	p.writeMu.Lock()
	if p.fatal == nil {
		p.fatal = err
	}
	p.writeMu.Unlock()
	diag.Log(p.root, "assistant.protocol_failed", "error", diag.Error(err))
	p.kill()
}

// exitError 把进程退出翻译成带错误码的说明，优先给出协议失败原因。
func (p *process) exitError(what string) error {
	p.writeMu.Lock()
	detail := what
	if p.fatal != nil {
		detail = p.fatal.Error()
	}
	p.writeMu.Unlock()
	return msg.Err(msg.ErrAIResponse, msg.Params{"status": 0, "detail": detail + ": assistant exited"})
}

func (p *process) setModel(ctx context.Context, model string) error {
	if _, err := p.call(ctx, p.requestID("set-model"), map[string]any{"subtype": "set_model", "model": model}); err != nil {
		return err
	}
	p.cfg.Model = model
	diag.Log(p.root, "assistant.model_changed", "model", model)
	return nil
}
