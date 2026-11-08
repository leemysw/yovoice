package workbench

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"yovoice/internal/catalog"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
	"yovoice/internal/score"

	"github.com/sinshu/go-meltysynth/meltysynth"
)

// RenderedTrack 是分轨工作台里一条编曲轨道的试听音频（outputs 下的临时文件）。
type RenderedTrack struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	FileName string `json:"fileName"`
}

// trackAuditionPrefix 是逐轨试听文件的前缀；每次渲染前清掉上一次的，不留在作品历史里。
const trackAuditionPrefix = "audition-track-"

// soundFont 读取已下载的第一个编曲音色库；没有时提示去下载。
func (w *Workbench) soundFont() (*meltysynth.SoundFont, error) {
	for _, m := range w.Store.Read().Models {
		if c, e := catalog.Lookup(m.ID); e == nil && c.Family == "soundfont" {
			sf, e := score.LoadSoundFont(m.Path)
			if e != nil {
				return nil, msg.Err(msg.ErrModelMoved, nil)
			}
			return sf, nil
		}
	}
	return nil, msg.Err(msg.ErrMelodySoundFontRequired, nil)
}

// RenderScoreTracks 用音色库把编曲的每条有音符的轨道单独渲染成一段音频，供分轨工作台逐轨试听、静音和独奏。
// 各轨从 0 秒对齐；轨道之间并行渲染（音色库只读共享），数量按 CPU 核数限制。
func (w *Workbench) RenderScoreTracks(ctx context.Context, sc schema.Score) ([]RenderedTrack, error) {
	if e := schema.ValidateScore(&sc); e != nil {
		return nil, e
	}
	sf, e := w.soundFont()
	if e != nil {
		return nil, e
	}
	dir, e := w.Store.MediaPath("outputs", trackAuditionPrefix+"probe.wav")
	if e != nil {
		return nil, e
	}
	dir = filepath.Dir(dir)
	old, _ := filepath.Glob(filepath.Join(dir, trackAuditionPrefix+"*.wav"))
	for _, f := range old {
		_ = os.Remove(f)
	}
	batch := schema.NewID()
	tracks := make([]RenderedTrack, 0, len(sc.Tracks))
	for _, t := range sc.Tracks {
		if len(t.Notes) > 0 {
			tracks = append(tracks, RenderedTrack{ID: t.ID, Name: t.Name, FileName: trackAuditionPrefix + batch + "-" + safeTrackID(t.ID) + ".wav"})
		}
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	errs := make([]error, len(tracks))
	limit := make(chan struct{}, max(1, runtime.NumCPU()/2))
	var wg sync.WaitGroup
	for i, rendered := range tracks {
		wg.Add(1)
		go func() {
			defer wg.Done()
			limit <- struct{}{}
			defer func() { <-limit }()
			single := sc
			for _, t := range sc.Tracks {
				if t.ID == rendered.ID {
					t.Mute = false
					single.Tracks = []schema.ScoreTrack{t}
				}
			}
			path, e := w.Store.MediaPath("outputs", rendered.FileName)
			if e == nil {
				e = score.Render(ctx, sf, single, path, "", func(int, int) {})
			}
			if e != nil {
				errs[i] = e
				cancel()
			}
		}()
	}
	wg.Wait()
	// 一条轨道出错后其余轨道会被取消：报告最初的原因，而不是随之而来的取消。
	var failure error
	for _, e := range errs {
		if e != nil && (failure == nil || errors.Is(failure, context.Canceled)) {
			failure = e
		}
	}
	if e := ctx.Err(); failure == nil && e != nil {
		failure = e
	}
	if failure != nil {
		for _, t := range tracks {
			if path, err := w.Store.MediaPath("outputs", t.FileName); err == nil {
				_ = os.Remove(path)
			}
		}
		return nil, failure
	}
	return tracks, nil
}

// safeTrackID 只保留轨道 ID 里能放进文件名的字符。
func safeTrackID(id string) string {
	return strings.Map(func(r rune) rune {
		if r == '-' || r == '_' || ('a' <= r && r <= 'z') || ('A' <= r && r <= 'Z') || ('0' <= r && r <= '9') {
			return r
		}
		return -1
	}, id)
}
