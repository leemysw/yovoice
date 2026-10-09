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
	"yovoice/internal/schema"
)

// GenerationJob 是可轮询的远程任务，音频仍由历史记录保存。
type GenerationJob struct {
	RequestID    string  `json:"requestId"`
	Status       string  `json:"status"`
	ID           string  `json:"id,omitempty"`
	Duration     float64 `json:"duration,omitempty"`
	DownloadPath string  `json:"downloadPath,omitempty"`
	Error        string  `json:"error,omitempty"`
}
type generationJob struct {
	GenerationJob
	fingerprint [32]byte
	cancel      context.CancelFunc
	created     time.Time
}

var errJobConflict = errors.New("任务 ID 已用于不同参数，或推理服务繁忙")
var errJobMissing = errors.New("任务不存在或已过期")

func (a *API) generationTimeout() time.Duration {
	if a.GenerationTimeout > 0 {
		return a.GenerationTimeout
	}
	return 30 * time.Minute
}

func (a *API) submitJob(id string, d schema.Draft) (GenerationJob, error) {
	if !schema.ValidID(id) {
		return GenerationJob{}, fmt.Errorf("requestId 必须为 32 位十六进制随机 ID")
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
		g, err := a.generateAudio(ctx, d)
		a.jobsMu.Lock()
		defer a.jobsMu.Unlock()
		job.Status = "completed"
		if err != nil {
			job.Status, job.Error = "failed", err.Error()
			if errors.Is(err, context.DeadlineExceeded) {
				job.Status = "timed_out"
			}
			if errors.Is(err, context.Canceled) {
				job.Status = "cancelled"
			}
		} else {
			job.ID, job.Duration, job.DownloadPath = g.ID, g.Duration, "/v1/audio/"+g.ID
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
		if err == nil {
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
		code := http.StatusBadRequest
		if errors.Is(err, errJobConflict) {
			code = http.StatusConflict
		}
		if errors.Is(err, errJobMissing) {
			code = http.StatusNotFound
		}
		http.Error(w, err.Error(), code)
		return
	}
	apiJSON(w, result)
}
