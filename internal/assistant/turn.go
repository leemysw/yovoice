package assistant

import (
	"context"
	"strings"
	"time"
	"yovoice/internal/msg"
)

type turnState struct {
	result  chan Result
	onEvent func(Event)
	text    strings.Builder
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
