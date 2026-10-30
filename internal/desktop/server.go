// Package desktop 为原生宿主提供本机 HTTP 服务：界面资源、RPC、状态事件与媒体文件。
package desktop

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"net/http"
	"runtime/debug"
	"strconv"
	"strings"
	"sync"
	"yovoice/internal/diag"
	"yovoice/internal/msg"
	"yovoice/internal/workbench"
)

type Server struct {
	Workbench      *workbench.Workbench
	Assets, Secret string
	Shutdown       func()
	// LocalAPI 为空时不提供本机接口设置。
	LocalAPI *LocalAPI
	// calls 允许 RPC 并发执行；关闭时独占，等待在途调用结束后再释放资源。
	calls   sync.RWMutex
	once    sync.Once
	closing context.Context
	stop    context.CancelFunc
}

// lifetime 在关闭时取消，用于中止转码等耗时调用，避免拖住退出。
func (s *Server) lifetime() context.Context {
	s.once.Do(func() { s.closing, s.stop = context.WithCancel(context.Background()) })
	return s.closing
}

// guard 在读锁内执行一次调用，并把 panic 转成错误返回：任一方法崩溃都不能让读锁悬挂，
// 否则关闭时的写锁和之后的所有请求都会卡死。
func (s *Server) guard(method string, fn func() (any, error)) (result any, err error) {
	s.calls.RLock()
	defer s.calls.RUnlock()
	defer func() {
		if r := recover(); r != nil {
			diag.Log(s.Workbench.Store.Root, "rpc.panic", "method", method, "panic", fmt.Sprint(r), "stack", string(debug.Stack()))
			result, err = nil, msg.Err(msg.ErrUnknown, msg.Params{"detail": fmt.Sprintf("panic: %v", r)})
		}
	}()
	return fn()
}

// Close 关闭服务：先取消在途调用（包括正在复制数据目录的迁移），等它们结束后再释放资源。
// /shutdown 与信号、标准输入关闭的退出路径共用；幂等。
func (s *Server) Close() {
	s.lifetime()
	s.stop()
	s.calls.Lock()
	defer s.calls.Unlock()
	if s.LocalAPI != nil {
		s.LocalAPI.Close()
	}
	s.Workbench.Close()
}

// call 先处理本机接口设置，其余方法交给 Call。
func (s *Server) call(ctx context.Context, method string, data json.RawMessage) (any, error) {
	if !strings.HasPrefix(method, "localApi.") {
		return Call(ctx, s.Workbench, method, data)
	}
	if s.LocalAPI == nil {
		return nil, msg.Err(msg.ErrMethodUnsupported, nil)
	}
	var input struct {
		Enabled bool `json:"enabled"`
		Port    int  `json:"port"`
	}
	if len(data) > 0 && string(data) != "null" {
		if e := json.Unmarshal(data, &input); e != nil {
			return nil, msg.Err(msg.ErrRequestInvalid, nil)
		}
	}
	return s.LocalAPI.call(method, input.Enabled, input.Port)
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	cookie, e := r.Cookie("vw-" + s.Secret[:12])
	if !strings.HasPrefix(r.Host, "127.0.0.1:") || e != nil || subtle.ConstantTimeCompare([]byte(cookie.Value), []byte(s.Secret)) != 1 || (r.Header.Get("Origin") != "" && r.Header.Get("Origin") != "http://"+r.Host) {
		http.Error(w, "Forbidden", 403)
		return
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "frame-ancestors 'none'")
	limit := int64(28 << 20)
	if r.URL.Path == "/api/export-audio" {
		// 导出的长音频直接写入临时文件，按 WAV 的 4 GB 上限放宽。
		limit = 4 << 30
	}
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	switch {
	case r.URL.Path == "/api/export-audio" && r.Method == "POST":
		// loudness 为目标响度（LUFS），不带时原样保存；带了但不是数字视为请求无效。
		var loudness float64
		if raw := r.URL.Query().Get("loudness"); raw != "" {
			if loudness, e = strconv.ParseFloat(raw, 64); e != nil {
				http.Error(w, "请求无效。", 400)
				return
			}
		}
		reply, err := s.guard("export-audio", func() (any, error) {
			id, normalized, err := s.Workbench.SaveExport(r.Body, loudness)
			reply := map[string]any{"id": id}
			if normalized != nil {
				reply["normalized"] = normalized
			}
			return reply, err
		})
		if err != nil {
			reply = map[string]any{"error": msg.Encode(err)}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(reply)
	case r.URL.Path == "/api/call" && r.Method == "POST":
		var message struct {
			ID     string          `json:"id"`
			Method string          `json:"method"`
			Data   json.RawMessage `json:"data"`
		}
		if e = json.NewDecoder(r.Body).Decode(&message); e != nil {
			http.Error(w, "请求无效。", 400)
			return
		}
		// 调用之间互不阻塞：导入音色时仍可保存作品；数据一致性由 Workbench 保证。
		// 宿主断开或服务关闭时取消调用。
		ctx, cancel := context.WithCancel(r.Context())
		release := context.AfterFunc(s.lifetime(), cancel)
		result, err := s.guard(message.Method, func() (any, error) { return s.call(ctx, message.Method, message.Data) })
		release()
		cancel()
		reply := map[string]any{"id": message.ID, "result": result}
		if err != nil {
			reply = map[string]any{"id": message.ID, "error": msg.Encode(err)}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(reply)
	case r.URL.Path == "/api/state-events" && r.Method == "GET":
		ch, unsubscribe := s.Workbench.Store.Subscribe()
		defer unsubscribe()
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-store")
		flusher, ok := w.(http.Flusher)
		if !ok {
			return
		}
		var stream stateStream
		for {
			select {
			case <-r.Context().Done():
				return
			case <-ch:
				snapshot, e := s.Workbench.Store.ReadJSON()
				if e != nil {
					return
				}
				b, e := stream.next(snapshot)
				if e != nil {
					return
				}
				if b == nil {
					continue
				}
				if _, e = fmt.Fprintf(w, "data: %s\n\n", b); e != nil {
					return
				}
				flusher.Flush()
			}
		}
	case strings.HasPrefix(r.URL.Path, "/media/") && (r.Method == "GET" || r.Method == "HEAD"):
		parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/media/"), "/")
		if len(parts) != 2 {
			http.NotFound(w, r)
			return
		}
		path, e := s.Workbench.Store.MediaPath(parts[0], parts[1])
		if e != nil {
			http.Error(w, "无效路径", 400)
			return
		}
		w.Header().Set("Content-Type", "audio/wav")
		// 音频本就在本机磁盘上，禁止 WebView 再缓存一份；未压缩的 wav 会让 web-cache 不断膨胀。
		w.Header().Set("Cache-Control", "no-store")
		// 隐藏 io.ReaderFrom，避免 Windows sendfile 与连接后台读在 Go 1.26 中的数据竞争。
		http.ServeFile(struct{ http.ResponseWriter }{w}, r, path)
	case r.URL.Path == "/shutdown" && r.Method == "POST":
		s.Close()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("{}"))
		if s.Shutdown != nil {
			go s.Shutdown()
		}
	default:
		if r.Method != "GET" && r.Method != "HEAD" {
			http.Error(w, "Method not allowed", 405)
			return
		}
		http.FileServer(http.Dir(s.Assets)).ServeHTTP(w, r)
	}
}
