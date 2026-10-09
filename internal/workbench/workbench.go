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
)

type Workbench struct {
	Store      *Store
	mu         sync.Mutex
	cancel     context.CancelFunc
	done       chan struct{}
	closed     bool
	closeOnce  sync.Once
	engine     *Engine
	client     *http.Client
	bundledCPU string
}

func New(root string) (*Workbench, error) {
	s, e := NewStore(root)
	if e != nil {
		return nil, e
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = func(req *http.Request) (*url.URL, error) {
		preferences := s.Read().Preferences
		if (preferences.ProxyEnabled == nil && preferences.ProxyURL == "") || (preferences.ProxyEnabled != nil && !*preferences.ProxyEnabled) {
			return nil, nil
		}
		return downloadProxy(req, preferences.ProxyURL)
	}
	return &Workbench{Store: s, engine: NewEngine(root), client: &http.Client{Transport: transport}}, nil
}

// 前台命令由服务串行调度，耗时操作独立运行，状态通过 Store 广播。
func (w *Workbench) begin(kind string, code MessageCode, params MessageParams, modelID *string, action func(context.Context) error, requestIDs ...string) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed || w.cancel != nil {
		return Err(MsgErrBusy, nil)
	}
	ctx, cancel := context.WithCancel(context.Background())
	if e := w.Store.Update(func(s *State) {
		requestID := ""
		if len(requestIDs) > 0 {
			requestID = requestIDs[0]
		}
		s.Activity = &Activity{RequestID: requestID, Kind: kind, Code: code, Params: params, Status: "running", ModelID: modelID, StartedAt: time.Now().UTC()}
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
	operationID := newID()
	started := time.Now()
	fields := []any{"operation_id", operationID, "kind", kind, "model_id", value(modelID), "related_ids", requestIDs}
	diagnostic(w.Store.Root, "operation.started", fields...)
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
		diagnostic(w.Store.Root, "operation.finished", append(fields, "status", status, "elapsed_ms", time.Since(started).Milliseconds(), "error", diagnosticError(err))...)
		w.mu.Lock()
		defer w.mu.Unlock()
		update := func(s *State) {
			a := s.Activity
			if err == nil {
				a.Code = MsgActivityCompleted
				a.Params = nil
				a.Status = "completed"
				a.ErrorCode = nil
				a.ErrorParams = nil
			} else if errors.Is(err, context.Canceled) {
				a.Status = "cancelled"
				a.Code = MsgActivityCancelled
				a.Params = nil
				if kind == "download" {
					a.Code = MsgActivityPaused
				}
				a.ErrorCode = nil
				a.ErrorParams = nil
			} else {
				a.Status = "failed"
				a.Code = MsgActivityFailed
				a.Params = nil
				if ce, ok := err.(*CallError); ok && ce != nil {
					a.ErrorCode = &ce.Code
					a.ErrorParams = ce.Params
				} else {
					code := MsgErrUnknown
					a.ErrorCode = &code
					a.ErrorParams = MessageParams{"detail": err.Error()}
				}
			}
		}
		if err != nil && !errors.Is(err, context.Canceled) {
			_ = os.WriteFile(filepath.Join(w.Store.Root, "logs", "last-error.txt"), []byte(err.Error()), 0600)
		}
		if e := w.Store.Update(update, true); e != nil {
			_ = w.Store.Update(func(s *State) {
				update(s)
				s.Activity.Status = "failed"
				code := MsgErrStateSaveFailed
				s.Activity.ErrorCode = &code
				s.Activity.ErrorParams = MessageParams{"detail": e.Error()}
			}, false)
		}
		w.cancel = nil
	}()
	return nil
}
func (w *Workbench) Cancel() {
	diagnostic(w.Store.Root, "operation.cancel_requested")
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.cancel != nil {
		w.cancel()
	}
}
func (w *Workbench) Close() {
	w.closeOnce.Do(func() {
		diagnostic(w.Store.Root, "service.stopping")
		defer diagnostic(w.Store.Root, "service.stopped")
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

func (w *Workbench) progress(code MessageCode, params MessageParams, received, total int64) {
	_ = w.Store.Update(func(s *State) {
		if s.Activity != nil {
			s.Activity.Code = code
			s.Activity.Params = params
			s.Activity.Received = received
			s.Activity.Total = total
		}
	}, false)
}
