package engine

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"
	"time"
)

func TestStreamRelaysAudioBeforeFinalResult(t *testing.T) {
	first := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]any
		if r.URL.Path != "/v1/tasks/stream" || json.NewDecoder(r.Body).Decode(&payload) != nil || payload["stream_format"] != "sse" {
			http.Error(w, "wrong request", 400)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = fmt.Fprint(w, "data: {\"type\":\"task.stream.event\",\"event\":{\"audio\":\"one\"}}\n\n")
		w.(http.Flusher).Flush()
		select {
		case <-first:
		case <-r.Context().Done():
			return
		}
		_, _ = fmt.Fprint(w, "data: {\"type\":\"task.stream.event\",\"event\":{\"audio\":\"two\"}}\n\ndata: {\"type\":\"task.stream.done\",\"result\":{\"audio\":\"full\"}}\n\ndata: [DONE]\n\n")
	}))
	defer server.Close()
	e := &Engine{endpoint: server.URL + "/", client: server.Client()}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	chunks := []string{}
	result, err := e.runStream(ctx, map[string]any{}, func(wav string) error {
		chunks = append(chunks, wav)
		if wav == "one" {
			close(first)
		}
		return nil
	})
	must(t, err)
	if !slices.Equal(chunks, []string{"one", "two"}) || result.Audio != "full" {
		t.Fatal(chunks, result)
	}
}

func TestStreamCancellationAndMissingFinalResult(t *testing.T) {
	for _, cancelAfterChunk := range []bool{false, true} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_, _ = fmt.Fprint(w, "data: {\"type\":\"task.stream.event\",\"event\":{\"audio\":\"partial\"}}\n\n")
			w.(http.Flusher).Flush()
			if cancelAfterChunk {
				<-r.Context().Done()
			}
		}))
		e := &Engine{endpoint: server.URL + "/", client: server.Client()}
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		result, err := e.runStream(ctx, map[string]any{}, func(string) error {
			if cancelAfterChunk {
				cancel()
			}
			return nil
		})
		cancel()
		server.Close()
		if err == nil || result.Audio != "" {
			t.Fatal("没有完整结果时不能保存", result, err)
		}
		if cancelAfterChunk && !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
	}
}
