package workbench

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func (w *Workbench) ImportVoice(ctx context.Context, path, name string) (Voice, error) {
	return w.importVoice(ctx, path, name, "", "")
}

func (w *Workbench) importVoice(ctx context.Context, path, name, referenceText, sourceID string) (Voice, error) {
	info, e := os.Stat(path)
	if e != nil {
		return Voice{}, e
	}
	if !info.Mode().IsRegular() || info.Size() > 20<<20 {
		return Voice{}, Err(MsgErrAudioTooLarge, nil)
	}
	originalPath := path
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	duration, e := Duration(path)
	if e != nil {
		temporary, err := os.MkdirTemp(filepath.Join(w.Store.Root, "downloads"), "audio-")
		if err != nil {
			return Voice{}, err
		}
		defer os.RemoveAll(temporary)
		executable, err := w.audioConverter()
		if err != nil {
			return Voice{}, err
		}
		path = filepath.Join(temporary, "reference.wav")
		if err = convertAudio(ctx, executable, originalPath, path); err != nil {
			return Voice{}, err
		}
		duration, e = Duration(path)
		if e != nil {
			return Voice{}, e
		}
	}
	if duration < 1 || duration > 60 {
		return Voice{}, Err(MsgErrAudioDuration, nil)
	}
	if strings.TrimSpace(name) == "" {
		name = strings.TrimSuffix(filepath.Base(originalPath), filepath.Ext(originalPath))
	}
	r := []rune(name)
	if len(r) > 100 {
		name = string(r[:100])
	}
	if err := ctx.Err(); err != nil {
		return Voice{}, err
	}
	id := newID()
	v := Voice{ID: id, Name: name, FileName: id + ".wav", Duration: duration, Source: "import", ReferenceText: referenceText, SourceGenerationID: sourceID}
	if sourceID != "" {
		v.Source = "generation"
	}
	dest, e := w.Store.MediaPath("voices", v.FileName)
	if e != nil {
		return Voice{}, e
	}
	b, e := os.ReadFile(path)
	if e != nil {
		return Voice{}, e
	}
	if len(b) > 20<<20 {
		return Voice{}, Err(MsgErrAudioTooLarge, nil)
	}
	if e = os.WriteFile(dest, b, 0600); e != nil {
		return Voice{}, e
	}
	if e = w.Store.Update(func(s *State) { s.Voices = append(s.Voices, v) }, true); e != nil {
		_ = os.Remove(dest)
		return Voice{}, e
	}
	return v, nil
}
