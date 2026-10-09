package workbench

import (
	"context"
	"os"
	"path/filepath"
	"slices"
)

func (w *Workbench) register(id, path string, managed bool) error {
	path, e := filepath.Abs(path)
	if e != nil {
		return e
	}
	return w.Store.Update(func(s *State) {
		s.Models = slices.DeleteFunc(s.Models, func(m InstalledModel) bool { return m.ID == id })
		s.Models = append(s.Models, InstalledModel{id, path, managed})
	}, true)
}
func (w *Workbench) download(id string) error {
	m, e := model(id)
	if e != nil {
		return e
	}
	s := w.Store.Read()
	url, e := m.URL(s.Preferences.DownloadSource)
	if e != nil {
		return e
	}
	return w.begin("download", MsgActivityDownload, MessageParams{"name": m.Name}, ptr(id), func(ctx context.Context) error {
		dir := value(s.Preferences.ModelDirectory)
		if dir == "" {
			dir = filepath.Join(w.Store.Root, "models")
		}
		if e := os.MkdirAll(dir, 0700); e != nil {
			return e
		}
		dest := filepath.Join(dir, filepath.Base(m.RemotePath))
		available, e := freeSpace(dir)
		if e != nil {
			return e
		}
		need := max(int64(0), m.Size-fileSize(dest+".part")) + (100 << 20)
		if available < uint64(need) {
			return Err(MsgErrModelDirSpace, nil)
		}
		if e = Download(ctx, w.client, url, dest, m.SHA256, m.Size, func(r, t int64) {
			code, params := MsgActivityDownloading, MessageParams{"name": m.Name}
			if r == t {
				code, params = MsgActivityVerifying, nil
			}
			w.progress(code, params, r, t)
		}); e != nil {
			return e
		}
		return w.register(id, dest, true)
	})
}
func (w *Workbench) importModel(path string) error {
	return w.begin("import", MsgActivityImport, nil, nil, func(ctx context.Context) error {
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
			size := fileSize(p)
			if !slices.ContainsFunc(Catalog, func(m ModelPackage) bool { return m.Size == size }) {
				continue
			}
			hash, e := Hash(ctx, p)
			if e != nil {
				return e
			}
			for _, m := range Catalog {
				if m.SHA256 == hash {
					if e = w.register(m.ID, p, false); e != nil {
						return e
					}
					count++
				}
			}
		}
		if count == 0 {
			return Err(MsgErrModelImportNone, nil)
		}
		return nil
	})
}
