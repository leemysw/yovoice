package desktop

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
	"yovoice/internal/schema"
	"yovoice/internal/workbench"
)

func newServer(t *testing.T) (*Server, *httptest.Server, func(method string, data any) (map[string]any, error)) {
	t.Helper()
	w, err := workbench.New(t.TempDir())
	must(t, err)
	t.Cleanup(w.Close)
	secret := strings.Repeat("b", 64)
	handler := &Server{Workbench: w, Assets: t.TempDir(), Secret: secret}
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	call := func(method string, data any) (map[string]any, error) {
		body, err := json.Marshal(map[string]any{"id": "1", "method": method, "data": data})
		if err != nil {
			return nil, err
		}
		r, err := http.NewRequest("POST", server.URL+"/api/call", bytes.NewReader(body))
		if err != nil {
			return nil, err
		}
		r.AddCookie(&http.Cookie{Name: "vw-" + secret[:12], Value: secret})
		res, err := server.Client().Do(r)
		if err != nil {
			return nil, err
		}
		defer res.Body.Close()
		var reply map[string]any
		if err = json.NewDecoder(res.Body).Decode(&reply); err != nil {
			return nil, err
		}
		if reply["error"] != nil {
			return reply, fmt.Errorf("%v", reply["error"])
		}
		return reply, nil
	}
	return handler, server, call
}

// 不同类型的调用并发执行，结果互不覆盖。
func TestConcurrentCalls(t *testing.T) {
	handler, _, call := newServer(t)
	recording := base64.StdEncoding.EncodeToString(wav())
	const workers, rounds = 8, 10
	var wg sync.WaitGroup
	errs := make(chan error, workers*rounds*3)
	for worker := range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			d := schema.DefaultDraft()
			for round := range rounds {
				d.Title = fmt.Sprintf("作品 %d-%d", worker, round)
				if _, err := call("draft.save", d); err != nil {
					errs <- err
				}
				if _, err := call("voice.record", map[string]string{"name": d.Title, "base64": recording}); err != nil {
					errs <- err
				}
				if _, err := call("state.get", map[string]any{}); err != nil {
					errs <- err
				}
			}
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
	state := handler.Workbench.Store.Read()
	if len(state.Voices) != workers*rounds {
		t.Fatal("音色数量不正确", len(state.Voices))
	}
	for worker := range workers {
		title := fmt.Sprintf("作品 %d-%d", worker, rounds-1)
		if !strings.Contains(fmt.Sprint(state.Drafts), title) {
			t.Fatal("缺少作品最终版本", title)
		}
	}
}

// 调用互不阻塞；关闭时取消在途调用的上下文，并等待其结束后才释放资源。
func TestShutdownWaitsForCalls(t *testing.T) {
	handler, server, call := newServer(t)
	handler.calls.RLock()
	// 模拟一个耗时调用仍在进行，新调用不应排队等待。
	saved := make(chan error, 1)
	go func() {
		_, err := call("draft.save", schema.DefaultDraft())
		saved <- err
	}()
	select {
	case err := <-saved:
		must(t, err)
	case <-time.After(5 * time.Second):
		handler.calls.RUnlock()
		t.Fatal("在途调用阻塞了新调用")
	}
	inflight := handler.lifetime()
	finished := make(chan struct{})
	go func() {
		defer close(finished)
		r, err := http.NewRequest("POST", server.URL+"/shutdown", nil)
		must(t, err)
		r.AddCookie(&http.Cookie{Name: "vw-" + handler.Secret[:12], Value: handler.Secret})
		res, err := server.Client().Do(r)
		must(t, err)
		res.Body.Close()
	}()
	select {
	case <-inflight.Done():
	case <-time.After(5 * time.Second):
		t.Fatal("关闭时应取消在途调用")
	}
	select {
	case <-finished:
		t.Fatal("关闭不应早于在途调用结束")
	case <-time.After(100 * time.Millisecond):
	}
	handler.calls.RUnlock()
	select {
	case <-finished:
	case <-time.After(5 * time.Second):
		t.Fatal("在途调用结束后应完成关闭")
	}
}

// 调用里的 panic 转成错误返回并释放读锁：之后的请求与关闭都不受影响。
func TestPanicInCallReleasesLock(t *testing.T) {
	handler, server, call := newServer(t)
	result, err := handler.guard("boom", func() (any, error) { panic("boom") })
	if result != nil || err == nil || !strings.Contains(fmt.Sprint(err), "@yovoice.error.unknown") {
		t.Fatalf("panic 应转成未知错误: %v %v", result, err)
	}
	if _, err := call("state.get", map[string]any{}); err != nil {
		t.Fatal("panic 之后的调用应正常", err)
	}
	b, err := os.ReadFile(filepath.Join(handler.Workbench.Store.Root, "logs", "service.log"))
	must(t, err)
	if !strings.Contains(string(b), `"rpc.panic"`) || !strings.Contains(string(b), `"method":"boom"`) {
		t.Fatal("缺少 panic 诊断")
	}
	finished := make(chan struct{})
	go func() {
		defer close(finished)
		r, err := http.NewRequest("POST", server.URL+"/shutdown", nil)
		must(t, err)
		r.AddCookie(&http.Cookie{Name: "vw-" + handler.Secret[:12], Value: handler.Secret})
		res, err := server.Client().Do(r)
		must(t, err)
		res.Body.Close()
	}()
	select {
	case <-finished:
	case <-time.After(5 * time.Second):
		t.Fatal("panic 后读锁未释放，关闭卡住")
	}
}

// 在途调用不响应取消时，关闭最多等 drainTimeout，超时记录日志后继续，不会无限等待。
func TestCloseGivesUpDrainingAfterTimeout(t *testing.T) {
	handler, _, _ := newServer(t)
	saved := drainTimeout
	drainTimeout = 200 * time.Millisecond
	defer func() { drainTimeout = saved }()
	handler.calls.RLock()
	defer handler.calls.RUnlock()
	finished := make(chan struct{})
	go func() {
		defer close(finished)
		handler.Close()
	}()
	select {
	case <-finished:
	case <-time.After(5 * time.Second):
		t.Fatal("在途调用卡住时关闭应在超时后继续")
	}
	b, err := os.ReadFile(filepath.Join(handler.Workbench.Store.Root, "logs", "service.log"))
	must(t, err)
	if !strings.Contains(string(b), `"rpc.drain_timeout"`) {
		t.Fatal("缺少排空超时诊断")
	}
}
