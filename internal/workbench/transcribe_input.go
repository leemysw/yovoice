package workbench

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"yovoice/internal/audio"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
)

// MaxTranscribeUpload 是转写请求的硬上限；用户设置的实际上限在接收时检查。
const MaxTranscribeUpload = int64(schema.TranscribeFileMBMax) << 20

// TranscribeSelection 标识等待选择音轨的上传，完成或取消后不可再使用。
type TranscribeSelection struct {
	ID     string        `json:"id"`
	Tracks []audio.Track `json:"tracks"`
}

// PrepareTranscribeSpeech 直接开始单轨转写；多轨文件原地等待选择，无需再次上传。
func (w *Workbench) PrepareTranscribeSpeech(ctx context.Context, name string, r io.Reader) (*TranscribeSelection, error) {
	path, err := w.receiveTranscribe(r)
	if err != nil {
		return nil, err
	}
	tracks, converter, err := transcribeTracks(ctx, path)
	if err == nil {
		err = ctx.Err()
	}
	if err != nil {
		_ = os.Remove(path)
		return nil, err
	}
	if len(tracks) == 1 {
		return nil, w.startTranscribeSpeech(name, path, converter, 1)
	}
	id := schema.NewID()
	if err := os.Rename(path, w.transcribeUpload(id)); err != nil {
		_ = os.Remove(path)
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		_ = w.DiscardTranscribeUpload(id)
		return nil, err
	}
	return &TranscribeSelection{ID: id, Tracks: tracks}, nil
}

// SelectTranscribeTrack 接管等待选择的上传，只能成功接管一次。
func (w *Workbench) SelectTranscribeTrack(ctx context.Context, id, name string, track int) error {
	if !schema.ValidID(id) || track < 1 {
		return msg.Err(msg.ErrTranscribeTrackInvalid, nil)
	}
	pending := w.transcribeUpload(id)
	upload := filepath.Join(filepath.Dir(pending), "upload-"+schema.NewID())
	if err := os.Rename(pending, upload); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return msg.Err(msg.ErrTranscribeTrackExpired, nil)
		}
		return err
	}
	return w.transcribeUploadTrack(ctx, name, upload, track)
}

func (w *Workbench) DiscardTranscribeUpload(id string) error {
	if !schema.ValidID(id) {
		return msg.Err(msg.ErrRequestInvalid, nil)
	}
	if err := os.Remove(w.transcribeUpload(id)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func (w *Workbench) transcribeUpload(id string) string {
	return filepath.Join(w.Store.Root, "downloads", "upload-transcribe-"+id)
}

// TranscribeSpeech 供 CLI 和直接调用方使用，未指定时沿用第一条音轨。
func (w *Workbench) TranscribeSpeech(name string, r io.Reader) error {
	return w.TranscribeSpeechTrack(context.Background(), name, r, 1)
}

func (w *Workbench) TranscribeSpeechTrack(ctx context.Context, name string, r io.Reader, track int) error {
	if track < 1 {
		return msg.Err(msg.ErrTranscribeTrackInvalid, nil)
	}
	upload, err := w.receiveTranscribe(r)
	if err != nil {
		return err
	}
	return w.transcribeUploadTrack(ctx, name, upload, track)
}

func (w *Workbench) receiveTranscribe(r io.Reader) (string, error) {
	w.edit.Lock()
	s := w.Store.Read()
	_, err := w.toolModel(s, "qwen3_asr")
	w.edit.Unlock()
	if err != nil {
		return "", err
	}
	limit, size := s.Preferences.Transcribe.FileLimit()
	return w.receiveUpTo(r, limit, msg.Err(msg.ErrTranscribeTooLarge, msg.Params{"size": size}))
}

func (w *Workbench) transcribeUploadTrack(ctx context.Context, name, upload string, track int) error {
	tracks, converter, err := transcribeTracks(ctx, upload)
	if err == nil {
		err = ctx.Err()
	}
	if err == nil && track > len(tracks) {
		err = msg.Err(msg.ErrTranscribeTrackInvalid, nil)
	}
	if err != nil {
		_ = os.Remove(upload)
		return err
	}
	return w.startTranscribeSpeech(name, upload, converter, track)
}

func transcribeTracks(ctx context.Context, upload string) ([]audio.Track, string, error) {
	if err := ctx.Err(); err != nil {
		return nil, "", err
	}
	if _, err := audio.Duration(upload); err == nil {
		return []audio.Track{{Number: 1}}, "", nil
	}
	converter, err := audio.Converter()
	if err != nil {
		return nil, "", err
	}
	prober, err := audio.Prober()
	if err != nil {
		return nil, "", err
	}
	tracks, err := audio.AudioTracks(ctx, prober, upload)
	return tracks, converter, err
}
