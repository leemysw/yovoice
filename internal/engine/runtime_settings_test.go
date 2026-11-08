package engine

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
	"yovoice/internal/catalog"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
	"yovoice/internal/store"
)

func TestEngineRuntimeSettingsReachServerAndInvalidateCache(t *testing.T) {
	root := t.TempDir()
	s, err := store.New(root)
	must(t, err)
	defer s.Close()
	e := New(root)
	defer e.Stop()
	path := filepath.Join(root, "model.gguf")
	must(t, os.WriteFile(path, []byte("fixture"), 0600))
	bin, err := os.Executable()
	must(t, err)
	definition, err := catalog.Lookup("index-2.5-q8")
	must(t, err)
	idle := 45
	settings := &schema.EngineSettings{Threads: 3, Device: 2, IdleUnloadSeconds: &idle, Session: map[string]any{"index_tts2.speaker_cache_slots": float64(0), "index_tts2.mem_saver": true, "kokoro_tts.weight_context_mb": float64(128)}}
	streaming := &schema.RuntimeSettings{Streaming: true}
	e.Configure(settings)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	progress := func(msg.Code, msg.Params) {}
	must(t, e.start(ctx, bin, path, definition, "cpu", false, 0, progress, streaming))
	pid := e.process.Process.Pid
	b, err := os.ReadFile(filepath.Join(root, "runtime", "server.json"))
	must(t, err)
	var config struct {
		Threads, Device int
		Idle            int `json:"idle_unload_ms"`
		Models          []struct {
			Mode    string
			Session map[string]string `json:"session_options"`
		}
	}
	must(t, json.Unmarshal(b, &config))
	m := config.Models[0]
	if config.Threads != 3 || config.Device != 2 || config.Idle != 45000 || m.Mode != "streaming" || m.Session["index_tts2.speaker_cache_slots"] != "0" || m.Session["index_tts2.mem_saver"] != "true" || m.Session["kokoro_tts.weight_context_mb"] != "" {
		t.Fatal(string(b))
	}
	must(t, e.start(ctx, bin, path, definition, "cpu", false, 0, progress, streaming))
	if e.process.Process.Pid != pid {
		t.Fatal("相同设置应复用模型及缓存")
	}
	e.Configure(&schema.EngineSettings{Threads: 4, Device: 2, IdleUnloadSeconds: &idle, Session: settings.Session})
	must(t, e.start(ctx, bin, path, definition, "cpu", false, 0, progress, streaming))
	if e.process.Process.Pid == pid {
		t.Fatal("硬件选项变化后应重启引擎")
	}
	pid = e.process.Process.Pid
	must(t, e.start(ctx, bin, path, definition, "cpu", false, 0, progress))
	if e.process.Process.Pid == pid {
		t.Fatal("流式与离线切换后应重启引擎")
	}
}
