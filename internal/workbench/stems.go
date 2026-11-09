package workbench

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
	"yovoice/internal/audio"
	"yovoice/internal/diag"
	"yovoice/internal/engine"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
	"yovoice/internal/score"
)

// StemNames 是 HTDemucs 6-stem 输出的分轨名。
var StemNames = []string{"drums", "bass", "other", "vocals", "guitar", "piano"}

// stemSeconds 与 midiSeconds 是分轨和转为 MIDI 接受的最长音频，与翻唱扒谱一致。
const stemSeconds, midiSeconds = 600, 600

// SeparateStems 用 HTDemucs 6-stem 把一个版本分成鼓、贝斯、人声、吉他、钢琴和其他六轨。
// 每一轨存成同一作品的一个版本，StemOf 指向原版本，所以试听、导出、加到时间线和删除都和普通版本一样；
// 已经分过的版本默认直接返回；replace 时重新分离，成功后才用新分轨换掉旧的，失败或取消时旧分轨保持不动。
// 分轨结果本身不能再分。
func (w *Workbench) SeparateStems(id string, replace bool) error {
	if !schema.ValidID(id) {
		return msg.Err(msg.ErrAudioIDInvalid, nil)
	}
	w.edit.Lock()
	defer w.edit.Unlock()
	s := w.Store.Read()
	i := slices.IndexFunc(s.History, func(g schema.Generation) bool { return g.ID == id })
	if i < 0 {
		return msg.Err(msg.ErrAudioMissing, nil)
	}
	source := s.History[i]
	if source.StemOf != "" || source.Segment != nil {
		return msg.Err(msg.ErrStemSource, nil)
	}
	old := stemIDs(s, id)
	if len(old) > 0 && !replace {
		return nil
	}
	if inTimeline(s, old) {
		return msg.Err(msg.ErrTimelineInUse, nil)
	}
	if source.Duration > stemSeconds {
		return msg.Err(msg.ErrAudioDuration, nil)
	}
	model, e := w.toolModel(s, "htdemucs_6stems")
	if e != nil {
		return toolMissing(e, msg.ErrStemModelRequired)
	}
	path, e := w.MediaFile("outputs", id)
	if e != nil {
		return e
	}
	converter, e := audio.Converter()
	if e != nil {
		return e
	}
	// 装了 BS-RoFormer（单独下载，或歌词对齐包里带的）时先用它分出人声，HTDemucs 只拆伴奏：
	// BS-RoFormer 的人声明显比 HTDemucs 干净，人声也不再串进其他轨。
	splitter, splitErr := w.toolModel(s, "bs_roformer", "lyric_align")
	var vocalModel *schema.InstalledModel
	if splitErr == nil {
		vocalModel = &splitter
	}
	_, e = w.start("generate", msg.ActivitySeparateStems, nil, &model.ID, func(ctx context.Context) error {
		dir, e := w.workDir("stems-")
		if e != nil {
			return e
		}
		defer os.RemoveAll(dir)
		_, out, stems, e := w.splitStems(ctx, s, model, vocalModel, converter, path, dir)
		if e != nil {
			return e
		}
		now := time.Now()
		var written []string
		keep := false
		defer func() {
			if !keep {
				for _, f := range written {
					_ = os.Remove(f)
				}
			}
		}()
		var saved []schema.Generation
		for _, stem := range stems {
			stemID := schema.NewID()
			file := outputFileName(stemID, now, source.Title+" "+stem)
			dest, e := w.Store.MediaPath("outputs", file)
			if e != nil {
				return e
			}
			if e = os.Rename(filepath.Join(out, stem+".wav"), dest); e != nil {
				return e
			}
			written = append(written, dest)
			duration, e := audio.Duration(dest)
			if e != nil {
				return e
			}
			saved = append(saved, schema.Generation{ID: stemID, Title: source.Title, FileName: file, CreatedAt: now.UTC(), Duration: duration, Settings: source.Settings, StemOf: id, Stem: stem})
		}
		// 旧分轨在同一次状态更新里删掉，分离期间又放上时间线的话整体失败，旧分轨保留。
		w.edit.Lock()
		current := w.Store.Read()
		e = w.dropOutputs(current, stemIDs(current, id), func(s *schema.State) {
			// 分轨紧跟在原版本后面，版本列表里排在一起。
			at := slices.IndexFunc(s.History, func(g schema.Generation) bool { return g.ID == id })
			if at < 0 {
				at = 0
			}
			s.History = slices.Insert(s.History, at+1, saved...)
		})
		w.edit.Unlock()
		if e != nil {
			return e
		}
		keep = true
		diag.Log(w.Store.Root, "stems.separated", "generation_id", id, "stems", len(saved))
		return nil
	}, "", source.Settings.ID)
	if e == nil {
		w.tagActivity("stems")
	}
	return e
}

// splitStems 把 path 转成 HTDemucs 要求的双声道 WAV 后分轨，结果放在 dir/out 下（每轨一个 <名称>.wav）。
// vocals 不为空时先用它分出人声，HTDemucs 只拆伴奏；最后补齐“其他”轨，各轨相加即原曲。返回转换后的混音路径。
func (w *Workbench) splitStems(ctx context.Context, s schema.State, model schema.InstalledModel, vocals *schema.InstalledModel, converter, path, dir string) (mix, out string, stems []string, e error) {
	mix = filepath.Join(dir, "mix.wav")
	if e = audio.ConvertStereo(ctx, converter, path, mix, engine.StemRate); e != nil {
		return
	}
	if seconds, err := audio.Duration(mix); err != nil {
		return "", "", nil, err
	} else if seconds > stemSeconds {
		return "", "", nil, msg.Err(msg.ErrAudioDuration, nil)
	}
	out = filepath.Join(dir, "out")
	if e = os.Mkdir(out, 0700); e != nil {
		return
	}
	progress := func(code msg.Code, params msg.Params) { w.progress(code, params, 0, 1) }
	input, vocalFile := mix, ""
	if vocals != nil {
		vocalFile, input = filepath.Join(dir, "vocals.wav"), filepath.Join(dir, "instrumental.wav")
		if e = w.engine.SplitVocals(ctx, *s.RuntimePath, *vocals, s.Preferences.Backend, mix, vocalFile, input, false, progress); e != nil {
			return
		}
	}
	if stems, e = w.engine.SeparateStems(ctx, *s.RuntimePath, model, s.Preferences.Backend, input, out, progress); e != nil {
		return
	}
	if e = ctx.Err(); e != nil {
		return
	}
	for _, stem := range stems {
		if !slices.Contains(StemNames, stem) {
			return "", "", nil, msg.Err(msg.ErrEngineNoAudio, nil)
		}
	}
	e = completeStems(mix, out, vocalFile, stems)
	return
}

// DeleteStems 删除一个版本的全部分轨，原版本保留；有分轨在时间线上时拒绝。
func (w *Workbench) DeleteStems(id string) error {
	if !schema.ValidID(id) {
		return msg.Err(msg.ErrAudioIDInvalid, nil)
	}
	w.edit.Lock()
	defer w.edit.Unlock()
	s := w.Store.Read()
	ids := stemIDs(s, id)
	if len(ids) == 0 {
		return nil
	}
	if e := w.dropOutputs(s, ids, nil); e != nil {
		return e
	}
	diag.Log(w.Store.Root, "stems.deleted", "generation_id", id, "stems", len(ids))
	return nil
}

// stemIDs 返回一个版本的分轨记录 ID。
func stemIDs(s schema.State, id string) []string {
	var ids []string
	for _, g := range s.History {
		if g.StemOf == id {
			ids = append(ids, g.ID)
		}
	}
	return ids
}

// inTimeline 判断这些生成记录是否有片段放在时间线上。
func inTimeline(s schema.State, ids []string) bool {
	for _, draft := range s.Drafts {
		if draft.Timeline == nil {
			continue
		}
		for _, track := range draft.Timeline.Tracks {
			if slices.ContainsFunc(track.Clips, func(c schema.AudioClip) bool { return slices.Contains(ids, c.GenerationID) }) {
				return true
			}
		}
	}
	return false
}

// TranscribeMIDI 用 MuScriptor 把一个版本转为多乐器 MIDI，新建一个编曲作品放进去，
// 编曲页可以继续编辑并用音色库重新渲染。新作品的 ID 放进会话状态 MidiImport，由界面打开。
func (w *Workbench) TranscribeMIDI(id string) error {
	if !schema.ValidID(id) {
		return msg.Err(msg.ErrAudioIDInvalid, nil)
	}
	w.edit.Lock()
	defer w.edit.Unlock()
	s := w.Store.Read()
	i := slices.IndexFunc(s.History, func(g schema.Generation) bool { return g.ID == id })
	if i < 0 {
		return msg.Err(msg.ErrAudioMissing, nil)
	}
	source := s.History[i]
	if source.Duration > midiSeconds {
		return msg.Err(msg.ErrAudioDuration, nil)
	}
	model, e := w.toolModel(s, "muscriptor")
	if e != nil {
		return toolMissing(e, msg.ErrMidiModelRequired)
	}
	path, e := w.MediaFile("outputs", id)
	if e != nil {
		return e
	}
	_, e = w.start("generate", msg.ActivityTranscribeMIDI, nil, &model.ID, func(ctx context.Context) error {
		midi, e := w.engine.TranscribeMIDI(ctx, *s.RuntimePath, model, s.Preferences.Backend, path, func(code msg.Code, params msg.Params) { w.progress(code, params, 0, 1) })
		if e != nil {
			return e
		}
		sc, e := score.FromMIDI(midi)
		if e != nil {
			return e
		}
		if !slices.ContainsFunc(sc.Tracks, func(t schema.ScoreTrack) bool { return len(t.Notes) > 0 }) {
			return msg.Err(msg.ErrMidiEmpty, nil)
		}
		if e = ctx.Err(); e != nil {
			return e
		}
		d := schema.DefaultDraft()
		d.Text, d.Kind, d.Score = "", "score", &sc
		d.Title = strings.TrimSpace(source.Title + " MIDI")
		d.ModelID = preferredModel(w.Store.Read(), "score", "musescore-general-sf2")
		w.edit.Lock()
		e = w.saveDraft(d)
		w.edit.Unlock()
		if e != nil {
			return e
		}
		result := schema.MidiImport{ID: schema.NewID(), ProjectID: d.ID, SourceID: id}
		diag.Log(w.Store.Root, "midi.transcribed", "generation_id", id, "project_id", d.ID, "tracks", len(sc.Tracks))
		return w.Store.Update(func(s *schema.State) { s.MidiImport = &result }, false)
	}, "", source.Settings.ID)
	if e == nil {
		w.tagActivity("midi")
	}
	return e
}

// DismissMidiImport 在界面打开扒出的编曲作品后清除结果。
func (w *Workbench) DismissMidiImport(id string) error {
	return w.Store.Update(func(s *schema.State) {
		if s.MidiImport != nil && s.MidiImport.ID == id {
			s.MidiImport = nil
		}
	}, false)
}

// workDir 在 runtime 下建一个临时目录，调用方用完删除。
func (w *Workbench) workDir(prefix string) (string, error) {
	runtimeDir := filepath.Join(w.Store.Root, "runtime")
	if e := os.MkdirAll(runtimeDir, 0700); e != nil {
		return "", e
	}
	return os.MkdirTemp(runtimeDir, prefix)
}

// toolMissing 把“没装识别模型”换成对应工具的提示；内核缺失等其他错误原样返回。
func toolMissing(e error, code msg.Code) error {
	var c *msg.CallError
	if errors.As(e, &c) && c.Code == msg.ErrRecognizeModelRequired {
		return msg.Err(code, nil)
	}
	return e
}

// completeStems 整理分出的各轨：先分过人声时用 BS-RoFormer 的人声替换 HTDemucs 的人声轨；
// 再把“其他”改成原曲减去其余各轨——HTDemucs 各轨相加并不严格等于原曲，没归到任何一轨的部分
// （以及伴奏里残留的人声）以前会丢掉，现在都归进“其他”，各轨相加即还原原曲。
func completeStems(mix, dir, vocals string, stems []string) error {
	if vocals != "" && slices.Contains(stems, "vocals") {
		if e := os.Rename(vocals, filepath.Join(dir, "vocals.wav")); e != nil {
			return e
		}
	}
	if !slices.Contains(stems, "other") {
		return nil
	}
	var parts []string
	for _, stem := range stems {
		if stem != "other" {
			parts = append(parts, filepath.Join(dir, stem+".wav"))
		}
	}
	return audio.Remainder(mix, parts, filepath.Join(dir, "other.wav"))
}
