package workbench

import (
	"context"
	"io"
	"math"
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
	temporary, e := os.MkdirTemp(filepath.Join(w.Store.Root, "downloads"), "audio-")
	if e != nil {
		return schema.Voice{}, e
	}
	defer os.RemoveAll(temporary)
	duration, e := audio.Duration(path)
	if e != nil {
		executable, err := audio.Converter()
		if err != nil {
			return schema.Voice{}, err
		}
		path = filepath.Join(temporary, "reference.wav")
		if err = audio.ConvertWithLimit(ctx, executable, originalPath, path, maxRecording); err != nil {
			return schema.Voice{}, err
		}
		duration, e = audio.Duration(path)
		if e != nil {
			return schema.Voice{}, e
		}
	}
	if duration < 1 || duration > maxRecording {
		return schema.Voice{}, msg.Err(msg.ErrAudioDuration, nil)
	}
	// 超过 60 秒的录音（整段采访、有声书章节）自动截取最清楚的一段做参考，不再要求用户先自己剪。
	var excerpt *schema.VoiceExcerpt
	if duration > maxReference {
		mono, rate, err := audio.ReadMono(path)
		if err != nil {
			return schema.Voice{}, err
		}
		span := audio.PickSpeech(mono, rate)
		clip := filepath.Join(temporary, "excerpt.wav")
		if err = audio.WriteMono(clip, mono[int(span.Start*float64(rate)):min(len(mono), int(span.End*float64(rate)))], rate); err != nil {
			return schema.Voice{}, err
		}
		if duration, err = audio.Duration(clip); err != nil {
			return schema.Voice{}, err
		}
		path, excerpt = clip, &schema.VoiceExcerpt{Start: span.Start, End: span.End, Total: math.Round(float64(len(mono))/float64(rate)*100) / 100}
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
	v := schema.Voice{ID: id, Name: name, FileName: id + ".wav", Duration: duration, Source: "import", ReferenceText: referenceText, SourceGenerationID: sourceID, Excerpt: excerpt}
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

// convertVoiceSource 把上传的原始录音转成 WAV 放进临时目录，调用方用完后执行 cleanup；不登记音色。
func (w *Workbench) convertVoiceSource(ctx context.Context, r io.Reader) (output string, cleanup func(), err error) {
	input, err := w.receive(r)
	if err != nil {
		return "", nil, err
	}
	defer os.Remove(input)
	executable, err := audio.Converter()
	if err != nil {
		return "", nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	dir, err := os.MkdirTemp(filepath.Join(w.Store.Root, "downloads"), "audio-")
	if err != nil {
		return "", nil, err
	}
	cleanup = func() { _ = os.RemoveAll(dir) }
	output = filepath.Join(dir, "source.wav")
	if err = audio.ConvertWithLimit(ctx, executable, input, output, maxRecording); err != nil {
		cleanup()
		return "", nil, err
	}
	duration, err := audio.Duration(output)
	if err == nil && (duration < 1 || duration > maxRecording) {
		err = msg.Err(msg.ErrAudioDuration, nil)
	}
	if err != nil {
		cleanup()
		return "", nil, err
	}
	return output, cleanup, nil
}

// DecodeVoiceSource 为浏览器无法解码的文件准备可试听的原始录音，不登记音色。
func (w *Workbench) DecodeVoiceSource(ctx context.Context, r io.Reader) ([]byte, error) {
	output, cleanup, err := w.convertVoiceSource(ctx, r)
	if err != nil {
		return nil, err
	}
	defer cleanup()
	return os.ReadFile(output)
}

// SuggestVoiceSource 在尚未保存的长录音里挑出最适合克隆的一段（与导入时自动截取同一算法），供选段时预先选中。
func (w *Workbench) SuggestVoiceSource(ctx context.Context, r io.Reader) (audio.Span, error) {
	output, cleanup, err := w.convertVoiceSource(ctx, r)
	if err != nil {
		return audio.Span{}, err
	}
	defer cleanup()
	mono, rate, err := audio.ReadMono(output)
	if err != nil {
		return audio.Span{}, err
	}
	return audio.PickSpeech(mono, rate), nil
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

// receive 将上传内容写入临时文件，超过 20 MB 时拒绝；调用方负责删除。
func (w *Workbench) receive(r io.Reader) (string, error) {
	return w.receiveUpTo(r, maxUpload, msg.ErrAudioTooLarge)
}

// receiveUpTo 将上传内容写入临时文件，超过 limit 字节时以 tooLarge 拒绝；调用方负责删除。
func (w *Workbench) receiveUpTo(r io.Reader, limit int64, tooLarge msg.Code) (string, error) {
	f, err := os.CreateTemp(filepath.Join(w.Store.Root, "downloads"), "upload-*")
	if err != nil {
		return "", err
	}
	n, err := io.Copy(f, io.LimitReader(r, limit+1))
	if closeErr := f.Close(); err == nil {
		err = closeErr
	}
	if err == nil && n > limit {
		err = msg.Err(tooLarge, nil)
	}
	if err != nil {
		_ = os.Remove(f.Name())
		return "", err
	}
	return f.Name(), nil
}

const maxUpload = 20 << 20

// maxReference 是参考音频的最长时长（秒）；maxRecording 是可导入录音的最长时长，超过 maxReference 时自动截取。
const maxReference, maxRecording = 60, 600

// SuggestVoiceRange 在已有参考音频里挑出最适合克隆的一段，供裁剪时一键选中。
func (w *Workbench) SuggestVoiceRange(id string) (audio.Span, error) {
	path, e := w.MediaFile("voices", id)
	if e != nil {
		return audio.Span{}, e
	}
	mono, rate, e := audio.ReadMono(path)
	if e != nil {
		return audio.Span{}, e
	}
	return audio.PickSpeech(mono, rate), nil
}
