package workbench

import (
	"context"
	"encoding/base64"
	"strconv"
	"sync"
	"time"
	"yovoice/internal/audio"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
)

// AudioEvent 独立于可合并的状态推送，避免中间片段被“只留最新状态”丢掉。
type AudioEvent struct {
	Event     string `json:"event"`
	ID        string `json:"id"`
	ProjectID string `json:"projectId"`
	Sequence  int    `json:"sequence"`
	Audio     string `json:"audio,omitempty"`
	Start     bool   `json:"start,omitempty"`
	End       bool   `json:"end,omitempty"`
	Cancelled bool   `json:"cancelled,omitempty"`
}
type audioSubscription struct {
	events chan AudioEvent
	done   chan struct{}
}

func (w *Workbench) SubscribeAudio() (<-chan AudioEvent, func()) {
	w.audioMu.Lock()
	if w.audioSubscribers == nil {
		w.audioSubscribers = map[uint64]*audioSubscription{}
	}
	id := w.audioNext
	w.audioNext++
	sub := &audioSubscription{make(chan AudioEvent, 16), make(chan struct{})}
	w.audioSubscribers[id] = sub
	w.audioMu.Unlock()
	var once sync.Once
	return sub.events, func() {
		once.Do(func() { w.audioMu.Lock(); delete(w.audioSubscribers, id); close(sub.done); w.audioMu.Unlock() })
	}
}
func (w *Workbench) publishAudio(ctx context.Context, event AudioEvent) error {
	w.audioMu.Lock()
	subs := make([]*audioSubscription, 0, len(w.audioSubscribers))
	for _, sub := range w.audioSubscribers {
		subs = append(subs, sub)
	}
	w.audioMu.Unlock()
	for _, sub := range subs {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-sub.done:
		case sub.events <- event:
		}
	}
	return nil
}
func (w *Workbench) synthesizePart(ctx context.Context, state schema.State, part synthesisPart, path string, progress func(msg.Code, msg.Params)) (score string, err error) {
	if part.draft.Runtime == nil || !part.draft.Runtime.Streaming {
		return w.engine.Generate(ctx, *state.RuntimePath, part.model, state.Preferences.Backend, performanceFirst(state), part.draft, part.voice, part.emotion, path, progress)
	}
	id := schema.NewID()
	sequence := 0
	seconds := 0.0
	event := func() AudioEvent {
		return AudioEvent{Event: "audio", ID: id, ProjectID: part.draft.ID, Sequence: sequence}
	}
	start := event()
	start.Start = true
	if err = w.publishAudio(ctx, start); err != nil {
		return "", err
	}
	defer func() {
		sequence++
		end := event()
		end.End = true
		end.Cancelled = err != nil
		finish, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
		defer cancel()
		_ = w.publishAudio(finish, end)
	}()
	return w.engine.Generate(ctx, *state.RuntimePath, part.model, state.Preferences.Backend, performanceFirst(state), part.draft, part.voice, part.emotion, path, progress, func(encoded string) error {
		sequence++
		chunk := event()
		chunk.Audio = encoded
		if err := w.publishAudio(ctx, chunk); err != nil {
			return err
		}
		if data, err := base64.StdEncoding.DecodeString(encoded); err == nil {
			if duration, err := audio.DurationBytes(data); err == nil {
				seconds += duration
			}
		}
		progress(msg.ActivityStreamingAudio, msg.Params{"chunks": sequence, "seconds": strconv.FormatFloat(seconds, 'f', 1, 64)})
		return nil
	})
}
