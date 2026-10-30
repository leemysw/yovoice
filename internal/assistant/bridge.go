package assistant

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"yovoice/internal/diag"

	"github.com/modelcontextprotocol/go-sdk/jsonrpc"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// bridge 把 ocho 经 control_request(mcp_message) 发来的 JSON-RPC 消息转发给进程内 *mcp.Server，
// 再把 server 的响应包回 control_response。ocho 是 MCP 客户端，两侧按原始 JSON-RPC 转发，
// 不做第二次会话协商。
type bridge struct {
	root  string // 数据目录，后台 goroutine 的 panic 日志写到这里
	conn  mcp.Connection
	write func(any) error

	mu      sync.Mutex
	pending map[jsonrpc.ID]string // server 侧 JSON-RPC 请求 id → ocho control_request id
}

func newBridge(ctx context.Context, root string, server *mcp.Server, write func(any) error) *bridge {
	serverSide, clientSide := mcp.NewInMemoryTransports()
	diag.Go(root, "assistant.mcp_server", func() { _ = server.Run(ctx, serverSide) })
	conn, err := clientSide.Connect(ctx)
	if err != nil {
		// InMemoryTransport 的 Connect 不会失败；保险起见仍处理。
		conn = nil
	}
	b := &bridge{root: root, conn: conn, write: write, pending: map[jsonrpc.ID]string{}}
	diag.Go(root, "assistant.mcp_bridge", func() { b.readLoop(ctx) })
	return b
}

func (b *bridge) close() {
	if b.conn != nil {
		_ = b.conn.Close()
	}
}

// handle 处理一条 mcp_message：请求交给 server（响应稍后经 readLoop 回来），
// 通知没有响应，立即回一个 success，别让 ocho 干等。
func (b *bridge) handle(controlID string, raw json.RawMessage) error {
	if b.conn == nil {
		return b.replyError(controlID, "mcp bridge is down")
	}
	message, err := jsonrpc.DecodeMessage(raw)
	if err != nil {
		return b.replyError(controlID, "invalid JSON-RPC message: "+err.Error())
	}
	switch msg := message.(type) {
	case *jsonrpc.Request:
		if msg.IsCall() {
			b.mu.Lock()
			b.pending[msg.ID] = controlID
			b.mu.Unlock()
		}
		if err := b.conn.Write(context.Background(), msg); err != nil {
			return b.replyError(controlID, "mcp server write failed: "+err.Error())
		}
		if !msg.IsCall() {
			return b.reply(controlID, "success", json.RawMessage(`{"jsonrpc":"2.0","id":null,"result":{}}`))
		}
	case *jsonrpc.Response:
		// 进程内工具不会向客户端发起请求，出现响应属异常，忽略即可。
	}
	return nil
}

// readLoop 读 server 的响应与请求：响应按 id 找回对应的 control_request 并回给 ocho；
// server 主动发起的请求按 JSON-RPC 错误回绝。
func (b *bridge) readLoop(ctx context.Context) {
	for {
		message, err := b.conn.Read(ctx)
		if err != nil {
			return
		}
		switch msg := message.(type) {
		case *jsonrpc.Response:
			b.mu.Lock()
			controlID, ok := b.pending[msg.ID]
			delete(b.pending, msg.ID)
			b.mu.Unlock()
			if !ok {
				continue
			}
			raw, err := jsonrpc.EncodeMessage(msg)
			if err != nil {
				_ = b.replyError(controlID, err.Error())
				continue
			}
			_ = b.reply(controlID, "success", json.RawMessage(`{"mcp_response":`+string(raw)+`}`))
		case *jsonrpc.Request:
			if !msg.IsCall() {
				continue
			}
			_ = b.conn.Write(ctx, &jsonrpc.Response{ID: msg.ID, Error: &jsonrpc.Error{Code: jsonrpc.CodeMethodNotFound, Message: fmt.Sprintf("method %q is not supported", msg.Method)}})
		}
	}
}

// reply 回一个 control_response。
func (b *bridge) reply(controlID, subtype string, response json.RawMessage) error {
	return b.write(map[string]any{
		"type": "control_response",
		"response": map[string]any{
			"subtype":    subtype,
			"request_id": controlID,
			"response":   response,
		},
	})
}

func (b *bridge) replyError(controlID, detail string) error {
	return b.write(map[string]any{
		"type": "control_response",
		"response": map[string]any{
			"subtype":    "error",
			"request_id": controlID,
			"error":      detail,
		},
	})
}
