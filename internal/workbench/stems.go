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

// stemSeconds 与 midiSeconds 是分轨和扒 MIDI 接受的最长音频，与翻唱扒谱一致。
const stemSeconds, midiSeconds = 600, 600

// SeparateStems 用 HTDemucs 6-stem 把一个版本分成鼓、贝斯、人声、吉他、钢琴和其他六轨。
// 每一轨存成同一作品的一个版本，StemOf 指向原版本，所以试听、导出、加到时间线和删除都和普通版本一样；
// 已经分过的版本直接返回，分轨结果本身不能再分。
func (w *Workbench) SeparateStems(id string) error {
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
	if slices.ContainsFunc(s.History, func(g schema.Generation) bool { return g.StemOf == id }) {
		return nil
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
	_, e = w.start("generate", msg.ActivitySeparateStems, nil, &model.ID, func(ctx context.Context) error {
		dir, e := w.workDir("stems-")
		if e != nil {
			return e
		}
		defer os.RemoveAll(dir)
		mix := filepath.Join(dir, "mix.wav")
		if e := audio.ConvertStereo(ctx, converter, path, mix, engine.StemRate); e != nil {
			return e
		}
		out := filepath.Join(dir, "out")
		if e := os.Mkdir(out, 0700); e != nil {
			return e
		}
		stems, e := w.engine.SeparateStems(ctx, *s.RuntimePath, model, s.Preferences.Backend, mix, out, func(code msg.Code, params msg.Params) { w.progress(code, params, 0, 1) })
		if e != nil {
			return e
		}
		if e = ctx.Err(); e != nil {
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
			if !slices.Contains(StemNames, stem) {
				return msg.Err(msg.ErrEngineNoAudio, nil)
			}
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
		e = w.Store.Update(func(s *schema.State) {
			// 分轨紧跟在原版本后面，版本列表里排在一起。
			at := slices.IndexFunc(s.History, func(g schema.Generation) bool { return g.ID == id })
			if at < 0 {
				at = 0
			}
			s.History = slices.Insert(s.History, at+1, saved...)
		}, true)
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

// TranscribeMIDI 用 MuScriptor 把一个版本扒成多乐器 MIDI，新建一个编曲作品放进去，
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
