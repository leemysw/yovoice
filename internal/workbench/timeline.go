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

// 上传素材属于作品时间线，不写入生成记录或参考音频库。
func (w *Workbench) importTimelineAudio(ctx context.Context, path, name string) (schema.AudioAsset, error) {
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	duration, err := audio.Duration(path)
	if err != nil {
		converter, e := audio.Converter()
		if e != nil {
			return schema.AudioAsset{}, e
		}
		converted := filepath.Join(w.Store.Root, "downloads", schema.NewID()+".wav")
		defer os.Remove(converted)
		if e = audio.ConvertWithLimit(ctx, converter, path, converted, 3600); e != nil {
			return schema.AudioAsset{}, e
		}
		path = converted
		duration, err = audio.Duration(path)
	}
	if err != nil {
		return schema.AudioAsset{}, err
	}
	if !schema.InRange(duration, 0.01, 3600) {
		return schema.AudioAsset{}, msg.Err(msg.ErrTimelineImportDuration, nil)
	}
	name = strings.TrimSpace(name)
	if name == "" || schema.TextLen(name) > 120 {
		return schema.AudioAsset{}, msg.Err(msg.ErrNameLength, nil)
	}
	id := schema.NewID()
	asset := schema.AudioAsset{ID: id, Name: name, FileName: "import-" + id + ".wav", Duration: duration}
	dest, err := w.Store.MediaPath("outputs", asset.FileName)
	if err != nil {
		return schema.AudioAsset{}, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return schema.AudioAsset{}, err
	}
	if err = os.WriteFile(dest, data, 0600); err != nil {
		return schema.AudioAsset{}, err
	}
	return asset, nil
}

// 保存时核对真实源文件，不能用客户端提交的时长绕过裁剪范围校验。
func (w *Workbench) validateTimelineAssets(timeline *schema.AudioTimeline) error {
	if timeline == nil {
		return nil
	}
	if len(timeline.Assets) > 2000 {
		return msg.Err(msg.ErrTimelineInvalid, nil)
	}
	for _, asset := range timeline.Assets {
		if !schema.ValidID(asset.ID) || asset.FileName != "import-"+asset.ID+".wav" {
			return msg.Err(msg.ErrTimelineInvalid, nil)
		}
		path, err := w.Store.MediaPath("outputs", asset.FileName)
		if err != nil {
			return err
		}
		duration, err := audio.Duration(path)
		if err != nil {
			return err
		}
		if math.Abs(duration-asset.Duration) > 0.001 {
			return msg.Err(msg.ErrTimelineInvalid, nil)
		}
	}
	return nil
}

// ImportTimelineFrom 从数据流导入时间线素材，超过 20 MB 时拒绝。
func (w *Workbench) ImportTimelineFrom(ctx context.Context, r io.Reader, name string) (schema.AudioAsset, error) {
	path, err := w.receive(r)
	if err != nil {
		return schema.AudioAsset{}, err
	}
	defer os.Remove(path)
	return w.importTimelineAudio(ctx, path, name)
}
