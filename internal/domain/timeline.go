package domain

import (
	"strings"
	"yovoice/internal/msg"
)

// validateTimeline 限制剪辑数量和源范围，允许编辑空音轨。
func ValidateTimeline(timeline *AudioTimeline, history []Generation) error {
	if timeline == nil {
		return nil
	}
	bad := msg.Err(msg.ErrTimelineInvalid, nil)
	if len(timeline.AcceptedGenerations) > 100000 {
		return bad
	}
	for _, id := range timeline.AcceptedGenerations {
		if !ValidID(id) {
			return bad
		}
	}
	if timeline.RegenerateMode != "" && timeline.RegenerateMode != "ripple" && timeline.RegenerateMode != "preserve" {
		return bad
	}
	markerIDs := map[string]bool{}
	if len(timeline.Markers) > 2000 {
		return bad
	}
	for _, marker := range timeline.Markers {
		if marker.ID == "" || len(marker.ID) > 64 || markerIDs[marker.ID] || !InRange(marker.Time, 0, 86400) || strings.TrimSpace(marker.Name) == "" || TextLen(marker.Name) > 120 {
			return bad
		}
		markerIDs[marker.ID] = true
	}
	if len(timeline.Tracks) > 32 {
		return bad
	}
	sources := map[string]float64{}
	for _, generation := range history {
		sources[generation.ID] = generation.Duration
	}
	assets := map[string]float64{}
	for _, asset := range timeline.Assets {
		if !ValidID(asset.ID) || asset.FileName != "import-"+asset.ID+".wav" || strings.TrimSpace(asset.Name) == "" || TextLen(asset.Name) > 120 || !InRange(asset.Duration, 0.01, 3600) || assets[asset.ID] != 0 {
			return bad
		}
		assets[asset.ID] = asset.Duration
	}
	if len(assets) > 2000 {
		return bad
	}
	ids := map[string]bool{}
	count := 0
	for _, track := range timeline.Tracks {
		if !InRange(track.GainDB, -60, 12) || !InRange(track.DuckDB, 0, 36) {
			return bad
		}
		if track.ID == "" || len(track.ID) > 64 || ids[track.ID] || strings.TrimSpace(track.Name) == "" || TextLen(track.Name) > 120 {
			return bad
		}
		ids[track.ID] = true
		for _, clip := range track.Clips {
			if !InRange(clip.GainDB, -60, 12) || !InRange(clip.FadeIn, 0, 3600) || !InRange(clip.FadeOut, 0, 3600) {
				return bad
			}
			count++
			duration, exists := sources[clip.GenerationID]
			if clip.AssetID != "" {
				if clip.GenerationID != "" {
					return bad
				}
				duration, exists = assets[clip.AssetID]
			}
			if count > 2000 || clip.ID == "" || len(clip.ID) > 64 || ids[clip.ID] || !exists || !InRange(clip.Start, 0, 86400) || !InRange(clip.Offset, 0, duration) || !InRange(clip.Duration, 0.01, duration) || clip.Offset+clip.Duration > duration+0.001 || clip.Start+clip.Duration > 86400 {
				return bad
			}
			ids[clip.ID] = true
		}
	}
	return nil
}
