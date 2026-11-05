package workbench

import (
	"context"
	"encoding/base64"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
	"yovoice/internal/audio"
	"yovoice/internal/diag"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
)

// 时间线等界面里合成的音频由页面直接上传给本地服务落成临时文件，宿主弹出保存框后复制再删除，
// 不经宿主消息通道传音频字节，长音频不受消息大小限制。同一时间只保留最近一份，启动时回收遗留文件。
const exportPrefix = "export-"

func (w *Workbench) exportFile(id string) string {
	return w.exportFileAs(id, "wav")
}

func (w *Workbench) exportFileAs(id, format string) string {
	return filepath.Join(w.Store.Root, "downloads", exportPrefix+id+"."+format)
}

// ExportFormats 是导出音频可选的格式：WAV 原样，FLAC 无损压缩，M4A（AAC）体积小、手机和视频平台通用。
var ExportFormats = []string{"wav", "flac", "m4a"}

// LoudnessTargets 是导出时可选的目标响度（LUFS）：有声书 -18、播客 -16、视频平台 -14。
var LoudnessTargets = []float64{-18, -16, -14}

// exportCeiling 是归一化后允许的最高真峰值（dBTP），给后续转码留余量。
const exportCeiling = -1.0

// SaveExport 校验 WAV 文件头后写入临时文件，返回宿主取文件用的 ID。
// loudness 为 0 时原样保存；否则就地调整到目标响度，峰值受 exportCeiling 限制，结果随 ID 一起返回。
func (w *Workbench) SaveExport(r io.Reader, loudness float64) (string, *audio.Normalized, error) {
	if loudness != 0 && !slices.Contains(LoudnessTargets, loudness) {
		return "", nil, msg.Err(msg.ErrRequestInvalid, nil)
	}
	id, e := w.saveExport(r)
	if e != nil || loudness == 0 {
		return id, nil, e
	}
	result, e := audio.Normalize(w.exportFile(id), loudness, exportCeiling)
	if e != nil {
		_ = os.Remove(w.exportFile(id))
		return "", nil, e
	}
	diag.Log(w.Store.Root, "export.normalized", "target", loudness, "before", result.Before, "after", result.After, "peak", result.Peak, "limited", result.Limited)
	return id, &result, nil
}

func (w *Workbench) saveExport(r io.Reader) (string, error) {
	head := make([]byte, 12)
	if _, e := io.ReadFull(r, head); e != nil || string(head[:4]) != "RIFF" || string(head[8:]) != "WAVE" {
		return "", msg.Err(msg.ErrAudioFormat, nil)
	}
	dir := filepath.Join(w.Store.Root, "downloads")
	if e := os.MkdirAll(dir, 0700); e != nil {
		return "", e
	}
	old, _ := filepath.Glob(filepath.Join(dir, exportPrefix+"*"))
	for _, f := range old {
		_ = os.Remove(f)
	}
	id := schema.NewID()
	path := w.exportFile(id)
	f, e := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if e != nil {
		return "", e
	}
	if _, e = f.Write(head); e == nil {
		_, e = io.Copy(f, r)
	}
	if c := f.Close(); e == nil {
		e = c
	}
	if e != nil {
		_ = os.Remove(path)
		return "", e
	}
	return id, nil
}

// ExportPath 返回 SaveExport 或 EncodeExport 写入的文件路径，由宿主复制到用户选择的位置后删除。
func (w *Workbench) ExportPath(id string) (string, error) {
	if !schema.ValidID(id) {
		return "", msg.Err(msg.ErrAudioIDInvalid, nil)
	}
	for _, format := range ExportFormats {
		path := w.exportFileAs(id, format)
		if _, e := os.Stat(path); e == nil {
			return path, nil
		}
	}
	return "", msg.Err(msg.ErrAudioMissing, nil)
}

// ExportRequest 是转码导出的参数。来源是已生成的版本（Kind 为 outputs）或 SaveExport 上传的临时文件（Kind 为 export）。
// Loudness 只对版本生效，上传的临时文件在 SaveExport 时已经调整过；Cover 是 base64 编码的 JPEG 封面。
type ExportRequest struct {
	Kind     string  `json:"kind"`
	ID       string  `json:"id"`
	Format   string  `json:"format"`
	Loudness float64 `json:"loudness,omitempty"`
	Title    string  `json:"title,omitempty"`
	Album    string  `json:"album,omitempty"`
	Lyrics   string  `json:"lyrics,omitempty"`
	Cover    string  `json:"cover,omitempty"`
}

// 封面与标签的上限：封面是界面画的小图，歌词与音乐作品的歌词上限一致。
const (
	exportCoverLimit = 2 << 20
	exportTagLimit   = 20000
)

// EncodeExport 按请求生成待保存的导出文件，返回宿主取文件用的 ID 与响度调整结果。
// WAV 不带标签；FLAC 与 M4A 由随包的转换器编码，并写入标题、专辑、歌词和封面。
func (w *Workbench) EncodeExport(ctx context.Context, r ExportRequest) (string, *audio.Normalized, error) {
	if !slices.Contains(ExportFormats, r.Format) || (r.Loudness != 0 && !slices.Contains(LoudnessTargets, r.Loudness)) ||
		schema.TextLen(r.Title) > 200 || schema.TextLen(r.Album) > 200 || schema.TextLen(r.Lyrics) > exportTagLimit || len(r.Cover) > exportCoverLimit*4/3+4 {
		return "", nil, msg.Err(msg.ErrRequestInvalid, nil)
	}
	cover, e := base64.StdEncoding.DecodeString(r.Cover)
	if e != nil {
		return "", nil, msg.Err(msg.ErrRequestInvalid, nil)
	}
	var id string
	var normalized *audio.Normalized
	switch r.Kind {
	case "outputs":
		source, e := w.MediaFile("outputs", r.ID)
		if e != nil {
			return "", nil, e
		}
		f, e := os.Open(source)
		if e != nil {
			return "", nil, msg.Err(msg.ErrAudioMissing, nil)
		}
		id, normalized, e = w.SaveExport(f, r.Loudness)
		_ = f.Close()
		if e != nil {
			return "", nil, e
		}
	case "export":
		if r.Loudness != 0 {
			return "", nil, msg.Err(msg.ErrRequestInvalid, nil)
		}
		if !schema.ValidID(r.ID) {
			return "", nil, msg.Err(msg.ErrAudioIDInvalid, nil)
		}
		id = r.ID
		if _, e := os.Stat(w.exportFile(id)); e != nil {
			return "", nil, msg.Err(msg.ErrAudioMissing, nil)
		}
	default:
		return "", nil, msg.Err(msg.ErrAudioKindInvalid, nil)
	}
	if r.Format == "wav" {
		return id, normalized, nil
	}
	source := w.exportFile(id)
	defer os.Remove(source)
	converter, e := audio.Converter()
	if e != nil {
		return "", nil, e
	}
	// 十分钟的歌编码只需几秒；给足余量，避免转换器卡住时一直占着调用。
	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	tags := audio.Tags{Title: strings.TrimSpace(r.Title), Album: strings.TrimSpace(r.Album), Lyrics: strings.TrimSpace(r.Lyrics)}
	if e = audio.Encode(ctx, converter, source, w.exportFileAs(id, r.Format), r.Format, tags, cover); e != nil {
		return "", nil, e
	}
	diag.Log(w.Store.Root, "export.encoded", "format", r.Format, "cover", len(cover) > 0)
	return id, normalized, nil
}
