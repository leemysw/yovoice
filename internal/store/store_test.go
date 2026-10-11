package store

import (
	"os"
	"path/filepath"
	"testing"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
)

func TestMigrateRebasesInstalledRuntimePaths(t *testing.T) {
	base := t.TempDir()
	legacy, target := filepath.Join(base, "legacy"), filepath.Join(base, ".yovoice")
	store, err := New(legacy)
	must(t, err)
	relative := filepath.Join("runtime", "v0.9.1-cuda-123", "audiocpp_server.exe")
	oldPath := filepath.Join(legacy, relative)
	backend, version := "cuda", "v0.9.1"
	must(t, os.MkdirAll(filepath.Dir(oldPath), 0700))
	must(t, os.WriteFile(oldPath, []byte("engine"), 0600))
	must(t, store.Update(func(state *schema.State) {
		state.RuntimePath = &oldPath
		state.RuntimeBackend = &backend
		state.RuntimeVersion = &version
		state.Runtimes = map[string]schema.InstalledRuntime{
			"cuda": {Path: oldPath, Version: "v0.9.1"},
		}
	}, true))
	must(t, Migrate(legacy, target))
	reopened, err := New(target)
	must(t, err)
	want := filepath.Join(target, relative)
	if got := reopened.Read().Runtimes["cuda"].Path; got != want {
		t.Fatalf("迁移后运行时路径未重定位：got %q want %q", got, want)
	}
	if got := *reopened.Read().RuntimePath; got != want {
		t.Fatalf("当前运行时路径未重定位：got %q want %q", got, want)
	}
}

func TestStoreDoesNotReplayPreviousFailure(t *testing.T) {
	root := t.TempDir()
	store, err := New(root)
	must(t, err)
	for _, status := range []string{"failed", "running"} {
		must(t, store.Update(func(state *schema.State) {
			code := msg.ErrAudioDecode
			state.Activity = &schema.Activity{Kind: "generate", Status: status, Code: msg.ActivityFailed, ErrorCode: &code}
		}, true))
		reopened, err := New(root)
		must(t, err)
		activity := reopened.Read().Activity
		if status == "failed" && activity != nil {
			t.Fatal("重启不应重新显示历史失败提示")
		}
		if status == "running" && (activity == nil || activity.Status != "interrupted" || activity.ErrorCode != nil) {
			t.Fatal("未结束的操作仍应标记为中断")
		}
	}
}
