package workbench

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"yovoice/internal/catalog"
	"yovoice/internal/download"
	"yovoice/internal/engine"
	"yovoice/internal/msg"
	"yovoice/internal/store"
)

// ImportModel 登记所选型号的本地包，保留原路径和文件，不复制、不改动下载目录。
// 单文件允许本机转换的同家族 GGUF；多文件包必须逐一通过清单校验，避免缺件时误报已安装。
func (w *Workbench) ImportModel(id, path string) error {
	model, err := catalog.Lookup(id)
	if err != nil {
		return err
	}
	if !filepath.IsAbs(path) {
		return msg.Err(msg.ErrLocalModelInvalid, nil)
	}
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return msg.Err(msg.ErrLocalModelInvalid, nil)
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	state := w.Store.Read()
	if _, pending := state.ModelDownloads[id]; pending {
		return msg.Err(msg.ErrBusy, nil)
	}
	installed, exists := installedModel(state, id)
	if exists && !store.SamePath(installed.Path, path) && (installed.Managed || existsPath(installed.Path)) {
		return msg.Err(msg.ErrLocalModelProtected, nil)
	}
	_, err = w.startLocked("import", msg.ActivityVerifying, nil, ptr(id), func(ctx context.Context) error {
		digest, err := download.Hash(ctx, path)
		if err != nil {
			return err
		}
		root := path
		if len(model.Files) > 0 {
			// 目录里的旧版也可原地登记，但配套文件必须匹配该版清单。
			model, err = model.At(digest)
			if err != nil {
				return msg.Err(msg.ErrLocalModelIncomplete, nil)
			}
			root = filepath.Dir(path)
			for range strings.Count(model.LocalPath(model.RemotePath), "/") {
				root = filepath.Dir(root)
			}
			for _, file := range model.Files {
				local := filepath.Join(root, filepath.FromSlash(model.LocalPath(file.Path)))
				if download.FileSize(local) != file.Size {
					return msg.Err(msg.ErrLocalModelIncomplete, nil)
				}
				hash, err := download.Hash(ctx, local)
				if err != nil {
					return err
				}
				if hash != file.SHA256 {
					return msg.Err(msg.ErrLocalModelIncomplete, nil)
				}
			}
		} else if digest != model.SHA256 && digest != catalog.LegacyModelFiles[id].SHA256 {
			// 声音字体沿用已发布包；GGUF 转换器版本可能改变文件大小和摘要，但家族必须与所选型号一致。
			family, err := engine.GGUFArchitecture(path)
			if err != nil || family != model.Family || model.Family == "soundfont" {
				return msg.Err(msg.ErrLocalModelInvalid, nil)
			}
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		w.engine.Stop()
		managed := exists && installed.Managed && store.SamePath(installed.Path, root)
		return w.register(id, root, managed, digest, managed && installed.Pinned)
	}, nil)
	return err
}

func existsPath(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
