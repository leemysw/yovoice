package remote

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
	"yovoice/internal/diag"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
)

// GenerationJob 是可轮询的远程任务，音频仍由历史记录保存。
type GenerationJob struct {
	RequestID    string  `json:"requestId"`
	Status       string  `json:"status"`
	ID           string  `json:"id,omitempty"`
	Duration     float64 `json:"duration,omitempty"`
	DownloadPath string  `json:"downloadPath,omitempty"`
	// Path 只在本机 stdio 模式返回，为生成音频的绝对路径。
	Path  string `json:"path,omitempty"`
	Error string `json:"error,omitempty"`
}
type generationJob struct {
	GenerationJob
	fingerprint [32]byte
	cancel      context.CancelFunc
	created     time.Time
}

// errJobConflict 与 errJobMissing 带稳定错误码，HTTP 分别映射为 409 与 404。
var errJobConflict = msg.Err(msg.ErrJobConflict, nil)
var errJobMissing = msg.Err(msg.ErrJobMissing, nil)

// errorString 给任务记录写稳定的失败原因：结构化错误用错误码（带 detail 时附在括号内），其余用原文。
func errorString(err error) string {
	var callErr *msg.CallError
	if !errors.As(err, &callErr) {
		return err.Error()
	}
	if detail, ok := callErr.Params["detail"]; ok {
		return fmt.Sprintf("%s (%v)", callErr.Code, detail)
	}
	return string(callErr.Code)
}

func (a *API) generationTimeout() time.Duration {
	if a.GenerationTimeout > 0 {
		return a.GenerationTimeout
	}
	return 30 * time.Minute
}

func (a *API) submitJob(id string, d schema.Draft) (GenerationJob, error) {
	if !schema.ValidID(id) {
		return GenerationJob{}, msg.Err(msg.ErrRequestInvalid, msg.Params{"detail": "requestId 必须为 32 位十六进制随机 ID"})
	}
	data, err := json.Marshal(struct {
		Text string
		schema.SynthesisSettings
	}{d.Text, d.SynthesisSettings})
	if err != nil {
		return GenerationJob{}, err
	}
	hash := sha256.Sum256(data)
	a.jobsMu.Lock()
	defer a.jobsMu.Unlock()
	if job := a.jobs[id]; job != nil {
		if job.fingerprint != hash {
			return GenerationJob{}, errJobConflict
		}
		return job.GenerationJob, nil
	}
	if !a.busy.TryLock() {
		return GenerationJob{}, errJobConflict
	}
	// ponytail: 单引擎不排队；仅保留最近 100 个任务，持久任务恢复有需求再扩展。
	if a.jobs == nil {
		a.jobs = make(map[string]*generationJob)
	}
	if len(a.jobs) >= 100 {
		oldest := ""
		for key, job := range a.jobs {
			if job.Status != "running" && (oldest == "" || job.created.Before(a.jobs[oldest].created)) {
				oldest = key
			}
		}
		if oldest != "" {
			delete(a.jobs, oldest)
		}
	}
	parent := a.Context
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithCancel(parent)
	job := &generationJob{GenerationJob: GenerationJob{RequestID: id, Status: "running"}, fingerprint: hash, cancel: cancel, created: time.Now()}
	a.jobs[id] = job
	result := job.GenerationJob
	go func() {
		defer cancel()
		// panic 也要落成任务失败并释放单任务槽，否则之后的提交永远返回繁忙。
		var g schema.Generation
		err := diag.Catch(a.Workbench.Store.Root, "api.job", func() (e error) { g, e = a.generateAudio(ctx, d); return e })
		a.jobsMu.Lock()
		defer a.jobsMu.Unlock()
		job.Status = "completed"
		if err != nil {
			job.Status, job.Error = "failed", errorString(err)
			if errors.Is(err, context.DeadlineExceeded) {
				job.Status = "timed_out"
			}
			if errors.Is(err, context.Canceled) {
				job.Status = "cancelled"
			}
		} else {
			job.ID, job.Duration = g.ID, g.Duration
			if path, e := a.Workbench.MediaFile("outputs", g.ID); a.Local && e == nil {
				job.Path = path
			} else {
				job.DownloadPath = "/v1/audio/" + g.ID
			}
		}
		a.busy.Unlock()
	}()
	return result, nil
}

func (a *API) getJob(id string, cancel bool) (GenerationJob, error) {
	a.jobsMu.Lock()
	defer a.jobsMu.Unlock()
	job := a.jobs[id]
	if job == nil {
		return GenerationJob{}, errJobMissing
	}
	if cancel && job.Status == "running" {
		job.cancel()
	}
	return job.GenerationJob, nil
}

func (a *API) jobHTTP(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/v1/jobs/")
	var result GenerationJob
	var err error
	switch r.Method {
	case "PUT":
		var d schema.Draft
		d, err = decodeGeneration(http.MaxBytesReader(w, r.Body, 1<<20))
		if err != nil {
			err = requestError(err)
		} else {
			result, err = a.submitJob(id, d)
		}
	case "GET", "DELETE":
		result, err = a.getJob(id, r.Method == "DELETE")
	default:
		w.Header().Set("Allow", "PUT, GET, DELETE")
		http.Error(w, "Method Not Allowed", 405)
		return
	}
	if err != nil {
		apiError(w, err)
		return
	}
	apiJSON(w, result)
}
