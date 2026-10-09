package workbench

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
	"yovoice/internal/schema"
	"yovoice/internal/store"
)

func TestSubtitleMappingAndGeneration(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	d := schema.DefaultDraft()
	d.ModelID, d.VoxMode, d.Text = "voxcpm2-q8", "design", "你好\n再见"
	other := d.SynthesisSettings
	other.VoiceDescription = "温柔"
	d.Subtitles = &schema.SubtitleDocument{
		Speakers: []schema.SubtitleSpeaker{{ID: "1"}, {ID: "2", Settings: &other}},
		Cues:     []schema.SubtitleCue{{Start: 0, End: 1000, Text: "你好", SpeakerID: "1"}, {Start: 2000, End: 3000, Text: "再见", SpeakerID: "2"}},
	}
	must(t, w.SaveDraft(d))
	st, err := store.New(w.Store.Root)
	must(t, err)
	if st.Read().Drafts[0].Subtitles.Speakers[1].Settings.VoiceDescription != "温柔" {
		t.Fatal("角色参数未持久化")
	}
	executable, err := os.Executable()
	must(t, err)
	model := schema.InstalledModel{ID: d.ModelID, Path: filepath.Join(w.Store.Root, "model.gguf")}
	must(t, os.WriteFile(model.Path, []byte("test"), 0600))
	must(t, w.Store.Update(func(s *schema.State) {
		s.Models = []schema.InstalledModel{model}
		s.RuntimePath = &executable
		s.RuntimeBackend = ptr("cpu")
	}, true))
	parts, err := w.prepareSynthesis(d, w.Store.Read())
	must(t, err)
	if len(parts) != 2 || parts[1].draft.Text != "再见" || parts[1].draft.VoiceDescription != "温柔" || parts[0].draft.VoiceDescription == "温柔" {
		t.Fatal("说话人映射错误")
	}
	// 新建但未填写的句子可以保存，生成时跳过，避免阻塞已有台词。
	blank := d
	document := *d.Subtitles
	blank.Subtitles = &document
	blank.Subtitles.Cues = append(append([]schema.SubtitleCue{}, d.Subtitles.Cues...), schema.SubtitleCue{Start: 3000, End: 4000, SpeakerID: "2"})
	blank.Text += "\n"
	must(t, w.SaveDraft(blank))
	withBlank, err := w.prepareSynthesis(blank, w.Store.Read())
	must(t, err)
	if len(withBlank) != 2 {
		t.Fatal("空白句不应参与生成")
	}
	for index := range blank.Subtitles.Cues {
		blank.Subtitles.Cues[index].Text = ""
	}
	blank.Text = "\n\n"
	if _, err := w.prepareSynthesis(blank, w.Store.Read()); err == nil {
		t.Fatal("全空字幕不应生成")
	}
	blank.Subtitles.Cues = nil
	blank.Text = ""
	must(t, w.SaveDraft(blank))
	if _, err := w.prepareSynthesis(blank, w.Store.Read()); err == nil {
		t.Fatal("删除全部台词后可以保存，但不能生成")
	}
	for _, mutate := range []func(*schema.Draft){
		func(d *schema.Draft) { d.Subtitles.Cues[0].SpeakerID = "missing" },
		func(d *schema.Draft) { d.Subtitles.Cues[0].End = -1 },
		func(d *schema.Draft) { d.Text = "different" },
		func(d *schema.Draft) { d.Subtitles.Speakers[1].ID = "1" },
	} {
		broken := st.Read().Drafts[0]
		mutate(&broken)
		if w.SaveDraft(broken) == nil {
			t.Fatal("非法字幕不应保存")
		}
	}
	other.ModelID = "missing"
	if _, err = w.prepareSynthesis(d, w.Store.Read()); err == nil {
		t.Fatal("所有角色必须预检查")
	}
	other.ModelID = d.ModelID
	must(t, w.Generate(d))
	done := w.Done()
	select {
	case <-done:
	case <-time.After(15 * time.Second):
		t.Fatal("字幕生成超时")
	}
	state := w.Store.Read()
	if len(state.History) != 2 || state.History[0].Duration != 1 || state.History[1].Duration != 1 {
		t.Fatalf("字幕未保存为两个独立音频: %+v", state.Activity)
	}
	first, second := state.History[1], state.History[0]
	if first.Segment == nil || second.Segment == nil || first.Segment.BatchID != second.Segment.BatchID || first.Segment.CueID == second.Segment.CueID || second.Settings.VoiceDescription != "温柔" {
		t.Fatal("分段来源或声音快照错误")
	}
	files, err := filepath.Glob(filepath.Join(w.Store.Root, "outputs", "*.wav"))
	must(t, err)
	if len(files) != 2 {
		t.Fatal("生成阶段不应创建合并音频", files)
	}
	d = state.Drafts[0]
	d.Timeline = &schema.AudioTimeline{Tracks: []schema.AudioLane{{ID: "lane", Name: "台词", Clips: []schema.AudioClip{{ID: "clip", GenerationID: first.ID, Duration: 1}}}}}
	// 生成后自动保存及退出时重复保存都应保留正文、片段和生成记录。
	must(t, w.SaveDraft(d))
	must(t, w.SaveDraft(d))
	reopened, err := store.New(w.Store.Root)
	must(t, err)
	if len(reopened.Read().History) != 2 || reopened.Read().Drafts[0].Timeline.Tracks[0].Clips[0].GenerationID != first.ID {
		t.Fatal("生成后保存丢失作品或音频记录")
	}
	must(t, w.generateAudio(d, "", first.Segment.CueID, "clip"))
	done = w.Done()
	select {
	case <-done:
	case <-time.After(15 * time.Second):
		t.Fatal("单段生成超时")
	}
	state = w.Store.Read()
	if len(state.History) != 3 || state.History[0].Settings.Text != "你好" || state.History[0].Segment.TargetClipID != "clip" {
		t.Fatal("单段生成影响了其他台词", state.Activity)
	}
	if len(state.Drafts[0].Subtitles.Cues) != 2 {
		t.Fatal("单段生成覆盖了原作品")
	}
	if w.generateAudio(d, "", "missing", "clip") == nil {
		t.Fatal("接受了失效的台词")
	}
	d.Subtitles.Cues[1].Text = "模拟生成失败"
	d.Text = "你好\n模拟生成失败"
	must(t, w.Generate(d))
	done = w.Done()
	select {
	case <-done:
	case <-time.After(15 * time.Second):
		t.Fatal("失败任务没有结束")
	}
	state = w.Store.Read()
	if len(state.History) != 4 || state.History[0].Settings.Text != "你好" || state.Activity.Status != "failed" || state.Activity.CueID != d.Subtitles.Cues[1].ID {
		t.Fatal("后续台词失败时丢失了成功片段", state.Activity)
	}
	files, err = filepath.Glob(filepath.Join(w.Store.Root, "outputs", "*.wav"))
	must(t, err)
	if len(files) != 4 {
		t.Fatal("失败音频没有清理", files)
	}
	// 仅重试指定台词，原工程正文和其他音频不变；旧保位设置也统一使用顺延。
	d.Timeline.RegenerateMode = "preserve"
	before := len(state.History)
	must(t, w.generateAudio(d, "", first.Segment.CueID, "clip"))
	done = w.Done()
	select {
	case <-done:
	case <-time.After(15 * time.Second):
		t.Fatal("增量生成超时")
	}
	state = w.Store.Read()
	if len(state.History) != before+1 || state.History[0].Segment.TargetClipID != "clip" || state.History[0].Segment.Placement != "ripple" || len(state.Drafts[0].Subtitles.Cues) != 2 {
		t.Fatal("增量生成丢失来源或改写正文")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err = w.generateSegments(ctx, state, parts, ""); err != context.Canceled {
		t.Fatalf("取消未传播: %v", err)
	}
}
