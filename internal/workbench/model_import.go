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
	"yovoice/internal/schema"
	"yovoice/internal/store"
)

// ImportModel 登记所选型号的本地包，保留原路径和文件，不复制、不改动下载目录。
// 单文件允许本机转换的同家族 GGUF；多文件包必须逐一通过清单校验，避免缺件时误报已安装。
func (w *Workbench) ImportModel(id, path string) error {
	model, err := catalog.Lookup(id)
	if err != nil {
		return err
	}
	if err := checkLocalModelFile(model, path); err != nil {
		return err
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
		result, err := w.verifyLocalModel(ctx, model, path)
		if err != nil {
			return err
		}
		w.engine.Stop()
		w.mu.Lock()
		defer w.mu.Unlock()
		if err := ctx.Err(); err != nil {
			return err
		}
		current := w.Store.Read()
		if _, pending := current.ModelDownloads[id]; pending {
			return msg.Err(msg.ErrBusy, nil)
		}
		if latest, ok := installedModel(current, id); ok != exists || latest != installed {
			return msg.Err(msg.ErrLocalModelProtected, nil)
		}
		managed := exists && installed.Managed && store.SamePath(installed.Path, result.Path)
		result.Managed, result.Pinned, result.Converted = managed, managed && installed.Pinned, managed && installed.Converted
		return w.Store.Update(func(s *schema.State) { putInstalledModel(s, result) }, true)
	}, func(s *schema.State) { s.Activity.Task = "local-model-import" })
	return err
}

// 识别到版本不符时直接返回 RPC 错误，无需先读取几 GB 权重。
func checkLocalModelFile(model catalog.ModelPackage, path string) error {
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
	if model.Family == "index_tts2" {
		identity, err := engine.ReadGGUFIdentity(path)
		if err == nil && identity.IndexVersion != "" && identity.IndexVersion != indexModelVersion(model) {
			return msg.Err(msg.ErrLocalModelVersion, msg.Params{"actual": identity.IndexVersion, "expected": indexModelVersion(model)})
		}
	}
	return nil
}

func (w *Workbench) verifyLocalModel(ctx context.Context, model catalog.ModelPackage, path string) (schema.InstalledModel, error) {
	var result schema.InstalledModel
	if err := checkLocalModelFile(model, path); err != nil {
		return result, err
	}
	mainSize := download.FileSize(path)
	total := mainSize + max(0, model.Size-model.MainFile().Size)
	var done int64
	hash := func(path string) (string, error) {
		w.progressOf("import", msg.ActivityVerifying, nil, done, total)
		digest, err := download.HashProgress(ctx, path, func(received int64) {
			w.progressOf("import", msg.ActivityVerifying, nil, min(done+received, total), total)
		})
		done += download.FileSize(path)
		return digest, err
	}
	digest, err := hash(path)
	if err != nil {
		return result, err
	}
	root := path
	if len(model.Files) > 0 {
		model, err = model.At(digest)
		if err != nil {
			return result, msg.Err(msg.ErrLocalModelIncomplete, nil)
		}
		total = 0
		for _, file := range model.Files {
			total += file.Size
		}
		root = filepath.Dir(path)
		for range strings.Count(model.LocalPath(model.RemotePath), "/") {
			root = filepath.Dir(root)
		}
		for _, file := range model.Files {
			local := filepath.Join(root, filepath.FromSlash(model.LocalPath(file.Path)))
			if download.FileSize(local) != file.Size {
				return result, msg.Err(msg.ErrLocalModelIncomplete, nil)
			}
			if store.SamePath(local, path) {
				continue
			}
			digest, err := hash(local)
			if err != nil {
				return result, err
			}
			if digest != file.SHA256 {
				return result, msg.Err(msg.ErrLocalModelIncomplete, nil)
			}
		}
	} else if digest != model.SHA256 && digest != catalog.LegacyModelFiles[model.ID].SHA256 {
		family, err := engine.GGUFArchitecture(path)
		if err != nil || family != model.Family || model.Family == "soundfont" {
			return result, msg.Err(msg.ErrLocalModelInvalid, nil)
		}
		if model.Family == "index_tts2" {
			identity, err := engine.ReadGGUFIdentity(path)
			if err != nil || identity.IndexVersion != indexModelVersion(model) {
				return result, msg.Err(msg.ErrLocalModelInvalid, nil)
			}
		}
	}
	if err := ctx.Err(); err != nil {
		return result, err
	}
	w.progressOf("import", msg.ActivityVerifying, nil, total, total)
	return schema.InstalledModel{ID: model.ID, Path: root, SHA256: digest}, nil
}

func existsPath(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
