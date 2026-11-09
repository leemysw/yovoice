package workbench

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"yovoice/internal/audio"
	"yovoice/internal/diag"
	"yovoice/internal/engine"
	"yovoice/internal/msg"
	"yovoice/internal/platform"
	"yovoice/internal/schema"
	"yovoice/internal/score"
)

// 命令行的音频工具：直接处理本机文件，结果写到指定位置，不建作品也不进历史。
// 模型、引擎与转换流程和桌面端的分轨、转为 MIDI 共用同一份实现。

// SeparateFile 把一首歌分成六轨，与“导出分轨”相同的命名写进 dir 下新建的“<文件名> Stems”文件夹，返回文件夹路径。
// 文件夹在开始前建好；分离失败或取消时删除。
func (w *Workbench) SeparateFile(input, dir string) (string, error) {
	if e := localInput(input); e != nil {
		return "", e
	}
	if info, e := os.Stat(dir); e != nil || !info.IsDir() {
		return "", msg.Err(msg.ErrRequestInvalid, nil)
	}
	w.edit.Lock()
	defer w.edit.Unlock()
	s := w.Store.Read()
	model, e := w.toolModel(s, "htdemucs_6stems")
	if e != nil {
		return "", toolMissing(e, msg.ErrStemModelRequired)
	}
	converter, e := audio.Converter()
	if e != nil {
		return "", e
	}
	var vocals *schema.InstalledModel
	if splitter, e := w.toolModel(s, "bs_roformer", "lyric_align"); e == nil {
		vocals = &splitter
	}
	title := stemFileTitle(strings.TrimSuffix(filepath.Base(input), filepath.Ext(input)))
	folder, e := stemFolder(dir, title)
	if e != nil {
		return "", e
	}
	_, e = w.start("generate", msg.ActivitySeparateStems, nil, &model.ID, func(ctx context.Context) (err error) {
		defer func() {
			if err != nil {
				_ = os.RemoveAll(folder)
			}
		}()
		work, e := w.workDir("stems-")
		if e != nil {
			return e
		}
		defer os.RemoveAll(work)
		mix, out, stems, e := w.splitStems(ctx, s, model, vocals, converter, input, work)
		if e != nil {
			return e
		}
		if e = os.Rename(mix, filepath.Join(folder, stemFileName(title, ""))); e != nil {
			return e
		}
		for _, item := range stemExportOrder {
			if slices.Contains(stems, item.stem) {
				if e = os.Rename(filepath.Join(out, item.stem+".wav"), filepath.Join(folder, stemFileName(title, item.stem))); e != nil {
					return e
				}
			}
		}
		diag.Log(w.Store.Root, "stems.file_separated", "stems", len(stems))
		return nil
	})
	if e != nil {
		_ = os.RemoveAll(folder)
		return "", e
	}
	w.tagActivity("stems")
	return folder, nil
}

// TranscribeMIDIFile 用 MuScriptor 把一首歌转为多乐器 MIDI（含鼓）写到 output（.mid）；以 .json 结尾时写编曲乐谱 JSON，
// 可以直接编辑后用音色库渲染。已有文件时拒绝。
func (w *Workbench) TranscribeMIDIFile(input, output string) error {
	if e := localInput(input); e != nil {
		return e
	}
	if _, e := os.Lstat(output); e == nil {
		return msg.Err(msg.ErrRequestInvalid, nil)
	}
	w.edit.Lock()
	defer w.edit.Unlock()
	s := w.Store.Read()
	model, e := w.toolModel(s, "muscriptor")
	if e != nil {
		return toolMissing(e, msg.ErrMidiModelRequired)
	}
	converter, e := audio.Converter()
	if e != nil {
		return e
	}
	_, e = w.start("generate", msg.ActivityTranscribeMIDI, nil, &model.ID, func(ctx context.Context) error {
		work, e := w.workDir("midi-")
		if e != nil {
			return e
		}
		defer os.RemoveAll(work)
		wav := filepath.Join(work, "song.wav")
		if e := audio.ConvertStereo(ctx, converter, input, wav, engine.StemRate); e != nil {
			return e
		}
		if seconds, e := audio.Duration(wav); e != nil {
			return e
		} else if seconds > midiSeconds {
			return msg.Err(msg.ErrAudioDuration, nil)
		}
		midi, e := w.engine.TranscribeMIDI(ctx, *s.RuntimePath, model, s.Preferences.Backend, wav, func(code msg.Code, params msg.Params) { w.progress(code, params, 0, 1) })
		if e != nil {
			return e
		}
		// 与桌面端一致先转成乐谱，再按扩展名写出 MIDI 或乐谱 JSON，和编曲页导出的文件相同。
		sc, e := score.FromMIDI(midi)
		if e != nil {
			return e
		}
		if !slices.ContainsFunc(sc.Tracks, func(t schema.ScoreTrack) bool { return len(t.Notes) > 0 }) {
			return msg.Err(msg.ErrMidiEmpty, nil)
		}
		data, e := score.Encode(output, sc)
		if e != nil {
			return e
		}
		if e = ctx.Err(); e != nil {
			return e
		}
		diag.Log(w.Store.Root, "midi.file_transcribed", "tracks", len(sc.Tracks))
		return platform.WriteFileAtomic(output, data, 0644)
	})
	if e == nil {
		w.tagActivity("midi")
	}
	return e
}

// localInput 检查命令行给的输入是存在的普通文件。
func localInput(path string) error {
	info, e := os.Stat(path)
	if e != nil || !info.Mode().IsRegular() {
		return msg.Err(msg.ErrAudioMissing, nil)
	}
	return nil
}
