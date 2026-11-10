package workbench

import (
	"os"
	"path/filepath"
	"slices"
	"yovoice/internal/catalog"
	"yovoice/internal/diag"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
	"yovoice/internal/score"
	"yovoice/internal/store"
)

func (w *Workbench) register(id, path string, managed bool, sha256 string, pinned bool) error {
	path, e := filepath.Abs(path)
	if e != nil {
		return e
	}
	return w.Store.Update(func(s *schema.State) {
		putInstalledModel(s, schema.InstalledModel{ID: id, Path: path, Managed: managed, SHA256: sha256, Pinned: pinned})
	}, true)
}

func putInstalledModel(s *schema.State, model schema.InstalledModel) {
	s.Models = slices.DeleteFunc(s.Models, func(m schema.InstalledModel) bool { return m.ID == model.ID })
	s.Models = append(s.Models, model)
}

// modelDirectory 返回下载模型存放的目录：用户设置的模型目录，否则是数据目录下的 models。
func modelDirectory(s schema.State, root string) string {
	if dir := schema.Deref(s.Preferences.ModelDirectory); dir != "" {
		return dir
	}
	return filepath.Join(root, "models")
}

// modelDestination 返回模型包下载后登记的路径：单文件模型是文件本身，多文件模型是它的子目录。
func modelDestination(s schema.State, root string, m catalog.ModelPackage) string {
	dir := modelDirectory(s, root)
	if len(m.Files) > 0 {
		return filepath.Join(dir, m.Directory)
	}
	return filepath.Join(dir, filepath.Base(m.RemotePath))
}

// ForgetModel 移除模型登记。应用自己下载的模型同时删除文件释放空间（连同下载、更新中途留下的临时文件）；
// 模型目录中原有的模型只解除登记，保留本地文件。
// 生成等主操作进行中不能移除（会停止推理引擎）；下载其他模型时可同时移除。
func (w *Workbench) ForgetModel(id string) error {
	doomed, err := w.retireModel(id)
	if err != nil {
		return err
	}
	w.removeRetired(id, doomed)
	return nil
}

// removeRetired 在锁外删除已改名的文件：删几 GB 的模型期间不挡住生成、下载与取消。
func (w *Workbench) removeRetired(id string, doomed []string) {
	for _, path := range doomed {
		if err := os.RemoveAll(path); err != nil {
			diag.Log(w.Store.Root, "model.files_remove_failed", "model_id", id, "path", path, "error", diag.Error(err))
		}
	}
}

// retireModel 在锁内解除登记，并把要删除的文件改名移出原位（同目录改名瞬间完成），返回待删除的路径。
// 改名后再开始的同名下载不会与删除赛跑；进程在删除前退出时，带 deletingSuffix 的残留由清理回收。
func (w *Workbench) retireModel(id string) ([]string, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	state := w.Store.Read()
	activity := state.ModelActivity
	if _, pending := state.ModelDownloads[id]; pending {
		return nil, msg.Err(msg.ErrModelForgetBlocked, nil)
	}
	if w.cancel != nil || (w.installCancel != nil && (activity == nil || activity.Kind != "download" || activity.ModelID == nil || *activity.ModelID == id)) {
		return nil, msg.Err(msg.ErrModelForgetBlocked, nil)
	}
	w.engine.Stop()
	if err := w.Store.Update(func(s *schema.State) {
		s.Models = slices.DeleteFunc(s.Models, func(m schema.InstalledModel) bool { return m.ID == id })
	}, true); err != nil {
		return nil, err
	}
	path := managedModelPath(state, w.Store.Root, id)
	if path == "" {
		return nil, nil
	}
	return w.retireFiles(id, path), nil
}

// retireFiles 把模型文件及其临时文件改名为待删除，调用方须持有 w.mu，并在释放锁后删除返回的路径。
func (w *Workbench) retireFiles(id, path string) []string {
	score.ForgetSoundFont(path)
	var doomed []string
	for _, candidate := range append([]string{path}, stagingFiles(path)...) {
		if _, err := os.Lstat(candidate); err != nil {
			continue
		}
		target := candidate + "." + schema.NewID() + deletingSuffix
		if err := os.Rename(candidate, target); err != nil {
			// 未能移走的文件留在原处；释放锁后不能删除可能已被新任务使用的路径。
			diag.Log(w.Store.Root, "model.files_retire_failed", "model_id", id, "path", candidate, "error", diag.Error(err))
			continue
		}
		doomed = append(doomed, target)
	}
	return doomed
}

// managedModelPath 返回可安全删除的下载模型路径：必须是应用下载的模型，位于模型目录内部（不是目录本身），
// 且没有其他已登记模型使用同一位置；否则返回空串，只解除登记。
func managedModelPath(s schema.State, root, id string) string {
	i := slices.IndexFunc(s.Models, func(m schema.InstalledModel) bool { return m.ID == id })
	if i < 0 || !s.Models[i].Managed || s.Models[i].Path == "" {
		return ""
	}
	path := filepath.Clean(s.Models[i].Path)
	owned := modelPackageDirectory(path)
	if owned != "" {
		path = owned
	}
	dirs := []string{filepath.Join(root, "models")}
	if dir := schema.Deref(s.Preferences.ModelDirectory); dir != "" {
		dirs = append(dirs, dir)
	}
	inside := slices.ContainsFunc(dirs, func(dir string) bool { return store.Within(dir, path) && !store.SamePath(dir, path) })
	if !inside && owned == "" {
		return ""
	}
	for j, m := range s.Models {
		if j != i && m.Path != "" && (store.Within(path, m.Path) || store.Within(m.Path, path)) {
			return ""
		}
	}
	return path
}

// modelPackageDirectory 识别新版下载的专用包目录，单文件模型登记的是目录中的文件。
func modelPackageDirectory(path string) string {
	path = filepath.Clean(path)
	if !filepath.IsAbs(path) {
		return ""
	}
	for _, candidate := range []string{path, filepath.Dir(path)} {
		if modelTransferDirectory.MatchString(filepath.Base(candidate)) {
			return candidate
		}
	}
	return ""
}
