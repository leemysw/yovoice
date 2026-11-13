package engine

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
	"yovoice/internal/schema"
)

func TestStatusObservesIdleUnloadWithoutTakingInferenceLock(t *testing.T) {
	var loaded atomic.Bool
	loaded.Store(true)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" || r.URL.Path != "/v1/models" {
			t.Errorf("状态查询不能启动或重新加载模型：%s %s", r.Method, r.URL.Path)
			http.Error(w, "wrong request", http.StatusBadRequest)
			return
		}
		_, _ = fmt.Fprintf(w, `{"data":[{"id":"index","loaded":%t}]}`, loaded.Load())
	}))
	defer server.Close()
	e := &Engine{client: server.Client()}
	live := &liveRuntime{endpoint: server.URL + "/", stopping: new(atomic.Bool), status: Status{ModelID: "index-2-q8", IdleUnloadSeconds: 300}}
	e.live.Store(live)
	if s := e.Status(context.Background()); s.Phase != "starting" {
		t.Fatal(s)
	}
	live.ready.Store(true)
	// 推理始终持有 mu，界面仍须读到模型加载完成，不能等到合成结束才返回。
	e.mu.Lock()
	defer e.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if s := e.Status(ctx); s.Phase != "ready" || s.ModelID != "index-2-q8" || s.IdleUnloadSeconds != 300 {
		t.Fatal(s)
	}
	loaded.Store(false)
	if s := e.Status(ctx); s.Phase != "unloaded" {
		t.Fatal(s)
	}
	live.stopping.Store(true)
	if s := e.Status(ctx); s.Phase != "unloading" {
		t.Fatal(s)
	}
	e.live.Store(nil)
	zero := 0
	e.Configure(&schema.EngineSettings{IdleUnloadSeconds: &zero})
	if s := e.Status(ctx); s.Phase != "stopped" || s.IdleUnloadSeconds != 0 {
		t.Fatal(s)
	}
}

func TestStatusDoesNotReportOldModelAfterRuntimeSwitch(t *testing.T) {
	requested, release := make(chan struct{}), make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(requested)
		<-release
		_, _ = fmt.Fprint(w, `{"data":[{"id":"index","loaded":true}]}`)
	}))
	defer server.Close()
	e := &Engine{client: server.Client()}
	old := &liveRuntime{endpoint: server.URL + "/", stopping: new(atomic.Bool), status: Status{ModelID: "old"}}
	old.ready.Store(true)
	e.live.Store(old)
	result := make(chan Status, 1)
	go func() { result <- e.Status(context.Background()) }()
	<-requested
	e.live.Store(&liveRuntime{stopping: new(atomic.Bool), status: Status{ModelID: "new"}})
	close(release)
	if s := <-result; s.Phase == "ready" || s.ModelID == "old" {
		t.Fatalf("旧状态不能覆盖新内核：%+v", s)
	}
}

func TestStatusDoesNotInventModelResidency(t *testing.T) {
	for _, body := range []string{`{"data":[{"id":"index"}]}`, `{"data":[]}`, "bad json"} {
		t.Run(body, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = fmt.Fprint(w, body) }))
			defer server.Close()
			e := &Engine{client: server.Client()}
			live := &liveRuntime{endpoint: server.URL + "/", stopping: new(atomic.Bool)}
			live.ready.Store(true)
			e.live.Store(live)
			if s := e.Status(context.Background()); s.Phase != "unknown" {
				t.Fatal(s)
			}
		})
	}
}
