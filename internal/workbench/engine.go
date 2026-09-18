package workbench

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"
)

type Engine struct {
	root          string
	process       *exec.Cmd
	done          chan error
	endpoint, key string
	client        *http.Client
}

func NewEngine(root string) *Engine {
	return &Engine{root: root, client: &http.Client{Transport: &http.Transport{Proxy: nil}}}
}
func (e *Engine) Stop() {
	if e.process != nil {
		killProcess(e.process)
		<-e.done
		e.process = nil
		e.key = ""
	}
}
func (e *Engine) start(ctx context.Context, executable, model, family, task, backend string, progress func(MessageCode, MessageParams)) error {
	if task == "" {
		task = "tts"
	}
	key := executable + "|" + model + "|" + family + "|" + task + "|" + backend
	if e.process != nil && e.key == key {
		select {
		case <-e.done:
			e.process = nil
		default:
			return nil
		}
	}
	e.Stop()
	if _, err := os.Stat(executable); err != nil {
		return Err(MsgErrRuntimeMissing, nil)
	}
	if _, err := os.Stat(model); err != nil {
		return Err(MsgErrModelMoved, nil)
	}
	progress(MsgActivityEngineStart, nil)
	l, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return err
	}
	port := l.Addr().(*net.TCPAddr).Port
	l.Close()
	config := map[string]any{"host": "127.0.0.1", "port": port, "backend": backend, "device": 0, "threads": max(1, min(runtime.NumCPU()/2, 8)), "lazy_load": true, "max_loaded_models": 1, "idle_unload_ms": 300000, "log_request_body": false, "max_request_body_bytes": 1048576, "models": []any{map[string]any{"id": "index", "family": family, "path": model, "task": task, "mode": "offline"}}}
	b, err := json.Marshal(config)
	if err != nil {
		return err
	}
	path := filepath.Join(e.root, "runtime", "server.json")
	if err = os.WriteFile(path, b, 0600); err != nil {
		return err
	}
	c := exec.Command(executable, "--config", path, "--no-ui")
	c.Dir = filepath.Dir(executable)
	configureProcess(c)
	out, err := os.Create(filepath.Join(e.root, "logs", "engine.log.out"))
	if err != nil {
		return err
	}
	defer out.Close()
	stderr, err := os.Create(filepath.Join(e.root, "logs", "engine.log"))
	if err != nil {
		return err
	}
	defer stderr.Close()
	c.Stdout = out
	c.Stderr = stderr
	if err = c.Start(); err != nil {
		return err
	}
	e.process = c
	e.done = make(chan error, 1)
	done := e.done
	go func() { done <- c.Wait(); close(done) }()
	e.endpoint = fmt.Sprintf("http://127.0.0.1:%d/", port)
	for i := 0; i < 120; i++ {
		if err = ctx.Err(); err != nil {
			return err
		}
		select {
		case <-e.done:
			e.process = nil
			return Err(MsgErrEngineStartFailed, nil)
		default:
		}
		probe, cancel := context.WithTimeout(ctx, 1500*time.Millisecond)
		req, _ := http.NewRequestWithContext(probe, "GET", e.endpoint+"health", nil)
		res, err := e.client.Do(req)
		healthy := err == nil && res.StatusCode == 200
		if res != nil {
			res.Body.Close()
		}
		cancel()
		if healthy {
			e.key = key
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(250 * time.Millisecond):
		}
	}
	return Err(MsgErrEngineStartTimeout, nil)
}
func (e *Engine) Generate(ctx context.Context, executable string, m InstalledModel, backend string, d Draft, voice, emotion, output string, progress func(MessageCode, MessageParams)) (err error) {
	defer func() {
		if err != nil {
			e.Stop()
		}
		_ = os.Remove(output + ".part")
	}()
	payload, err := BuildRequest(d, voice, emotion)
	if err != nil {
		return err
	}
	definition, err := model(m.ID)
	if err != nil {
		return err
	}
	if err = e.start(ctx, executable, m.Path, definition.Family, definition.Task, backend, progress); err != nil {
		return err
	}
	progress(MsgActivitySynthesizing, nil)
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", e.endpoint+"v1/tasks/run", bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := e.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		b, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
		_ = os.WriteFile(filepath.Join(e.root, "logs", "last-inference-error.txt"), b, 0600)
		return Err(MsgErrGenerateFailed, nil)
	}
	var result struct {
		Audio string `json:"audio"`
	}
	if err = json.NewDecoder(io.LimitReader(res.Body, 256<<20)).Decode(&result); err != nil {
		return err
	}
	if result.Audio == "" {
		return Err(MsgErrEngineNoAudio, nil)
	}
	progress(MsgActivitySavingAudio, nil)
	audio, err := base64.StdEncoding.DecodeString(result.Audio)
	if err != nil {
		return err
	}
	if err = os.WriteFile(output+".part", audio, 0600); err != nil {
		return err
	}
	if _, err = Duration(output + ".part"); err != nil {
		return err
	}
	if err = ctx.Err(); err != nil {
		return err
	}
	return os.Rename(output+".part", output)
}
