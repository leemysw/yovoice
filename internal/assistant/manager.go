// Package assistant 管理内置创作助手的 ocho 子进程：按需启动、随配置重启、
// 读写 stream-json 并把 ocho 的 MCP 消息桥接到进程内 server。与 engine 同层，不依赖应用层。
package assistant

import (
	"context"
	"strings"
	"sync"
	"yovoice/internal/msg"

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
