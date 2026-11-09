package engine

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"yovoice/internal/msg"
)

// stemResponseLimit 是分离结果的上限。引擎把每一轨编成 16 位立体声 WAV 再转 base64，
// 6 轨 44.1 kHz 约每秒 1.4 MB，10 分钟的歌约 850 MB；按 run 的 256 MB 上限，3 分钟多的歌就会被截断。
const stemResponseLimit = 2 << 30

// runStems 运行分离任务，逐轨解析 named_audio_outputs：每读到一轨就写到 target 给出的路径，
// 不把整个回包和全部分轨同时留在内存里。target 返回空路径时跳过这一轨。
func (e *Engine) runStems(ctx context.Context, payload map[string]any, target func(id string) string) (map[string]string, error) {
	b, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", e.endpoint+"v1/tasks/run", bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := e.client.Do(req)
	if err != nil {
		return nil, e.crashed(ctx, err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		b, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
		_ = os.WriteFile(filepath.Join(e.root, "logs", "last-inference-error.txt"), b, 0600)
		return nil, msg.Err(msg.ErrGenerateFailed, nil)
	}
	written, err := decodeStems(json.NewDecoder(io.LimitReader(res.Body, stemResponseLimit)), target)
	if err != nil {
		var coded *msg.CallError
		if errors.As(err, &coded) {
			return nil, err
		}
		return nil, e.crashed(ctx, err)
	}
	return written, nil
}

// decodeStems 从结果对象里找出 named_audio_outputs，其余字段跳过；返回分轨 ID 到写出路径。
func decodeStems(dec *json.Decoder, target func(id string) string) (map[string]string, error) {
	written := map[string]string{}
	if err := expectDelim(dec, '{'); err != nil {
		return nil, err
	}
	for dec.More() {
		key, err := dec.Token()
		if err != nil {
			return nil, err
		}
		if key != "named_audio_outputs" {
			if err = skipValue(dec); err != nil {
				return nil, err
			}
			continue
		}
		if err = expectDelim(dec, '['); err != nil {
			return nil, err
		}
		for dec.More() {
			if err = decodeStem(dec, target, written); err != nil {
				return nil, err
			}
		}
		if _, err = dec.Token(); err != nil {
			return nil, err
		}
	}
	_, err := dec.Token()
	return written, err
}

// decodeStem 读一个 {"id":..., "audio":...}；引擎先写 id 再写 audio，所以读到 audio 时就能决定写到哪里。
func decodeStem(dec *json.Decoder, target func(id string) string, written map[string]string) error {
	if err := expectDelim(dec, '{'); err != nil {
		return err
	}
	id := ""
	for dec.More() {
		key, err := dec.Token()
		if err != nil {
			return err
		}
		switch key {
		case "id":
			if err = dec.Decode(&id); err != nil {
				return err
			}
		case "audio":
			var encoded string
			if err = dec.Decode(&encoded); err != nil {
				return err
			}
			path := ""
			if id != "" {
				path = target(id)
			}
			if path == "" {
				continue
			}
			wav, err := base64.StdEncoding.DecodeString(encoded)
			if err != nil || len(wav) <= 44 {
				return msg.Err(msg.ErrEngineNoAudio, nil)
			}
			if err = os.WriteFile(path, wav, 0600); err != nil {
				return err
			}
			written[id] = path
		default:
			if err = skipValue(dec); err != nil {
				return err
			}
		}
	}
	_, err := dec.Token()
	return err
}

func expectDelim(dec *json.Decoder, want json.Delim) error {
	t, err := dec.Token()
	if err != nil {
		return err
	}
	if t != want {
		return msg.Err(msg.ErrEngineNoAudio, nil)
	}
	return nil
}

func skipValue(dec *json.Decoder) error {
	var skip json.RawMessage
	return dec.Decode(&skip)
}
