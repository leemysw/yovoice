package engine

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"sync/atomic"
	"time"
)

// Status 是内核实际的模型驻留状态；查询独立于推理锁，不会触发模型加载或重置空闲计时。
type Status struct {
	Phase             string `json:"phase"`
	ModelID           string `json:"modelId,omitempty"`
	ModelName         string `json:"modelName,omitempty"`
	IdleUnloadSeconds int    `json:"idleUnloadSeconds"`
}

// liveRuntime 在启动后发布不可变的连接信息，状态查询不读取受推理锁保护的进程字段。
type liveRuntime struct {
	endpoint string
	status   Status
	ready    atomic.Bool
	stopping *atomic.Bool
}

func (e *Engine) Status(ctx context.Context) Status {
	live := e.live.Load()
	if live == nil {
		seconds := 300
		if settings := e.settings.Load(); settings != nil && settings.IdleUnloadSeconds != nil {
			seconds = *settings.IdleUnloadSeconds
		}
		return Status{Phase: "stopped", IdleUnloadSeconds: seconds}
	}
	result := live.status
	if live.stopping.Load() {
		result.Phase = "unloading"
		return result
	}
	if !live.ready.Load() {
		result.Phase = "starting"
		return result
	}
	result.Phase = "unknown"
	probe, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(probe, "GET", live.endpoint+"v1/models", nil)
	if err != nil {
		return result
	}
	response, err := e.client.Do(req)
	if err != nil {
		return result
	}
	defer response.Body.Close()
	var models struct {
		Data []struct {
			ID     string `json:"id"`
			Loaded *bool  `json:"loaded"`
		} `json:"data"`
	}
	if response.StatusCode != http.StatusOK || json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&models) != nil {
		return result
	}
	for _, model := range models.Data {
		if model.ID == "index" && model.Loaded != nil {
			result.Phase = "unloaded"
			if *model.Loaded {
				result.Phase = "ready"
			}
			break
		}
	}
	// 查询期间可能已经切换模型或停止进程，旧响应不能冒充新内核的状态。
	if e.live.Load() != live {
		return Status{Phase: "unknown", IdleUnloadSeconds: 300}
	}
	return result
}
