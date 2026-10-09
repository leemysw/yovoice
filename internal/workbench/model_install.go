package workbench

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"yovoice/internal/catalog"
	"yovoice/internal/domain"
	"yovoice/internal/download"
	"yovoice/internal/msg"
	"yovoice/internal/platform"
)

func (w *Workbench) register(id, path string, managed bool) error {
	path, e := filepath.Abs(path)
	if e != nil {
		return e
	}
	return w.Store.Update(func(s *domain.State) {
		s.Models = slices.DeleteFunc(s.Models, func(m domain.InstalledModel) bool { return m.ID == id })
		s.Models = append(s.Models, domain.InstalledModel{ID: id, Path: path, Managed: managed})
	}, true)
}
func (w *Workbench) DownloadModel(id string) error {
	m, e := catalog.Lookup(id)
	if e != nil {
		return e
	}
	s := w.Store.Read()
	url, e := m.URL(s.Preferences.DownloadSource)
	if e != nil {
		return e
	}
	return w.begin("download", msg.ActivityDownload, msg.Params{"name": m.Name}, ptr(id), func(ctx context.Context) error {
		dir := value(s.Preferences.ModelDirectory)
		if dir == "" {
			dir = filepath.Join(w.Store.Root, "models")
		}
		if e := os.MkdirAll(dir, 0700); e != nil {
			return e
		}
		dest := filepath.Join(dir, filepath.Base(m.RemotePath))
		available, e := platform.FreeSpace(dir)
		if e != nil {
			return e
		}
		need := max(int64(0), m.Size-download.FileSize(dest+".part")) + (100 << 20)
		if available < uint64(need) {
			return msg.Err(msg.ErrModelDirSpace, nil)
		}
		if e = download.File(ctx, w.client, url, dest, m.SHA256, m.Size, func(r, t int64) {
			code, params := msg.ActivityDownloading, msg.Params{"name": m.Name}
			if r == t {
				code, params = msg.ActivityVerifying, nil
			}
			w.progress(code, params, r, t)
		}); e != nil {
			return e
		}
		return w.register(id, dest, true)
	})
}
func (w *Workbench) ImportModel(path string) error {
	return w.begin("import", msg.ActivityImport, nil, nil, func(ctx context.Context) error {
		paths := []string{path}
		info, e := os.Stat(path)
		if e != nil {
			return e
		}
		if info.IsDir() {
			paths, e = filepath.Glob(filepath.Join(path, "*.gguf"))
			if e != nil {
				return e
			}
		}
		count := 0
		for _, p := range paths {
			if e = ctx.Err(); e != nil {
				return e
			}
			size := download.FileSize(p)
			if !slices.ContainsFunc(catalog.Models, func(m catalog.ModelPackage) bool { return m.Size == size }) {
				continue
			}
			hash, e := download.Hash(ctx, p)
			if e != nil {
				return e
			}
			for _, m := range catalog.Models {
				if m.SHA256 == hash {
					if e = w.register(m.ID, p, false); e != nil {
						return e
					}
					count++
				}
			}
		}
		if count == 0 {
			return msg.Err(msg.ErrModelImportNone, nil)
		}
		return nil
	})
}

// ForgetModel 移除模型登记，不删除用户导入的文件。下载其他模型不占用推理引擎，可同时移除。
func (w *Workbench) ForgetModel(id string) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	activity := w.Store.Read().Activity
	if w.cancel != nil && (activity == nil || activity.Kind != "download" || activity.ModelID == nil || *activity.ModelID == id) {
		return msg.Err(msg.ErrModelForgetBlocked, nil)
	}
	w.engine.Stop()
	return w.Store.Update(func(s *domain.State) {
		s.Models = slices.DeleteFunc(s.Models, func(m domain.InstalledModel) bool { return m.ID == id })
	}, true)
}
