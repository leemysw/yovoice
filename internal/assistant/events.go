package assistant

import (
	"bytes"
	"encoding/json"
	"strings"
)

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
