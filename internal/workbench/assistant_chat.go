package workbench

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"
	"yovoice/internal/assistant"
	"yovoice/internal/diag"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
)

// 助手对话：多个会话（每个会话对应独立的助手子进程时间线），用户消息一轮一轮地跑，
// 运行中再发的消息排队到本轮结束后；流式文本与工具卡片经状态广播给界面，会话记录持久化（有上限）。

// AssistantContext 是界面随每条用户消息附带的上下文，后端拼成简短前缀发给助手，不展示给用户。
type AssistantContext struct {
	Page      string          `json:"page,omitempty"`
	WorkID    string          `json:"workId,omitempty"`
	WorkTitle string          `json:"workTitle,omitempty"`
	WorkKind  string          `json:"workKind,omitempty"`
	Locale    schema.UiLocale `json:"locale,omitempty"`
	// Selection 是用户在编辑区选中的文字；Cue 是故事配音里选中的台词；Playhead 是播放位置（秒）。
	Selection string        `json:"selection,omitempty"`
	Cue       *AssistantCue `json:"cue,omitempty"`
	Playhead  float64       `json:"playhead,omitempty"`
}

// AssistantCue 是故事配音里选中的一句台词：Index 从 1 开始。
type AssistantCue struct {
	Index   int    `json:"index"`
	Total   int    `json:"total"`
	Speaker string `json:"speaker,omitempty"`
	Text    string `json:"text,omitempty"`
}

// chatMessage 是排队中的一条用户消息，sessionID 记录它属于哪个会话。
type chatMessage struct {
	sessionID string
	text      string
	context   AssistantContext
}

// chatState 管理对话循环与当前一轮。
type chatState struct {
	mu      sync.Mutex
	running bool // 对话循环是否在运行
	stopped bool // 服务关闭后拒绝新消息
	cancel  context.CancelFunc
	queue   []chatMessage
	// turn 是当前一轮的实时数据；事件回调与工具处理器并发读写，由锁保护。
	turn *chatTurn
	// resolving 是正在执行确认操作的提议 ID：同一提议的重复确认在执行完成前被拒绝，不会执行两次。
	resolving map[string]bool
}

// SendAssistant 接收一条用户消息：写入当前会话（没有则新建）并开始（或排队）一轮助手回复。
func (w *Workbench) SendAssistant(text string, context AssistantContext) error {
	text = strings.TrimSpace(text)
	if text == "" || schema.TextLen(text) > 2000 {
		return msg.Err(msg.ErrRequestInvalid, nil)
	}
	if context.Locale != "" {
		if _, err := schema.ParseUiLocale(string(context.Locale)); err != nil {
			context.Locale = ""
		}
	}
	sessionID, err := w.ensureAssistantSession()
	if err != nil {
		return err
	}
	// 用户消息立即入库：标题取首条用户消息，会话时间随之更新。写不进去就不开始这一轮，让用户看到保存失败。
	now := time.Now().UTC()
	if err := w.Store.Update(func(s *schema.State) {
		session := assistantSessionByID(*s, sessionID)
		if session == nil {
			return
		}
		session.Messages = append(session.Messages, schema.AssistantMessage{ID: schema.NewID(), Role: "user", Text: text, CreatedAt: now})
		session.UpdatedAt = now
		if session.Title == "" {
			session.Title = sessionTitle(text)
		}
	}, true); err != nil {
		return err
	}
	w.chat.mu.Lock()
	if w.chat.stopped {
		w.chat.mu.Unlock()
		return msg.Err(msg.ErrBusy, nil)
	}
	w.chat.queue = append(w.chat.queue, chatMessage{sessionID: sessionID, text: text, context: context})
	start := !w.chat.running
	w.chat.running = true
	w.chat.mu.Unlock()
	w.publishQueued()
	if start {
		diag.Go(w.Store.Root, "assistant.chat", w.chatLoop)
	}
	return nil
}

// CancelAssistant 取消正在运行的一轮并清空排队；没有进行中的对话时什么都不做。
func (w *Workbench) CancelAssistant() {
	w.chat.mu.Lock()
	dropped := len(w.chat.queue)
	w.chat.queue = nil
	cancel := w.chat.cancel
	w.chat.mu.Unlock()
	if dropped > 0 {
		w.publishQueued()
	}
	if cancel != nil {
		diag.Log(w.Store.Root, "assistant.cancel_requested")
		cancel()
	}
}

// stopChat 取消进行中的对话并等待循环结束，服务关闭时调用。
func (w *Workbench) stopChat() {
	w.chat.mu.Lock()
	w.chat.stopped = true
	w.chat.queue = nil
	cancel := w.chat.cancel
	running := w.chat.running
	w.chat.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	deadline := time.After(15 * time.Second)
	for running {
		if cancel != nil {
			cancel()
		}
		select {
		case <-time.After(20 * time.Millisecond):
		case <-deadline:
			return
		}
		w.chat.mu.Lock()
		running = w.chat.running
		cancel = w.chat.cancel
		w.chat.mu.Unlock()
	}
}

// chatLoop 依次处理排队消息，队列清空后退出。
func (w *Workbench) chatLoop() {
	// 循环在一轮之外 panic（由 diag.Go 记录）时复位状态：running 留着为真，之后的消息就永远等不到新的循环。
	exited := false
	defer func() {
		if exited {
			return
		}
		w.chat.mu.Lock()
		w.chat.running, w.chat.cancel, w.chat.turn = false, nil, nil
		w.chat.mu.Unlock()
		w.publishLive(func(live *schema.AssistantLive) { live.Turn, live.Queued = nil, 0 })
	}()
	for {
		w.chat.mu.Lock()
		if w.chat.stopped || len(w.chat.queue) == 0 {
			w.chat.running = false
			w.chat.cancel = nil
			exited = true
			w.chat.mu.Unlock()
			w.publishLive(func(live *schema.AssistantLive) { live.Turn, live.Queued = nil, 0 })
			return
		}
		next := w.chat.queue[0]
		w.chat.queue = w.chat.queue[1:]
		ctx, cancel := context.WithCancel(context.Background())
		w.chat.cancel = cancel
		w.chat.mu.Unlock()
		// 一轮里的 panic 只让这一轮失败，循环继续处理后面的消息。
		if err := diag.Catch(w.Store.Root, "assistant.turn", func() error { w.runTurn(ctx, next); return nil }); err != nil {
			w.chat.mu.Lock()
			w.chat.turn = nil
			w.chat.mu.Unlock()
			var ce *msg.CallError
			errors.As(err, &ce)
			w.appendChat(next.sessionID, schema.AssistantMessage{ID: schema.NewID(), Role: "assistant", Status: "failed", ErrorCode: ce.Code, ErrorParams: ce.Params, CreatedAt: time.Now().UTC()})
			w.publishLive(func(live *schema.AssistantLive) { live.Turn = nil })
		}
		cancel()
	}
}

// runTurn 跑一轮：启动该会话的助手、实时广播、结束时把助手消息写回该会话。
func (w *Workbench) runTurn(parent context.Context, next chatMessage) {
	cfg, err := w.assistantConfig(next.sessionID)
	if err != nil {
		var ce *msg.CallError
		code, params := msg.ErrUnknown, msg.Params{"detail": err.Error()}
		if errors.As(err, &ce) {
			code, params = ce.Code, ce.Params
		}
		w.appendChat(next.sessionID, schema.AssistantMessage{ID: schema.NewID(), Role: "assistant", Status: "failed", ErrorCode: code, ErrorParams: params, CreatedAt: time.Now().UTC()})
		return
	}
	timeout := aiTimeout(w.Store.Read().Preferences)
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()
	turn := &chatTurn{model: cfg.Model, startedAt: time.Now().UTC(), locale: next.context.Locale}
	w.chat.mu.Lock()
	w.chat.turn = turn
	w.chat.mu.Unlock()
	w.publishLive(func(live *schema.AssistantLive) { live.Turn = turn.snapshot() })

	// 流式增量广播合流：状态推送带完整状态，逐字广播太频繁，这里按最小间隔合并。
	var lastDelta time.Time
	_, err = w.assistant.Ask(ctx, cfg, w.chatMessageText(next), func(e assistant.Event) {
		w.chat.mu.Lock()
		// 本轮已结束（取消后迟到的事件）时丢弃，避免覆盖下一轮的实时状态。
		if w.chat.turn != turn {
			w.chat.mu.Unlock()
			return
		}
		switch e.Kind {
		case assistant.EventMessage:
			turn.commit(e.Parts)
		case assistant.EventTextDelta:
			turn.stream("text", e.Text)
		case assistant.EventThinkingDelta:
			turn.stream("thinking", e.Text)
		case assistant.EventToolResult:
			turn.settleCard(e.Tool, e.ToolError)
		}
		snapshot := turn.snapshot()
		streaming := e.Kind == assistant.EventTextDelta || e.Kind == assistant.EventThinkingDelta
		coalesced := !streaming || time.Since(lastDelta) >= 60*time.Millisecond
		if coalesced {
			lastDelta = time.Now()
		}
		w.chat.mu.Unlock()
		if coalesced {
			w.publishLive(func(live *schema.AssistantLive) { live.Turn = snapshot })
		}
	})
	w.chat.mu.Lock()
	final := turn.snapshot()
	w.chat.turn = nil
	w.chat.mu.Unlock()

	reply := schema.AssistantMessage{ID: schema.NewID(), Role: "assistant", Text: blocksText(final.Blocks), Blocks: final.Blocks, CreatedAt: time.Now().UTC()}
	switch {
	case err == nil:
		reply.Status = "completed"
	case errors.Is(parent.Err(), context.Canceled):
		reply.Status = "cancelled"
	case errors.Is(ctx.Err(), context.DeadlineExceeded):
		reply.Status = "failed"
		reply.ErrorCode, reply.ErrorParams = msg.ErrAITimeout, msg.Params{"seconds": int(timeout.Seconds())}
	default:
		reply.Status = "failed"
		var ce *msg.CallError
		if errors.As(err, &ce) {
			reply.ErrorCode, reply.ErrorParams = ce.Code, ce.Params
		} else {
			reply.ErrorCode, reply.ErrorParams = msg.ErrUnknown, msg.Params{"detail": err.Error()}
		}
	}
	diag.Log(w.Store.Root, "assistant.turn_finished", "status", reply.Status, "session_id", next.sessionID, "error", diag.Error(err))
	// 先写入回复再清除实时状态：界面看到的“空闲”帧一定带着本轮的助手消息。
	w.appendChat(next.sessionID, reply)
	w.publishLive(func(live *schema.AssistantLive) { live.Turn = nil })
}
