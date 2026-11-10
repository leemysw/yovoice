package workbench

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"yovoice/internal/catalog"
	"yovoice/internal/download"
	"yovoice/internal/msg"
	"yovoice/internal/platform"
	"yovoice/internal/schema"
	"yovoice/internal/store"
)

var modelTransferDirectory = regexp.MustCompile(`^\.yovoice-model-[0-9a-f]{32}$`)

func modelTransferPath(job schema.ModelDownload) string {
	name := ".yovoice-model-" + job.Token
	if !filepath.IsAbs(job.Directory) || !modelTransferDirectory.MatchString(name) {
		return ""
	}
	return filepath.Join(job.Directory, name)
}

func installedModel(s schema.State, id string) (schema.InstalledModel, bool) {
	i := slices.IndexFunc(s.Models, func(m schema.InstalledModel) bool { return m.ID == id })
	if i < 0 {
		return schema.InstalledModel{}, false
	}
	return s.Models[i], true
}

func modelUpdateAvailable(installed schema.InstalledModel, definition catalog.ModelPackage) bool {
	return installed.Managed && !installed.Pinned && installed.SHA256 != "" && installed.SHA256 != definition.MainFile().SHA256
}

// DownloadModel 下载或续传目录里的模型包。暂停的任务保留原版本和目录，避免续传时切到另一个版本。
func (w *Workbench) DownloadModel(id, version string) error {
	definition, err := catalog.Lookup(id)
	if err != nil {
		return err
	}
	return w.downloadCatalogModel(definition, version)
}

func (w *Workbench) downloadCatalogModel(definition catalog.ModelPackage, version string) error {
	id := definition.ID
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed || w.installCancel != nil {
		return msg.Err(msg.ErrBusy, nil)
	}
	s := w.Store.Read()
	if w.cancel != nil && s.Activity != nil && (s.Activity.Kind == "relocate" || s.Activity.Kind == "import") {
		return msg.Err(msg.ErrBusy, nil)
	}
	installed, exists := installedModel(s, id)
	// 导入的模型可以解除登记后另行下载，下载接口不能隐式替换外部文件的引用。
	if exists && !installed.Managed {
		return msg.Err(msg.ErrLocalModelProtected, nil)
	}
	job, pending := s.ModelDownloads[id]
	if pending {
		if version != "" && version != job.Version {
			return msg.Err(msg.ErrBusy, nil)
		}
		version = job.Version
	}
	model, err := definition.At(version)
	if err != nil {
		return err
	}
	if !pending {
		job = schema.ModelDownload{
			Version: model.MainFile().SHA256, Directory: modelDirectory(s, w.Store.Root), Token: schema.NewID(),
		}
	}
	files := model.PackageFiles()
	urls := make([]string, len(files))
	for i, file := range files {
		if urls[i], err = model.FileURL(s.Preferences.DownloadSource, file.Path); err != nil {
			return err
		}
	}
	var wheels []catalog.KokoroWheel
	if model.Family == "kokoro_tts" {
		if wheels, err = kokoroMissing(w.Store.Root); err != nil {
			return err
		}
	}
	job.Status, job.Total = "running", model.Size
	for _, wheel := range wheels {
		job.Total += wheel.Size
	}
	_, err = w.startLocked("download", msg.ActivityDownload, msg.Params{"name": model.Name}, ptr(id), func(ctx context.Context) error {
		return w.downloadModelFiles(ctx, model, job, installed, urls, wheels, s.Preferences.DownloadSource, definition.MainFile().SHA256)
	}, func(s *schema.State) {
		if s.ModelDownloads == nil {
			s.ModelDownloads = make(map[string]schema.ModelDownload)
		}
		s.ModelDownloads[id] = job
		s.ModelActivity.Received, s.ModelActivity.Total = job.Received, job.Total
	})
	return err
}

func (w *Workbench) downloadModelFiles(ctx context.Context, model catalog.ModelPackage, job schema.ModelDownload, previous schema.InstalledModel, urls []string, wheels []catalog.KokoroWheel, source, latest string) error {
	root := modelTransferPath(job)
	if root == "" {
		return msg.Err(msg.ErrRequestInvalid, nil)
	}
	// 下载目录是用户选定的卷。失联时暂停等待重新连接，不在原挂载点另建目录。
	if info, err := os.Stat(job.Directory); err != nil {
		return err
	} else if !info.IsDir() {
		return msg.Err(msg.ErrRequestInvalid, nil)
	}
	if err := os.Mkdir(root, 0700); err != nil {
		info, statErr := os.Lstat(root)
		if !errors.Is(err, os.ErrExist) || statErr != nil || !info.IsDir() {
			return err
		}
	}
	files := model.PackageFiles()
	dest := func(file catalog.ModelFile) string {
		if len(model.Files) == 0 {
			return filepath.Join(root, filepath.Base(file.Path))
		}
		return filepath.Join(root, filepath.FromSlash(model.LocalPath(file.Path)))
	}
	available, err := platform.FreeSpace(job.Directory)
	if err != nil {
		return err
	}
	need := int64(100<<20) + job.Total - model.Size
	for _, file := range files {
		path := dest(file)
		// 旧包中未变化的文件可在同一磁盘用硬链接复用。硬链接失败时按正常下载计算空间。
		if previous.Managed && download.FileSize(path) == 0 && download.FileSize(path+".part") == 0 {
			old := previous.Path
			if len(model.Files) > 0 {
				old = filepath.Join(old, filepath.FromSlash(model.LocalPath(file.Path)))
			}
			if download.FileSize(old) == file.Size {
				if digest, err := download.Hash(ctx, old); err == nil && digest == file.SHA256 {
					if os.MkdirAll(filepath.Dir(path), 0700) == nil {
						_ = os.Link(old, path)
					}
				}
			}
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		need += max(int64(0), file.Size-max(download.FileSize(path), download.FileSize(path+".part")))
	}
	if available < uint64(need) {
		return msg.Err(msg.ErrModelDirSpace, nil)
	}

	var done int64
	for i, file := range files {
		if err := download.File(ctx, w.client, urls[i], dest(file), file.SHA256, file.Size, func(received, _ int64) {
			code := msg.ActivityDownloading
			if done+received >= job.Total {
				code = msg.ActivityVerifying
			}
			w.progressOf("download", code, msg.Params{"name": model.Name}, done+received, job.Total)
		}); err != nil {
			path := dest(file)
			received := min(file.Size, max(download.FileSize(path), download.FileSize(path+".part")))
			w.progressOf("download", msg.ActivityDownloading, msg.Params{"name": model.Name}, done+received, job.Total)
			return err
		}
		done += file.Size
		w.progressOf("download", msg.ActivityDownloading, msg.Params{"name": model.Name}, done, job.Total)
	}
	if len(wheels) > 0 {
		if err := w.installKokoroWithCache(ctx, source, filepath.Join(root, ".wheels"), func(received, _ int64) {
			w.progressOf("download", msg.ActivityDownloading, msg.Params{"name": model.Name}, done+received, job.Total)
		}); err != nil {
			return err
		}
	}
	if err := os.RemoveAll(filepath.Join(root, ".wheels")); err != nil {
		return err
	}
	for _, file := range files {
		for dir := filepath.Dir(dest(file)); dir != job.Directory && store.Within(root, dir); dir = filepath.Dir(dir) {
			platform.SyncDir(dir)
		}
	}
	platform.SyncDir(job.Directory)
	path := root
	if len(model.Files) == 0 {
		path = dest(files[0])
	}
	doomed, err := w.publishModelDownload(ctx, model, job, path, latest)
	w.removeRetiredModelFiles(model.ID, doomed)
	return err
}

// publishModelDownload 提交完整的新包，再把旧包移出原位；失败或中断时旧包仍能使用。
func (w *Workbench) publishModelDownload(ctx context.Context, model catalog.ModelPackage, job schema.ModelDownload, path, latest string) ([]string, error) {
	id := model.ID
	// 与推理读取模型路径并启动的事务串行，避免推理拿到刚退役的路径。
	w.edit.Lock()
	defer w.edit.Unlock()
	w.mu.Lock()
	defer w.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	state := w.Store.Read()
	previous, _ := installedModel(state, id)
	// 内核复用旧模型时先等待推理退出，保留已校验的新包供继续。
	if previous.Managed {
		if w.cancel != nil {
			return nil, msg.Err(msg.ErrBusy, nil)
		}
		w.engine.Stop()
	}
	if err := w.Store.Update(func(s *schema.State) {
		putInstalledModel(s, schema.InstalledModel{ID: id, Path: path, Managed: true, SHA256: job.Version, Pinned: job.Version != latest})
		delete(s.ModelDownloads, id)
	}, true); err != nil {
		return nil, err
	}
	oldPath := managedModelPath(state, w.Store.Root, previous, legacyModelName(model))
	return w.retireModelFiles(state, previous, oldPath, path), nil
}

// PauseModelDownload 停止目标任务的网络传输，保留续传数据。
func (w *Workbench) PauseModelDownload(id string) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if a := w.Store.Read().ModelActivity; w.installCancel != nil && a != nil && schema.Deref(a.ModelID) == id {
		w.installCancel()
	}
	return nil
}

// DiscardModelDownload 取消指定下载，只清除该任务的目录。已安装的模型和其他任务不受影响。
func (w *Workbench) DiscardModelDownload(ctx context.Context, id string) error {
	w.mu.Lock()
	state := w.Store.Read()
	job, ok := state.ModelDownloads[id]
	if !ok {
		defer w.mu.Unlock()
		return w.discardLegacyModelDownload(state, id)
	}
	done := (<-chan struct{})(nil)
	if a := state.ModelActivity; w.installCancel != nil && a != nil && schema.Deref(a.ModelID) == id {
		w.installCancel()
		done = w.installDone
	}
	w.mu.Unlock()
	if done != nil {
		select {
		case <-done:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	state = w.Store.Read()
	if w.closed || (w.cancel != nil && state.Activity != nil && state.Activity.Kind == "relocate") {
		return msg.Err(msg.ErrBusy, nil)
	}
	current, ok := state.ModelDownloads[id]
	if !ok || current.Token != job.Token {
		return nil
	}
	if current.Status == "running" {
		return msg.Err(msg.ErrBusy, nil)
	}
	path := modelTransferPath(current)
	if path == "" || slices.ContainsFunc(state.Models, func(m schema.InstalledModel) bool { return store.Within(path, m.Path) }) {
		return msg.Err(msg.ErrRequestInvalid, nil)
	}
	if err := os.RemoveAll(path); err != nil {
		return err
	}
	return w.Store.Update(func(s *schema.State) {
		delete(s.ModelDownloads, id)
		if a := s.ModelActivity; a != nil && schema.Deref(a.ModelID) == id {
			s.ModelActivity = nil
		}
	}, true)
}

// 旧版只记录最近一次操作，没有目标版本。允许清理其传统断点，不猜测应续传哪个版本。
func (w *Workbench) discardLegacyModelDownload(state schema.State, id string) error {
	a := state.ModelActivity
	if a == nil || a.Kind != "download" || a.Status == "completed" || schema.Deref(a.ModelID) != id {
		return nil
	}
	if w.installCancel != nil || w.closed {
		return msg.Err(msg.ErrBusy, nil)
	}
	if w.cancel != nil && state.Activity != nil && state.Activity.Kind == "relocate" {
		return msg.Err(msg.ErrBusy, nil)
	}
	model, err := catalog.Lookup(id)
	if err != nil {
		return err
	}
	dir := modelDirectory(state, w.Store.Root)
	dest := modelDestination(state, w.Store.Root, model)
	for _, file := range model.PackageFiles() {
		target := dest
		if len(model.Files) > 0 {
			target = filepath.Join(dest, filepath.FromSlash(model.LocalPath(file.Path)))
		}
		// 只处理同一目录树中的临时文件，绝不跟随外部包里的目录链接。
		parent, err := filepath.EvalSymlinks(filepath.Dir(target))
		if err != nil {
			continue
		}
		realDir, err := filepath.EvalSymlinks(dir)
		if err != nil || !store.Within(realDir, parent) {
			continue
		}
		for _, temporary := range stagingFiles(target) {
			if err := os.Remove(temporary); err != nil && !errors.Is(err, os.ErrNotExist) {
				return err
			}
		}
	}
	return w.Store.Update(func(s *schema.State) { s.ModelActivity = nil }, true)
}
