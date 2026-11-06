package workbench

import (
	"os"
	"path/filepath"
	"testing"
	"yovoice/internal/schema"
)

func TestRuntimeOptionCapabilitiesComeFromSelectedEngine(t *testing.T) {
	dir := t.TempDir()
	bin := filepath.Join(dir, "audiocpp_server")
	must(t, os.WriteFile(bin, []byte("test"), 0600))
	var state schema.State
	useRuntime(&state, bin, "cpu", "v0.9.3")
	if len(state.RuntimeOptions) != 0 {
		t.Fatal(state.RuntimeOptions)
	}
	spec := filepath.Join(dir, "model_specs", "index_tts2.json")
	must(t, os.MkdirAll(filepath.Dir(spec), 0700))
	must(t, os.WriteFile(spec, []byte(`{"family":"index_tts2","options":{"request":[{"name":"text_chunk_tokens"},{"name":"text_normalization"},{"name":"arbitrary_engine_option"}]}}`), 0600))
	useRuntime(&state, bin, "cpu", "custom")
	if len(state.RuntimeOptions["index_tts2"]) != 2 {
		t.Fatal(state.RuntimeOptions)
	}
	draft := schema.DefaultDraft()
	draft.ModelOptions = map[string]map[string]any{"index_tts2": {"text_chunk_tokens": float64(60), "text_normalization": false}}
	must(t, modelOptionsReady(state, draft))
	useRuntime(&state, filepath.Join(t.TempDir(), "other-engine"), "cpu", "older")
	if err := modelOptionsReady(state, draft); err == nil {
		t.Fatal("旧引擎不能静默忽略已保存的参数")
	}
	must(t, modelOptionsReady(state, schema.DefaultDraft()))
}
