package workbench

import (
	"context"
	"errors"
	"testing"
	"time"
	"yovoice/internal/msg"
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
