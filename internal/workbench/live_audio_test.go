package workbench

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
)

func TestLiveAudioSubscriptionKeepsEveryChunkInOrder(t *testing.T) {
	var w Workbench
	events, unsub := w.SubscribeAudio()
	defer unsub()
	for i := 0; i < 5; i++ {
		must(t, w.publishAudio(context.Background(), AudioEvent{Event: "audio", Sequence: i}))
	}
	for i := 0; i < 5; i++ {
		if event := <-events; event.Sequence != i {
			t.Fatal(event)
		}
	}
	for i := 0; i < cap(events); i++ {
		must(t, w.publishAudio(context.Background(), AudioEvent{Sequence: i}))
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if err := w.publishAudio(ctx, AudioEvent{}); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal(err)
	}
	unsub()
	must(t, w.publishAudio(context.Background(), AudioEvent{}))
}

func TestUnloadEngineDoesNotInterruptGeneration(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	must(t, w.begin("generate", msg.ActivityGenerate, nil, nil, func(ctx context.Context) error { <-ctx.Done(); return ctx.Err() }))
	if err := w.UnloadEngine(); err == nil {
		t.Fatal("生成时不能清空引擎缓存")
	}
	w.Cancel()
	<-w.Done()
	must(t, w.UnloadEngine())
}

func TestStreamingSynthesisReportsReceivedAudio(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	executable, err := os.Executable()
	must(t, err)
	modelPath := filepath.Join(t.TempDir(), "model.gguf")
	must(t, os.WriteFile(modelPath, []byte("fixture"), 0600))
	draft := schema.DefaultDraft()
	draft.ModelID = "index-2-q8"
	draft.Runtime = &schema.RuntimeSettings{Streaming: true}
	state := w.Store.Read()
	state.RuntimePath = &executable
	part := synthesisPart{draft: draft, model: schema.InstalledModel{ID: draft.ModelID, Path: modelPath}}
	var progress []msg.Params
	_, err = w.synthesizePart(context.Background(), state, part, filepath.Join(t.TempDir(), "generated.wav"), func(code msg.Code, params msg.Params) {
		if code == msg.ActivityStreamingAudio {
			progress = append(progress, params)
		}
	})
	must(t, err)
	if len(progress) != 1 || progress[0]["chunks"] != 1 || progress[0]["seconds"] != "1.0" {
		t.Fatalf("应按真正收到的 WAV 报告生成进度：%+v", progress)
	}
}
