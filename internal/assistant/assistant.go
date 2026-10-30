// Package assistant 管理内置创作助手的 ocho 子进程：按需启动、随配置重启、
// 读写 stream-json 并把 ocho 的 MCP 消息桥接到进程内 server。与 engine 同层，不依赖应用层。
package assistant

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
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

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Options 描述助手进程的固定形态：可用的工具白名单与提供进程内 MCP server 的方式。
type Options struct {
	// Tools 是允许助手使用的 MCP 工具名（不含 mcp__yovoice__ 前缀）。
	Tools []string
	// NewServer 在每次启动子进程时创建进程内 MCP server，宿主把工具注册在上面。
	NewServer func() *mcp.Server
	// ExtraEnv 是额外传给子进程的环境变量；测试用它注入假运行时的开关。
	ExtraEnv []string
}

// Config 是一轮对话所需的运行环境：Executable 或 Env 变化时重启进程，Model 变化用 set_model 切换。
// Env 携带密钥，只传给子进程，不得写入命令行与日志。
type Config struct {
	Executable string
	Model      string
	Env        []string
}

func (c Config) key() string {
	return c.Executable + "\x00" + strings.Join(c.Env, "\x00")
}

// EventKind 标记事件的种类。
type EventKind int

const (
	// EventMessage 是一段定稿的助手消息内容：按顺序的文本、思考与工具调用块，
	// 覆盖此前同一段的流式增量。
	EventMessage EventKind = iota
	EventTextDelta
	EventThinkingDelta
	EventToolResult
)

// PartKind 标记助手消息内容块的种类。
type PartKind string

const (
	PartText     PartKind = "text"
	PartThinking PartKind = "thinking"
	PartTool     PartKind = "tool"
)

// Part 是定稿的助手消息里的一块：文本、思考，或一次工具调用（工具名与截断的参数摘要）。
type Part struct {
	Kind PartKind
	Text string
	Tool string
	Args string
}

// Event 是助手运行中的一段进展：定稿的消息内容块、流式文本或思考增量、工具结果（是否出错）。
type Event struct {
	Kind      EventKind
	Parts     []Part
	Text      string
	Tool      string
	ToolError bool
}

// Result 是一轮对话的结束：Subtype 为 success 或 error_*，Text 为本轮助手文本。
type Result struct {
	Subtype string
	Text    string
}

// Manager 管理常驻 ocho 子进程；同一时间只运行一轮 Ask，服务退出时调用 Stop 结束进程。
type Manager struct {
	root    string
	options Options
	mu      sync.Mutex
	proc    *process
	asking  bool
}

func New(root string, options Options) *Manager {
	ReapOrphan(root)
	return &Manager{root: root, options: options}
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

func (m *Manager) Stop() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.stopLocked()
}

// stopLocked 要求调用方持有 mu。
func (m *Manager) stopLocked() {
	if m.proc != nil {
		m.proc.stop()
		m.proc = nil
	}
}

// Ask 发送一条用户消息并等到本轮 result。同一时间只允许一轮，忙时返回 ErrBusy；
// ctx 取消时向 ocho 发 interrupt 并等本轮 result 后返回 ctx 的错误。
func (m *Manager) Ask(ctx context.Context, cfg Config, text string, onEvent func(Event)) (Result, error) {
	m.mu.Lock()
	if m.asking {
		m.mu.Unlock()
		return Result{}, msg.Err(msg.ErrBusy, nil)
	}
	m.asking = true
	defer func() {
		m.mu.Lock()
		m.asking = false
		m.mu.Unlock()
	}()
	proc, err := m.ensureProcess(ctx, cfg)
	m.mu.Unlock()
	if err != nil {
		return Result{}, err
	}
	result, err := proc.ask(ctx, text, onEvent)
	// 本轮里进程已退出时顺手清掉，下次 Ask 重新启动。
	m.mu.Lock()
	if err != nil && m.proc == proc {
		select {
		case <-proc.done:
			m.stopLocked()
		default:
		}
	}
	m.mu.Unlock()
	return result, err
}

// ensureProcess 确保有一个匹配 cfg 的进程并完成握手；调用方持有 mu，返回前保持持有。
func (m *Manager) ensureProcess(ctx context.Context, cfg Config) (*process, error) {
	if m.proc != nil {
		select {
		case <-m.proc.done:
			m.stopLocked()
		default:
		}
	}
	if m.proc != nil {
		switch {
		case m.proc.cfg.key() != cfg.key():
			m.stopLocked()
		case m.proc.cfg.Model != cfg.Model:
			if err := m.proc.setModel(ctx, cfg.Model); err == nil {
				return m.proc, nil
			}
			m.stopLocked()
		default:
			return m.proc, nil
		}
	}
	proc, err := startProcess(ctx, m.root, m.options, cfg)
	if err != nil {
		return nil, err
	}
	m.proc = proc
	return proc, nil
}

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

type turnState struct {
	result  chan Result
	onEvent func(Event)
	text    strings.Builder
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

// requestID 生成宿主发起的 control_request ID，如 init-1、interrupt-3。
func (p *process) requestID(kind string) string {
	return kind + "-" + strconv.FormatInt(p.seq.Add(1), 10)
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

// writeLine 向 ocho 的 stdin 写一行 JSON。
func (p *process) writeLine(payload any) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	p.writeMu.Lock()
	defer p.writeMu.Unlock()
	if p.fatal != nil {
		return p.fatal
	}
	_, err = p.stdin.Write(append(data, '\n'))
	return err
}

// call 发送一个 control_request 并等待对应的 control_response。
func (p *process) call(ctx context.Context, id string, request any) (wireControlResponse, error) {
	ch := make(chan wireControlResponse, 1)
	p.ctrlMu.Lock()
	p.waiters[id] = ch
	p.ctrlMu.Unlock()
	if err := p.writeLine(map[string]any{"type": "control_request", "request_id": id, "request": request}); err != nil {
		p.ctrlMu.Lock()
		delete(p.waiters, id)
		p.ctrlMu.Unlock()
		return wireControlResponse{}, err
	}
	select {
	case res := <-ch:
		if res.Subtype != "success" {
			return res, msg.Err(msg.ErrAIResponse, msg.Params{"status": 0, "detail": "control request " + id + " failed: " + res.Subtype})
		}
		return res, nil
	case <-ctx.Done():
		p.ctrlMu.Lock()
		delete(p.waiters, id)
		p.ctrlMu.Unlock()
		return wireControlResponse{}, ctx.Err()
	case <-p.done:
		// done 关闭前读循环已派发完全部输出；响应与退出同时就绪时 select 随机选边，这里优先取响应。
		select {
		case res := <-ch:
			if res.Subtype != "success" {
				return res, msg.Err(msg.ErrAIResponse, msg.Params{"status": 0, "detail": "control request " + id + " failed: " + res.Subtype})
			}
			return res, nil
		default:
		}
		return wireControlResponse{}, p.exitError("waiting for control response")
	}
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

// ask 发送用户消息并等到本轮 result；助手文本在等待期间累积进 Result.Text。
func (p *process) ask(ctx context.Context, text string, onEvent func(Event)) (Result, error) {
	if onEvent == nil {
		onEvent = func(Event) {}
	}
	state := &turnState{result: make(chan Result, 1), onEvent: onEvent}
	p.turnMu.Lock()
	p.turn = state
	p.turnMu.Unlock()
	// 本轮结束（含取消、出错）后解除绑定：迟到的增量与结果不得派发给已结束的一轮。
	defer func() {
		p.turnMu.Lock()
		if p.turn == state {
			p.turn = nil
		}
		p.turnMu.Unlock()
	}()
	if err := p.writeLine(map[string]any{"type": "user", "message": map[string]any{"role": "user", "content": text}}); err != nil {
		return Result{}, err
	}
	finish := func(res Result) (Result, error) {
		if res.Subtype != "success" {
			return Result{Subtype: res.Subtype}, msg.Err(msg.ErrAIResponse, msg.Params{"status": 0, "detail": "turn ended with " + res.Subtype})
		}
		return Result{Subtype: res.Subtype, Text: state.text.String()}, nil
	}
	select {
	case res := <-state.result:
		return finish(res)
	case <-p.done:
		// done 关闭前读循环已派发完全部输出；result 与退出同时就绪时 select 随机选边，这里优先取 result。
		select {
		case res := <-state.result:
			return finish(res)
		default:
		}
		return Result{}, p.exitError("during turn")
	case <-ctx.Done():
		// 取消后调用方不再关心本轮输出：先停止派发，再请 ocho 中断，最多等一小段时间拿 result，拿不到就结束进程。
		p.turnMu.Lock()
		state.onEvent = nil
		p.turnMu.Unlock()
		interruptCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = p.call(interruptCtx, p.requestID("interrupt"), map[string]any{"subtype": "interrupt"})
		select {
		case <-state.result:
		case <-time.After(5 * time.Second):
			p.stop()
		}
		return Result{}, ctx.Err()
	}
}

// wireControlResponse 是 control_response 的 response 部分。
type wireControlResponse struct {
	Subtype   string          `json:"subtype"`
	RequestID string          `json:"request_id"`
	Response  json.RawMessage `json:"response"`
	Error     string          `json:"error"`
}

// wireControlRequest 是 control_request 的 request 部分。
type wireControlRequest struct {
	Subtype    string          `json:"subtype"`
	ServerName string          `json:"server_name"`
	Message    json.RawMessage `json:"message"`
}

// readLoop 逐行读取 ocho 的 stdout 并分发消息，直到读到 EOF（子进程退出且写端全部关闭）或协议出错。
func (p *process) readLoop(stdout io.Reader) {
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 64*1024), 16<<20)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(strings.TrimSpace(string(line))) == 0 {
			continue
		}
		var head struct {
			Type      string               `json:"type"`
			RequestID string               `json:"request_id"`
			Request   *wireControlRequest  `json:"request"`
			Response  *wireControlResponse `json:"response"`
			Message   *struct {
				Role    string          `json:"role"`
				Content json.RawMessage `json:"content"`
			} `json:"message"`
			Subtype string          `json:"subtype"`
			Event   *streamRawEvent `json:"event"`
		}
		if err := json.Unmarshal(line, &head); err != nil {
			p.fail(fmt.Errorf("invalid stream-json line: %.120s", line))
			return
		}
		switch head.Type {
		case "control_request":
			p.handleControlRequest(head.RequestID, head.Request)
		case "control_response":
			if body := head.Response; body != nil {
				p.ctrlMu.Lock()
				ch := p.waiters[body.RequestID]
				if ch != nil {
					delete(p.waiters, body.RequestID)
				}
				p.ctrlMu.Unlock()
				if ch != nil {
					ch <- *body
				}
			}
		case "assistant":
			if head.Message != nil {
				if parts := p.messageParts(head.Message.Content); len(parts) > 0 {
					p.emit(Event{Kind: EventMessage, Parts: parts})
				}
			}
		case "stream_event":
			if kind, text := streamDelta(head.Event); text != "" {
				p.emit(Event{Kind: kind, Text: text})
			}
		case "tool_progress", "system":
			// 工具进度与系统事件不影响对话内容。
		case "user":
			if head.Message != nil {
				p.noteToolResults(head.Message.Content)
			}
		case "result":
			// 拿到结果即解除本轮绑定，此后读到的迟到增量不会派发给已结束的一轮。
			p.turnMu.Lock()
			state := p.turn
			p.turn = nil
			p.turnMu.Unlock()
			if state != nil {
				select {
				case state.result <- Result{Subtype: head.Subtype}:
				default:
				}
			}
		default:
			diag.Log(p.root, "assistant.unknown_message", "type", head.Type)
		}
	}
	if err := scanner.Err(); err != nil {
		p.fail(fmt.Errorf("reading assistant output: %v", err))
	}
}

// handleControlRequest 处理 ocho 发来的 control_request：mcp_message 桥接到进程内 server，其余回 error 不卡住。
func (p *process) handleControlRequest(id string, request *wireControlRequest) {
	if request == nil || id == "" {
		return
	}
	if request.Subtype == "mcp_message" {
		if err := p.bridge.handle(id, request.Message); err != nil {
			diag.Log(p.root, "assistant.mcp_bridge_failed", "error", diag.Error(err))
		}
		return
	}
	_ = p.writeLine(map[string]any{"type": "control_response", "response": map[string]any{"subtype": "error", "request_id": id, "error": "unsupported control request: " + request.Subtype}})
}

// emit 在锁内取到本轮状态后派发事件，并累积助手文本。
func (p *process) emit(e Event) {
	p.turnMu.Lock()
	state := p.turn
	var onEvent func(Event)
	if state != nil {
		for _, part := range e.Parts {
			if part.Kind == PartText {
				state.text.WriteString(part.Text)
			}
		}
		onEvent = state.onEvent
	}
	p.turnMu.Unlock()
	if onEvent != nil {
		onEvent(e)
	}
}

// contentBlock 是聊天消息 content 数组里的一块。
type contentBlock struct {
	Type     string          `json:"type"`
	Text     string          `json:"text"`
	Thinking string          `json:"thinking"`
	ID       string          `json:"id"`
	Name     string          `json:"name"`
	Input    json.RawMessage `json:"input"`
}

func contentBlocks(content json.RawMessage) []contentBlock {
	var blocks []contentBlock
	if json.Unmarshal(content, &blocks) != nil {
		return nil
	}
	return blocks
}

// streamRawEvent 是 --include-partial-messages 输出的原始增量事件；这里只关心文本与思考增量。
type streamRawEvent struct {
	Type  string `json:"type"`
	Delta *struct {
		Type     string `json:"type"`
		Text     string `json:"text"`
		Thinking string `json:"thinking"`
	} `json:"delta"`
}

// streamDelta 从流式事件里取出文本或思考增量；其余事件返回空串。
func streamDelta(event *streamRawEvent) (EventKind, string) {
	if event == nil || event.Type != "content_block_delta" || event.Delta == nil {
		return 0, ""
	}
	switch event.Delta.Type {
	case "text_delta":
		return EventTextDelta, event.Delta.Text
	case "thinking_delta":
		return EventThinkingDelta, event.Delta.Thinking
	}
	return 0, ""
}

// messageParts 把一条助手消息的 content 转成按顺序的内容块，并记录 tool_use 的 ID 供结果对应。
// content 为纯字符串时视为一段文本。
func (p *process) messageParts(content json.RawMessage) []Part {
	var text string
	if json.Unmarshal(content, &text) == nil {
		if text == "" {
			return nil
		}
		return []Part{{Kind: PartText, Text: text}}
	}
	var parts []Part
	for _, block := range contentBlocks(content) {
		switch block.Type {
		case "text":
			if block.Text != "" {
				parts = append(parts, Part{Kind: PartText, Text: block.Text})
			}
		case "thinking":
			if block.Thinking != "" {
				parts = append(parts, Part{Kind: PartThinking, Text: block.Thinking})
			}
		case "tool_use":
			name := strings.TrimPrefix(block.Name, "mcp__yovoice__")
			p.toolsMu.Lock()
			p.toolIDs[block.ID] = name
			p.toolsMu.Unlock()
			parts = append(parts, Part{Kind: PartTool, Tool: name, Args: clipJSON(block.Input, 600)})
		}
	}
	return parts
}

// clipJSON 压缩并截断一段 JSON，超长时保留前缀并标注省略。
func clipJSON(raw json.RawMessage, limit int) string {
	var compact bytes.Buffer
	if err := json.Compact(&compact, raw); err != nil {
		return ""
	}
	if r := []rune(compact.String()); len(r) > limit {
		return string(r[:limit]) + "…"
	}
	return compact.String()
}

// noteToolResults 对外通知工具结果是否出错（tool_result 块出现在回给模型的 user 消息里）。
func (p *process) noteToolResults(content json.RawMessage) {
	var blocks []struct {
		Type      string `json:"type"`
		ToolUseID string `json:"tool_use_id"`
		IsError   bool   `json:"is_error"`
	}
	if json.Unmarshal(content, &blocks) != nil {
		return
	}
	for _, block := range blocks {
		if block.Type != "tool_result" {
			continue
		}
		p.toolsMu.Lock()
		name := p.toolIDs[block.ToolUseID]
		delete(p.toolIDs, block.ToolUseID)
		p.toolsMu.Unlock()
		p.emit(Event{Kind: EventToolResult, Tool: name, ToolError: block.IsError})
	}
}
