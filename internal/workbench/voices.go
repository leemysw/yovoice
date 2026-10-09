package workbench

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
	"yovoice/internal/audio"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
)

func (w *Workbench) ImportVoice(ctx context.Context, path, name string) (schema.Voice, error) {
	return w.importVoice(ctx, path, name, "", "")
}

func (w *Workbench) importVoice(ctx context.Context, path, name, referenceText, sourceID string) (schema.Voice, error) {
	info, e := os.Stat(path)
	if e != nil {
		return schema.Voice{}, e
	}
	if !info.Mode().IsRegular() || info.Size() > 20<<20 {
		return schema.Voice{}, msg.Err(msg.ErrAudioTooLarge, nil)
	}
	originalPath := path
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	duration, e := audio.Duration(path)
	if e != nil {
		temporary, err := os.MkdirTemp(filepath.Join(w.Store.Root, "downloads"), "audio-")
		if err != nil {
			return schema.Voice{}, err
		}
		defer os.RemoveAll(temporary)
		executable, err := audio.Converter()
		if err != nil {
			return schema.Voice{}, err
		}
		path = filepath.Join(temporary, "reference.wav")
		if err = audio.Convert(ctx, executable, originalPath, path); err != nil {
			return schema.Voice{}, err
		}
		duration, e = audio.Duration(path)
		if e != nil {
			return schema.Voice{}, e
		}
	}
	if duration < 1 || duration > 60 {
		return schema.Voice{}, msg.Err(msg.ErrAudioDuration, nil)
	}
	if strings.TrimSpace(name) == "" {
		name = strings.TrimSuffix(filepath.Base(originalPath), filepath.Ext(originalPath))
	}
	r := []rune(name)
	if len(r) > 100 {
		name = string(r[:100])
	}
	if err := ctx.Err(); err != nil {
		return schema.Voice{}, err
	}
	id := schema.NewID()
	v := schema.Voice{ID: id, Name: name, FileName: id + ".wav", Duration: duration, Source: "import", ReferenceText: referenceText, SourceGenerationID: sourceID}
	if sourceID != "" {
		v.Source = "generation"
	}
	dest, e := w.Store.MediaPath("voices", v.FileName)
	if e != nil {
		return schema.Voice{}, e
	}
	b, e := os.ReadFile(path)
	if e != nil {
		return schema.Voice{}, e
	}
	if len(b) > 20<<20 {
		return schema.Voice{}, msg.Err(msg.ErrAudioTooLarge, nil)
	}
	if e = os.WriteFile(dest, b, 0600); e != nil {
		return schema.Voice{}, e
	}
	if e = w.Store.Update(func(s *schema.State) { s.Voices = append(s.Voices, v) }, true); e != nil {
		_ = os.Remove(dest)
		return schema.Voice{}, e
	}
	return v, nil
}

// ImportVoiceFrom 从数据流导入参考音色，超过 20 MB 时拒绝。
func (w *Workbench) ImportVoiceFrom(ctx context.Context, r io.Reader, name string) (schema.Voice, error) {
	path, err := w.receive(r)
	if err != nil {
		return schema.Voice{}, err
	}
	defer os.Remove(path)
	return w.ImportVoice(ctx, path, name)
}

// receive 将上传内容写入临时文件，调用方负责删除。
func (w *Workbench) receive(r io.Reader) (string, error) {
	f, err := os.CreateTemp(filepath.Join(w.Store.Root, "downloads"), "upload-*")
	if err != nil {
		return "", err
	}
	n, err := io.Copy(f, io.LimitReader(r, maxUpload+1))
	if closeErr := f.Close(); err == nil {
		err = closeErr
	}
	if err == nil && n > maxUpload {
		err = msg.Err(msg.ErrAudioTooLarge, nil)
	}
	if err != nil {
		_ = os.Remove(f.Name())
		return "", err
	}
	return f.Name(), nil
}

const maxUpload = 20 << 20
