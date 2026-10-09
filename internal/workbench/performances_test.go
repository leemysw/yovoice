package workbench

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
	"yovoice/internal/domain"
	"yovoice/internal/store"
)

func TestCharacterPerformancesAndCueSnapshots(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	d := domain.DefaultDraft()
	voice := domain.Voice{ID: domain.NewID(), Name: "音色", FileName: "base.wav", Duration: 1}
	emotion := domain.Voice{ID: domain.NewID(), Name: "演绎参考", FileName: "emotion.wav", Duration: 1}
	for _, v := range []domain.Voice{voice, emotion} {
		must(t, os.WriteFile(filepath.Join(w.Store.Root, "voices", v.FileName), wav(), 0600))
	}
	must(t, w.Store.Update(func(s *domain.State) { s.Voices = []domain.Voice{voice, emotion} }, true))
	d.VoiceID = ptr(voice.ID)
	angry := domain.CharacterPerformance{ID: domain.NewID(), Name: "愤怒", Settings: d.SynthesisSettings}
	angry.Settings.Mode = "reference"
	angry.Settings.EmotionVoiceID = ptr(emotion.ID)
	angry.Settings.EmotionStrength = .9
	// 不同演绎保留独立模型和音色参考。
	angry.Settings.VoiceID = ptr(emotion.ID)
	angry.Settings.VoiceMode = "clone"
	angry.Settings.ReferenceText = "演绎参考"
	angry.Settings.ModelID = "omnivoice-q8"
	c := domain.Character{ID: domain.NewID(), Name: "悟空", Settings: d.SynthesisSettings, Performances: []domain.CharacterPerformance{angry}}
	raw, _ := json.Marshal(c)
	result, err := w.Call("character.save", raw)
	must(t, err)
	c = result.(domain.Character)
	if c.Performances[0].Settings.ModelID != "omnivoice-q8" || value(c.Performances[0].Settings.VoiceID) != emotion.ID {
		t.Fatal("演绎独立模型和参数丢失")
	}
	invalid := c
	invalid.Performances = append([]domain.CharacterPerformance{}, c.Performances...)
	invalid.Performances[0].Settings.VoiceID = ptr(domain.NewID())
	raw, _ = json.Marshal(invalid)
	if _, err = w.Call("character.save", raw); err == nil {
		t.Fatal("允许不存在的演绎音色参考")
	}
	duplicate := c
	duplicate.Performances = append(append([]domain.CharacterPerformance{}, c.Performances...), c.Performances[0])
	raw, _ = json.Marshal(duplicate)
	if _, err = w.Call("character.save", raw); err == nil {
		t.Fatal("允许重复演绎")
	}
	d.Text = "你好\n站住"
	d.Kind = "story"
	d.Subtitles = &domain.SubtitleDocument{Speakers: []domain.SubtitleSpeaker{{ID: "s", CharacterID: c.ID, Settings: &d.SynthesisSettings}}, Cues: []domain.SubtitleCue{{ID: "one", Start: 0, End: 1000, Text: "你好", SpeakerID: "s"}, {ID: "two", Start: 1000, End: 2000, Text: "站住", SpeakerID: "s", Performance: &c.Performances[0]}}}
	must(t, w.SaveDraft(d))
	parts, err := d.SubtitleDrafts()
	must(t, err)
	if parts[0].Mode != d.Mode || parts[1].Mode != "reference" || parts[1].EmotionStrength != .9 || value(parts[1].VoiceID) != emotion.ID || parts[1].ModelID != "omnivoice-q8" {
		t.Fatal("逐句演绎映射错误")
	}
	// 单片段重生成走实际任务调度，保存的是该句演绎参数。
	executable, err := os.Executable()
	must(t, err)
	modelPath := filepath.Join(w.Store.Root, "model.gguf")
	must(t, os.WriteFile(modelPath, []byte("test"), 0600))
	must(t, w.Store.Update(func(s *domain.State) {
		s.Models = []domain.InstalledModel{{ID: d.ModelID, Path: modelPath}, {ID: "omnivoice-q8", Path: modelPath}}
		s.RuntimePath = &executable
		s.RuntimeBackend = ptr("cpu")
	}, true))
	must(t, w.generateAudio(d, "", "two", ""))
	w.mu.Lock()
	done := w.done
	w.mu.Unlock()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("单句生成超时")
	}
	generated := w.Store.Read()
	if generated.Activity.Status != "completed" || len(generated.History) != 1 {
		t.Fatal("单句生成失败", generated.Activity)
	}
	if generated.History[0].Settings.ModelID != "omnivoice-q8" || generated.History[0].Settings.EmotionStrength != .9 || generated.History[0].Segment.CueID != "two" {
		t.Fatal("单句重生成未使用演绎快照")
	}
	c.Performances = nil
	raw, _ = json.Marshal(c)
	_, err = w.Call("character.save", raw)
	must(t, err)
	if err = w.deleteMedia("voices", emotion.ID); err == nil {
		t.Fatal("允许删除台词快照引用的演绎素材")
	}
	restored, err := store.New(w.Store.Root)
	must(t, err)
	if restored.Read().Drafts[0].Subtitles.Cues[1].Performance.Name != "愤怒" {
		t.Fatal("演绎快照丢失")
	}
	archive := filepath.Join(t.TempDir(), "performances.yovoice")
	must(t, w.ExportProject(d.ID, archive))
	imported, err := w.ImportProject(archive)
	must(t, err)
	p := imported.Subtitles.Cues[1].Performance
	if p.Name != "愤怒" || value(p.Settings.EmotionVoiceID) == emotion.ID {
		t.Fatal("演绎归档未保留或素材未重映射")
	}
	if _, err = w.MediaFile("voices", value(p.Settings.EmotionVoiceID)); err != nil {
		t.Fatal("演绎素材未导入", err)
	}
}
