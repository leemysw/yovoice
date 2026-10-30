package workbench

import (
	"context"
	"time"
	"yovoice/internal/diag"
	"yovoice/internal/llm"
	"yovoice/internal/msg"
)

// CodexStatus 检测本机 Codex CLI 的安装与登录状态，供设置页显示。
func (w *Workbench) CodexStatus(ctx context.Context) llm.CodexInfo {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	info := llm.CodexStatus(ctx)
	diag.Log(w.Store.Root, "ai.codex_status", "installed", info.Path != "", "version", info.Version, "login", info.Login)
	return info
}

// LoginCodex 在后台运行 `codex login`，由 CLI 打开浏览器完成 ChatGPT 登录后立即返回；
// 同一时间只保留一次登录，服务关闭时结束。界面在用户完成登录后重新检测状态。
func (w *Workbench) LoginCodex() error {
	w.ai.mu.Lock()
	defer w.ai.mu.Unlock()
	if w.ai.codexLogin != nil {
		return msg.Err(msg.ErrBusy, nil)
	}
	ctx, cancel := context.WithCancel(context.Background())
	w.ai.codexLogin = cancel
	diag.Log(w.Store.Root, "ai.codex_login_started")
	go func() {
		started := time.Now()
		err := diag.Catch(w.Store.Root, "ai.codex_login", func() error { return llm.CodexLogin(ctx) })
		diag.Log(w.Store.Root, "ai.codex_login_finished", "elapsed_ms", time.Since(started).Milliseconds(), "error", diag.Error(err))
		w.ai.mu.Lock()
		w.ai.codexLogin = nil
		w.ai.mu.Unlock()
		cancel()
	}()
	return nil
}
