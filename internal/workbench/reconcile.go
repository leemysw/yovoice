package workbench

import (
	"os"
	"path/filepath"
	"slices"
	"yovoice/internal/diag"
	"yovoice/internal/schema"
)

// ReconcileReport 记录启动自检修复的悬空引用数量。
type ReconcileReport struct {
	Clips    int `json:"clips"`
	Assets   int `json:"assets"`
	Accepted int `json:"accepted"`
	Previews int `json:"previews"`
	// Links 为指向已删除角色或参考音频的设置引用。
	Links int `json:"links"`
}

func (r ReconcileReport) changed() bool {
	return r.Clips+r.Assets+r.Accepted+r.Previews+r.Links > 0
}

// Reconcile 在启动时修复指向已不存在数据的引用。
// 时间线片段的源版本或导入素材缺失时，作品保存会被校验永久拒绝；
// 这里把悬空的片段、素材和已采纳记录移除，让作品恢复可编辑，而不是卡在无法保存的状态。
func (w *Workbench) Reconcile() (ReconcileReport, error) {
	w.edit.Lock()
	defer w.edit.Unlock()
	var report ReconcileReport
	s := w.Store.Read()
	generations := map[string]bool{}
	for _, g := range s.History {
		generations[g.ID] = true
	}
	// 只有确认文件不存在才算缺失：权限不足、外置盘部分不可读等暂时性错误一律视为仍存在，
	// outputs 目录本身不可访问时整体跳过文件检查，避免把暂时读不到的素材永久移除。
	outputsReadable := true
	if _, err := os.ReadDir(filepath.Join(w.Store.Root, "outputs")); err != nil {
		outputsReadable = false
		diag.Log(w.Store.Root, "state.reconcile_skipped_files", "error", diag.Error(err))
	}
	exists := func(name string) bool {
		if !outputsReadable {
			return true
		}
		path, err := w.Store.MediaPath("outputs", name)
		if err != nil {
			return false
		}
		_, err = os.Stat(path)
		return !os.IsNotExist(err)
	}
	missingAssets := map[string]map[string]bool{}
	for _, d := range s.Drafts {
		if d.Timeline == nil {
			continue
		}
		for _, asset := range d.Timeline.Assets {
			if !exists(asset.FileName) {
				if missingAssets[d.ID] == nil {
					missingAssets[d.ID] = map[string]bool{}
				}
				missingAssets[d.ID][asset.ID] = true
			}
		}
	}
	voices, characters := map[string]bool{}, map[string]bool{}
	for _, v := range s.Voices {
		voices[v.ID] = true
	}
	for _, c := range s.Characters {
		characters[c.ID] = true
	}
	// 悬空的音色引用在生成时只会报“缺少参考音频”且界面无法定位，清空后用户可直接重新选择。
	unlink := func(settings *schema.SynthesisSettings) int {
		n := 0
		for _, ref := range []**string{&settings.VoiceID, &settings.EmotionVoiceID} {
			if *ref != nil && **ref != "" && !voices[**ref] {
				*ref = nil
				n++
			}
		}
		return n
	}
	missingPreviews := map[string]bool{}
	for _, c := range s.Characters {
		if c.Preview != nil && !exists(c.Preview.FileName) {
			missingPreviews[c.ID] = true
		}
	}
	fix := func(state *schema.State, count bool) {
		for i := range state.Drafts {
			t := state.Drafts[i].Timeline
			if t == nil {
				continue
			}
			missing := missingAssets[state.Drafts[i].ID]
			assets := map[string]bool{}
			before := len(t.Assets)
			t.Assets = slices.DeleteFunc(t.Assets, func(a schema.AudioAsset) bool { return missing[a.ID] })
			for _, a := range t.Assets {
				assets[a.ID] = true
			}
			for j := range t.Tracks {
				clips := len(t.Tracks[j].Clips)
				t.Tracks[j].Clips = slices.DeleteFunc(t.Tracks[j].Clips, func(c schema.AudioClip) bool {
					if c.AssetID != "" {
						return !assets[c.AssetID]
					}
					return !generations[c.GenerationID]
				})
				if count {
					report.Clips += clips - len(t.Tracks[j].Clips)
				}
			}
			accepted := len(t.AcceptedGenerations)
			t.AcceptedGenerations = slices.DeleteFunc(t.AcceptedGenerations, func(id string) bool { return !generations[id] })
			if count {
				report.Assets += before - len(t.Assets)
				report.Accepted += accepted - len(t.AcceptedGenerations)
			}
		}
		links := 0
		for i := range state.Drafts {
			d := &state.Drafts[i]
			d.EachSettings(func(settings *schema.SynthesisSettings) { links += unlink(settings) })
			if d.CharacterID != "" && !characters[d.CharacterID] {
				links += detachCharacter(d, d.CharacterID)
			}
			if d.Subtitles != nil {
				for _, speaker := range d.Subtitles.Speakers {
					if speaker.CharacterID != "" && !characters[speaker.CharacterID] {
						links += detachCharacter(d, speaker.CharacterID)
					}
				}
			}
		}
		for i := range state.Characters {
			state.Characters[i].EachSettings(func(settings *schema.SynthesisSettings) { links += unlink(settings) })
		}
		if count {
			report.Links += links
		}
		for i := range state.Characters {
			if missingPreviews[state.Characters[i].ID] {
				state.Characters[i].Preview = nil
				if count {
					report.Previews++
				}
			}
		}
	}
	// 先在快照上计算，确有悬空引用时才写盘，避免每次启动都改写状态文件。
	probe := s
	fix(&probe, true)
	if !report.changed() {
		return report, nil
	}
	// 修复前留存一份完整快照：被移除的片段与素材可从快照中找回。
	snapshot, err := w.Store.Snapshot("reconcile")
	if err != nil {
		diag.Log(w.Store.Root, "state.reconcile_snapshot_failed", "error", diag.Error(err))
		return report, err
	}
	diag.Log(w.Store.Root, "state.reconcile_snapshot", "path", snapshot)
	if err := w.Store.Update(func(state *schema.State) { fix(state, false) }, true); err != nil {
		return report, err
	}
	diag.Log(w.Store.Root, "state.reconciled", "clips", report.Clips, "assets", report.Assets, "accepted", report.Accepted, "previews", report.Previews, "links", report.Links)
	return report, nil
}

func clearVoice(settings *schema.SynthesisSettings, id string) bool {
	changed := false
	if schema.Deref(settings.VoiceID) == id {
		settings.VoiceID, changed = nil, true
	}
	if schema.Deref(settings.EmotionVoiceID) == id {
		settings.EmotionVoiceID, changed = nil, true
	}
	return changed
}

// detachCharacter 解除作品及其说话人对角色的关联，保留已复制到作品内的合成设置。
func detachCharacter(d *schema.Draft, id string) int {
	n := 0
	if d.CharacterID == id {
		d.CharacterID = ""
		n++
	}
	if d.Subtitles != nil {
		for i := range d.Subtitles.Speakers {
			if d.Subtitles.Speakers[i].CharacterID == id {
				d.Subtitles.Speakers[i].CharacterID = ""
				n++
			}
		}
	}
	return n
}
