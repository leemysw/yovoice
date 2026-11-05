package engine

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"yovoice/internal/msg"
)

// runStream 按接收顺序转发 WAV 片段，最终音频仍以引擎的完整结果保存，不自行拼接有损编码。
func (e *Engine) runStream(ctx context.Context, payload map[string]any, emit func(string) error) (taskResult, error) {
	var result taskResult
	payload["stream_format"] = "sse"
	data, err := json.Marshal(payload)
	if err != nil {
		return result, err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", e.endpoint+"v1/tasks/stream", bytes.NewReader(data))
	if err != nil {
		return result, err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := e.client.Do(req)
	if err != nil {
		return result, e.crashed(ctx, err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return result, msg.Err(msg.ErrGenerateFailed, nil)
	}
	// 最后一行含整段 WAV，沿用完整生成的大小上限；总响应还包含分段副本。
	scanner := bufio.NewScanner(io.LimitReader(res.Body, 512<<20))
	scanner.Buffer(make([]byte, 64<<10), 256<<20)
	complete := false
	for scanner.Scan() {
		if err := ctx.Err(); err != nil {
			return result, err
		}
		line := scanner.Text()
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		body := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if body == "[DONE]" {
			break
		}
		var event struct {
			Type   string          `json:"type"`
			Event  taskResult      `json:"event"`
			Result taskResult      `json:"result"`
			Error  json.RawMessage `json:"error"`
		}
		if err := json.Unmarshal([]byte(body), &event); err != nil {
			return result, err
		}
		if len(event.Error) > 0 && string(event.Error) != "null" {
			return result, msg.Err(msg.ErrGenerateFailed, nil)
		}
		switch event.Type {
		case "task.stream.event":
			if emit == nil {
				continue
			}
			if event.Event.Audio != "" {
				if err := emit(event.Event.Audio); err != nil {
					return result, err
				}
				continue
			}
			// VoxCPM2 与 OmniVoice 把片段放在命名输出中；附加分轨不能混入试听。
			for _, chunk := range event.Event.Stems {
				if strings.HasPrefix(chunk.ID, "chunk_") && chunk.Audio != "" {
					if err := emit(chunk.Audio); err != nil {
						return result, err
					}
				}
			}
		case "task.stream.done":
			result = event.Result
			complete = true
		}
	}
	if err := scanner.Err(); err != nil {
		return result, e.crashed(ctx, err)
	}
	if !complete {
		return result, msg.Err(msg.ErrGenerateFailed, nil)
	}
	return result, nil
}
