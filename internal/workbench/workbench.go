// Package workbench 是应用服务层：编排作品、素材、角色、模型、运行时与生成，并串行调度耗时操作。
package workbench

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"time"
	"yovoice/internal/diag"
	"yovoice/internal/domain"
	"yovoice/internal/download"
	"yovoice/internal/engine"
	"yovoice/internal/msg"
	"yovoice/internal/store"
)

type Workbench struct {
	Store      *store.Store
	mu         sync.Mutex
	cancel     context.CancelFunc
	done       chan struct{}
	closed     bool
	closeOnce  sync.Once
	engine     *engine.Engine
	client     *http.Client
	bundledCPU string
}

func New(root string) (*Workbench, error) {
	s, e := store.New(root)
	if e != nil {
		return nil, e
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = func(req *http.Request) (*url.URL, error) {
		preferences := s.Read().Preferences
		if (preferences.ProxyEnabled == nil && preferences.ProxyURL == "") || (preferences.ProxyEnabled != nil && !*preferences.ProxyEnabled) {
			return nil, nil
		}
		return download.Proxy(req, preferences.ProxyURL)
	}
	return &Workbench{Store: s, engine: engine.New(root), client: &http.Client{Transport: transport}}, nil
}

// 前台命令由服务串行调度，耗时操作独立运行，状态通过 Store 广播。
func (w *Workbench) begin(kind string, code msg.Code, params msg.Params, modelID *string, action func(context.Context) error, requestIDs ...string) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed || w.cancel != nil {
		return msg.Err(msg.ErrBusy, nil)
	}
	ctx, cancel := context.WithCancel(context.Background())
	if e := w.Store.Update(func(s *domain.State) {
		requestID := ""
		if len(requestIDs) > 0 {
			requestID = requestIDs[0]
		}
		s.Activity = &domain.Activity{RequestID: requestID, Kind: kind, Code: code, Params: params, Status: "running", ModelID: modelID, StartedAt: time.Now().UTC()}
		if len(requestIDs) > 1 {
			if requestID == "" {
				s.Activity.ProjectID = requestIDs[1]
			} else {
				s.Activity.CharacterID = requestIDs[1]
			}
		}
	}, true); e != nil {
		cancel()
		return e
	}
	operationID := domain.NewID()
	started := time.Now()
	fields := []any{"operation_id", operationID, "kind", kind, "model_id", value(modelID), "related_ids", requestIDs}
	diag.Log(w.Store.Root, "operation.started", fields...)
	w.cancel = cancel
	done := make(chan struct{})
	w.done = done
	go func() {
		defer close(done)
		defer cancel()
		err := action(ctx)
		status := "completed"
		if errors.Is(err, context.Canceled) {
			status = "cancelled"
		} else if err != nil {
			status = "failed"
		}
		diag.Log(w.Store.Root, "operation.finished", append(fields, "status", status, "elapsed_ms", time.Since(started).Milliseconds(), "error", diag.Error(err))...)
		w.mu.Lock()
		defer w.mu.Unlock()
		update := func(s *domain.State) {
			a := s.Activity
			if err == nil {
				a.Code = msg.ActivityCompleted
				a.Params = nil
				a.Status = "completed"
				a.ErrorCode = nil
				a.ErrorParams = nil
			} else if errors.Is(err, context.Canceled) {
				a.Status = "cancelled"
				a.Code = msg.ActivityCancelled
				a.Params = nil
				if kind == "download" {
					a.Code = msg.ActivityPaused
				}
				a.ErrorCode = nil
				a.ErrorParams = nil
			} else {
				a.Status = "failed"
				a.Code = msg.ActivityFailed
				a.Params = nil
				if ce, ok := err.(*msg.CallError); ok && ce != nil {
					a.ErrorCode = &ce.Code
					a.ErrorParams = ce.Params
				} else {
					code := msg.ErrUnknown
					a.ErrorCode = &code
					a.ErrorParams = msg.Params{"detail": err.Error()}
				}
			}
		}
		if err != nil && !errors.Is(err, context.Canceled) {
			_ = os.WriteFile(filepath.Join(w.Store.Root, "logs", "last-error.txt"), []byte(err.Error()), 0600)
		}
		if e := w.Store.Update(update, true); e != nil {
			_ = w.Store.Update(func(s *domain.State) {
				update(s)
				s.Activity.Status = "failed"
				code := msg.ErrStateSaveFailed
				s.Activity.ErrorCode = &code
				s.Activity.ErrorParams = msg.Params{"detail": e.Error()}
			}, false)
		}
		w.cancel = nil
	}()
	return nil
}

// Done 返回当前操作的完成信号；没有进行中的操作时返回已关闭的通道。
func (w *Workbench) Done() <-chan struct{} {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.done == nil {
		closed := make(chan struct{})
		close(closed)
		return closed
	}
	return w.done
}

func (w *Workbench) Cancel() {
	diag.Log(w.Store.Root, "operation.cancel_requested")
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.cancel != nil {
		w.cancel()
	}
}
func (w *Workbench) Close() {
	w.closeOnce.Do(func() {
		diag.Log(w.Store.Root, "service.stopping")
		defer diag.Log(w.Store.Root, "service.stopped")
		w.mu.Lock()
		w.closed = true
		if w.cancel != nil {
			w.cancel()
		}
		done := w.done
		w.mu.Unlock()
		if done != nil {
			<-done
		}
		w.engine.Stop()
		w.client.CloseIdleConnections()
	})
}

func (w *Workbench) progress(code msg.Code, params msg.Params, received, total int64) {
	_ = w.Store.Update(func(s *domain.State) {
		if s.Activity != nil {
			s.Activity.Code = code
			s.Activity.Params = params
			s.Activity.Received = received
			s.Activity.Total = total
		}
	}, false)
}
