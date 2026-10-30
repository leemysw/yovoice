package assistant

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"strings"
	"yovoice/internal/diag"
	"yovoice/internal/msg"
)

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

// requestID 生成宿主发起的 control_request ID，如 init-1、interrupt-3。
func (p *process) requestID(kind string) string {
	return kind + "-" + strconv.FormatInt(p.seq.Add(1), 10)
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
