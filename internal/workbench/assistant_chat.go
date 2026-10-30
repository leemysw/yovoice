package workbench

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"sort"
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
}

// chatTurn 是一轮对话的实时状态：blocks 为已定稿的内容块，pending 为尚未定稿的流式增量
// （收到对应的定稿消息时整体替换）。
type chatTurn struct {
	blocks    []schema.AssistantBlock
	pending   []schema.AssistantBlock
	locale    schema.UiLocale // 界面语言，工具卡片摘要据此选择
	model     string
	startedAt time.Time
}

// assistantSessionDir 返回某个会话的助手子进程配置目录。
func assistantSessionDir(root, sessionID string) string {
	return filepath.Join(root, "assistant", "sessions", sessionID)
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
	// 用户消息立即入库：标题取首条用户消息，会话时间随之更新。
	now := time.Now().UTC()
	_ = w.Store.Update(func(s *schema.State) {
		session := assistantSessionByID(*s, sessionID)
		if session == nil {
			return
		}
		session.Messages = append(session.Messages, schema.AssistantMessage{ID: schema.NewID(), Role: "user", Text: text, CreatedAt: now})
		session.UpdatedAt = now
		if session.Title == "" {
			session.Title = sessionTitle(text)
		}
	}, true)
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
		go w.chatLoop()
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

// NewAssistantSession 新建空会话并设为当前；超过上限时删除最旧的会话及其配置目录。
func (w *Workbench) NewAssistantSession() (schema.AssistantSession, error) {
	session := schema.AssistantSession{ID: schema.NewID(), Messages: []schema.AssistantMessage{}, UpdatedAt: time.Now().UTC()}
	var removed []string
	err := w.Store.Update(func(s *schema.State) {
		if s.AssistantSessions == nil {
			s.AssistantSessions = &schema.AssistantSessions{}
		}
		s.AssistantSessions.Sessions = append([]schema.AssistantSession{session}, s.AssistantSessions.Sessions...)
		s.AssistantSessions.CurrentID = session.ID
		if excess := len(s.AssistantSessions.Sessions) - schema.AssistantSessionLimit; excess > 0 {
			for _, old := range s.AssistantSessions.Sessions[len(s.AssistantSessions.Sessions)-excess:] {
				removed = append(removed, old.ID)
			}
			s.AssistantSessions.Sessions = s.AssistantSessions.Sessions[:len(s.AssistantSessions.Sessions)-excess]
		}
	}, true)
	for _, id := range removed {
		_ = os.RemoveAll(assistantSessionDir(w.Store.Root, id))
	}
	return session, err
}

// OpenAssistantSession 切换到某个会话；下一轮对话用该会话的助手时间线（子进程按配置目录重启）。
func (w *Workbench) OpenAssistantSession(id string) error {
	if assistantSessionByID(w.Store.Read(), id) == nil {
		return msg.Err(msg.ErrRequestInvalid, nil)
	}
	return w.Store.Update(func(s *schema.State) {
		if s.AssistantSessions != nil {
			s.AssistantSessions.CurrentID = id
		}
	}, true)
}

// DeleteAssistantSession 删除某个会话及其配置目录；删的是当前会话时切到最近更新的其余会话。
func (w *Workbench) DeleteAssistantSession(id string) error {
	found := false
	err := w.Store.Update(func(s *schema.State) {
		if s.AssistantSessions == nil {
			return
		}
		sessions := make([]schema.AssistantSession, 0, len(s.AssistantSessions.Sessions))
		for _, session := range s.AssistantSessions.Sessions {
			if session.ID == id {
				found = true
				continue
			}
			sessions = append(sessions, session)
		}
		s.AssistantSessions.Sessions = sessions
		if s.AssistantSessions.CurrentID == id {
			s.AssistantSessions.CurrentID = ""
			if len(sessions) > 0 {
				current := sessions[0]
				for _, session := range sessions {
					if session.UpdatedAt.After(current.UpdatedAt) {
						current = session
					}
				}
				s.AssistantSessions.CurrentID = current.ID
			}
		}
	}, true)
	if !found {
		return msg.Err(msg.ErrRequestInvalid, nil)
	}
	_ = os.RemoveAll(assistantSessionDir(w.Store.Root, id))
	return err
}

// ensureAssistantSession 返回当前会话 ID；没有会话时新建一个。
func (w *Workbench) ensureAssistantSession() (string, error) {
	if s := w.Store.Read(); s.AssistantSessions != nil && assistantSessionByID(s, s.AssistantSessions.CurrentID) != nil {
		return s.AssistantSessions.CurrentID, nil
	}
	session, err := w.NewAssistantSession()
	return session.ID, err
}

// assistantSessionByID 在状态里查找会话。
func assistantSessionByID(s schema.State, id string) *schema.AssistantSession {
	if s.AssistantSessions == nil {
		return nil
	}
	for i := range s.AssistantSessions.Sessions {
		if s.AssistantSessions.Sessions[i].ID == id {
			return &s.AssistantSessions.Sessions[i]
		}
	}
	return nil
}

// sessionTitle 由首条用户消息生成会话标题：去掉换行后截取前 24 个字。
func sessionTitle(text string) string {
	first := strings.TrimSpace(strings.SplitN(text, "\n", 2)[0])
	runes := []rune(first)
	if len(runes) > 24 {
		return string(runes[:24]) + "…"
	}
	return first
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
	for {
		w.chat.mu.Lock()
		if w.chat.stopped || len(w.chat.queue) == 0 {
			w.chat.running = false
			w.chat.cancel = nil
			w.chat.mu.Unlock()
			w.publishLive(func(live *schema.AssistantLive) { live.Turn, live.Queued = nil, 0 })
			return
		}
		next := w.chat.queue[0]
		w.chat.queue = w.chat.queue[1:]
		ctx, cancel := context.WithCancel(context.Background())
		w.chat.cancel = cancel
		w.chat.mu.Unlock()
		w.runTurn(ctx, next)
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

// chatCard 供助手工具更新当前轮的工具卡片：state 为 running、done 或 error；没有运行中的一轮时忽略。
// summary 提供 zh 与 en 两种文案，按界面语言选择。
func (w *Workbench) chatCard(tool, summaryZH, summaryEN, state string) {
	w.noteChatCard(tool, summaryZH, summaryEN, state, nil)
}

// chatProposal 在当前轮登记一张待确认的提议卡片。
func (w *Workbench) chatProposal(tool, summaryZH, summaryEN string, proposal *schema.AssistantProposal) {
	w.noteChatCard(tool, summaryZH, summaryEN, "done", proposal)
}

func (w *Workbench) noteChatCard(tool, summaryZH, summaryEN, state string, proposal *schema.AssistantProposal) {
	w.chat.mu.Lock()
	turn := w.chat.turn
	var snapshot *schema.AssistantTurn
	if turn != nil {
		summary := summaryZH
		if turn.locale == schema.UiLocaleEn {
			summary = summaryEN
		}
		turn.noteCard(tool, summary, state, proposal)
		snapshot = turn.snapshot()
	}
	w.chat.mu.Unlock()
	if snapshot != nil {
		w.publishLive(func(live *schema.AssistantLive) { live.Turn = snapshot })
	}
}

// chatNav 让界面跳到某作品或页面；ID 每次变化即新事件。
func (w *Workbench) chatNav(workID, page string) {
	nav := &schema.AssistantNav{ID: schema.NewID(), WorkID: workID, Page: page}
	w.publishLive(func(live *schema.AssistantLive) { live.Nav = nav })
}

// chatUpdate 通知界面：作品刚被助手保存，正打开的编辑器应刷新。
func (w *Workbench) chatUpdate(workID string) {
	update := &schema.AssistantUpdate{ID: schema.NewID(), WorkID: workID}
	w.publishLive(func(live *schema.AssistantLive) { live.Update = update })
}

// publishQueued 广播当前排队条数。
func (w *Workbench) publishQueued() {
	w.chat.mu.Lock()
	queued := len(w.chat.queue)
	w.chat.mu.Unlock()
	w.publishLive(func(live *schema.AssistantLive) { live.Queued = queued })
}

// publishLive 只在内存中更新助手的实时状态并广播。
func (w *Workbench) publishLive(change func(*schema.AssistantLive)) {
	_ = w.Store.Update(func(s *schema.State) {
		if s.AssistantLive == nil {
			s.AssistantLive = &schema.AssistantLive{}
		}
		live := *s.AssistantLive
		change(&live)
		s.AssistantLive = &live
	}, false)
}

// appendChat 把一条消息追加进某个会话并持久化；会话已被删除时丢弃，超过上限时丢弃最旧的消息。
func (w *Workbench) appendChat(sessionID string, m schema.AssistantMessage) {
	now := time.Now().UTC()
	_ = w.Store.Update(func(s *schema.State) {
		session := assistantSessionByID(*s, sessionID)
		if session == nil {
			return
		}
		session.Messages = append(session.Messages, m)
		if excess := len(session.Messages) - schema.AssistantChatLimit; excess > 0 {
			session.Messages = session.Messages[excess:]
		}
		session.UpdatedAt = now
	}, true)
}

// snapshot 返回可安全广播的实时状态副本（定稿块在前、流式增量在后）；调用方持有 chat.mu。
func (t *chatTurn) snapshot() *schema.AssistantTurn {
	turn := &schema.AssistantTurn{Model: t.model, StartedAt: t.startedAt}
	for _, list := range [][]schema.AssistantBlock{t.blocks, t.pending} {
		for _, block := range list {
			if block.Card != nil {
				card := *block.Card
				block.Card = &card
			}
			turn.Blocks = append(turn.Blocks, block)
		}
	}
	return turn
}

// stream 追加一段流式增量：与上一段同类时接上，否则开新的一块；调用方持有 chat.mu。
func (t *chatTurn) stream(kind, text string) {
	if n := len(t.pending); n > 0 && t.pending[n-1].Kind == kind {
		t.pending[n-1].Text += text
		return
	}
	t.pending = append(t.pending, schema.AssistantBlock{Kind: kind, Text: text})
}

// commit 收到定稿的消息内容：丢弃对应的流式增量，按顺序追加文本、思考与工具卡片；调用方持有 chat.mu。
// 相邻的同类文本块合并，界面上就是连续的一段。
func (t *chatTurn) commit(parts []assistant.Part) {
	t.pending = nil
	for _, part := range parts {
		switch part.Kind {
		case assistant.PartTool:
			t.startCard(part.Tool, part.Args)
		case assistant.PartText, assistant.PartThinking:
			kind := string(part.Kind)
			if n := len(t.blocks); n > 0 && t.blocks[n-1].Kind == kind {
				t.blocks[n-1].Text += part.Text
				continue
			}
			t.blocks = append(t.blocks, schema.AssistantBlock{Kind: kind, Text: part.Text})
		}
	}
}

// runningCard 返回仍在运行的同名工具卡片；调用方持有 chat.mu。
func (t *chatTurn) runningCard(tool string) *schema.AssistantToolCard {
	for i := range t.blocks {
		if card := t.blocks[i].Card; card != nil && card.Tool == tool && card.State == "running" {
			return card
		}
	}
	return nil
}

// startCard 登记一次工具调用开始；调用方持有 chat.mu。
func (t *chatTurn) startCard(tool, args string) {
	if t.runningCard(tool) != nil {
		return
	}
	t.blocks = append(t.blocks, schema.AssistantBlock{Kind: "tool", Card: &schema.AssistantToolCard{Tool: tool, Args: args, State: "running"}})
}

// noteCard 由工具处理器登记或更新自己的卡片；调用方持有 chat.mu。
func (t *chatTurn) noteCard(tool, summary, state string, proposal *schema.AssistantProposal) {
	if card := t.runningCard(tool); card != nil {
		card.Summary, card.State, card.Proposal = summary, state, proposal
		return
	}
	t.blocks = append(t.blocks, schema.AssistantBlock{Kind: "tool", Card: &schema.AssistantToolCard{Tool: tool, Summary: summary, State: state, Proposal: proposal}})
}

// settleCard 在工具结果事件到达时收尾仍为 running 的同名卡片；调用方持有 chat.mu。
func (t *chatTurn) settleCard(tool string, failed bool) {
	for card := t.runningCard(tool); card != nil; card = t.runningCard(tool) {
		if failed {
			card.State = "error"
		} else {
			card.State = "done"
		}
	}
}

// blocksText 拼接内容块里的文本块，段与段之间空一行。
func blocksText(blocks []schema.AssistantBlock) string {
	var parts []string
	for _, block := range blocks {
		if block.Kind == "text" && strings.TrimSpace(block.Text) != "" {
			parts = append(parts, strings.TrimSpace(block.Text))
		}
	}
	return strings.Join(parts, "\n\n")
}

// pageLabels 是界面页面在上下文前缀里的描述。
var pageLabels = map[string]string{
	"text":       "voice generation（语音生成）",
	"story":      "story dubbing（故事配音）",
	"music":      "music generation（音乐生成）",
	"sfx":        "sound effects generation（音效生成）",
	"score":      "arrangement（编曲）",
	"characters": "voice library（声音库）",
	"voices":     "reference audio library（参考音色库）",
	"history":    "history（历史生成）",
	"settings":   "settings（设置）",
}

// chatMessageText 组装发给助手的一条用户消息：界面上下文前缀与用户正文。
// 上下文只带摘要（选中内容、当前台词、最近一次生成的结果与错误码、缺失的模型、记住的偏好），不带作品全文。
func (w *Workbench) chatMessageText(next chatMessage) string {
	var b strings.Builder
	context := next.context
	s := w.Store.Read()
	line := func(format string, args ...any) { b.WriteString(fmt.Sprintf(format, args...) + "\n") }
	b.WriteString("<ui_context>\n")
	if label, ok := pageLabels[context.Page]; ok {
		line("page: %s", label)
	}
	if id := strings.TrimSpace(context.WorkID); id != "" {
		title, kind := strings.TrimSpace(context.WorkTitle), strings.TrimSpace(context.WorkKind)
		var work *schema.Draft
		for i := range s.Drafts {
			if s.Drafts[i].ID == id {
				work = &s.Drafts[i]
				title, kind = work.Title, workKindOf(*work)
				break
			}
		}
		if title != "" {
			line("current work: %q (id %s, kind %s)", title, id, kind)
		} else {
			line("current work id: %s (kind %s)", id, kind)
		}
		if work != nil {
			w.workContext(&b, s, *work)
		}
	}
	if cue := context.Cue; cue != nil && cue.Index > 0 {
		line("selected line: #%d of %d, speaker %q: %q", cue.Index, cue.Total, clip(cue.Speaker, 40), clip(cue.Text, 300))
	}
	if selection := strings.TrimSpace(context.Selection); selection != "" {
		line("selected text: %q", clip(selection, 600))
	}
	// 播放位置只对打开的作品有意义。
	if context.Playhead > 0 && strings.TrimSpace(context.WorkID) != "" {
		seconds := int(context.Playhead)
		line("playhead: %d:%02d", seconds/60, seconds%60)
	}
	if !RuntimeReady(s) {
		line("inference engine: not installed or outdated (Settings › Engine)")
	}
	if len(s.AssistantMemory) > 0 {
		b.WriteString("remembered preferences:\n")
		for _, memo := range s.AssistantMemory {
			line("- [%s] %s", memo.ID, memo.Text)
		}
	}
	if context.Locale != "" {
		line("ui_locale: %s", context.Locale)
	}
	b.WriteString("</ui_context>\n\n")
	b.WriteString(next.text)
	return b.String()
}

// workContext 写入当前作品的状态：所用模型是否已安装、正在进行或最近结束的生成、最新一版的时长。
func (w *Workbench) workContext(b *strings.Builder, s schema.State, d schema.Draft) {
	if d.ModelID != "" {
		if !slices.ContainsFunc(s.Models, func(m schema.InstalledModel) bool { return m.ID == d.ModelID }) {
			fmt.Fprintf(b, "work model: %s (not installed)\n", d.ModelID)
		} else {
			fmt.Fprintf(b, "work model: %s\n", d.ModelID)
		}
	}
	if a := s.Activity; a != nil && a.ProjectID == d.ID {
		switch {
		case a.Status == "running":
			fmt.Fprintf(b, "generation: running (%s)\n", codeKey(a.Code))
		case a.ErrorCode != nil:
			fmt.Fprintf(b, "last generation: %s, error %s %s\n", a.Status, codeKey(*a.ErrorCode), paramsText(a.ErrorParams))
		default:
			fmt.Fprintf(b, "last generation: %s\n", a.Status)
		}
	}
	for _, g := range s.History {
		if g.Settings.ID == d.ID {
			fmt.Fprintf(b, "latest take: %q, %.1fs, %d min ago (id %s)\n", g.Title, g.Duration, int(time.Since(g.CreatedAt).Minutes()), g.ID)
			break
		}
	}
}

// paramsText 把错误参数拼成简短文本；长参数截断，避免把日志细节整段带进上下文。
func paramsText(params msg.Params) string {
	if len(params) == 0 {
		return ""
	}
	keys := make([]string, 0, len(params))
	for key := range params {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		parts = append(parts, fmt.Sprintf("%s=%s", key, clip(fmt.Sprint(params[key]), 120)))
	}
	return "(" + strings.Join(parts, ", ") + ")"
}

// clip 按字符截断文本并去掉换行。
func clip(text string, limit int) string {
	text = strings.Join(strings.Fields(text), " ")
	if runes := []rune(text); len(runes) > limit {
		return string(runes[:limit]) + "…"
	}
	return text
}
