package workbench

import (
	"strings"
	"time"
	"yovoice/internal/assistant"
	"yovoice/internal/schema"
)

// chatTurn 是一轮对话的实时状态：blocks 为已定稿的内容块，pending 为尚未定稿的流式增量
// （收到对应的定稿消息时整体替换）。
type chatTurn struct {
	blocks    []schema.AssistantBlock
	pending   []schema.AssistantBlock
	locale    schema.UiLocale // 界面语言，工具卡片摘要据此选择
	model     string
	startedAt time.Time
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
