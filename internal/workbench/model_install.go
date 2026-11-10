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
	return filepath.Join(modelDirectory(s, root), legacyModelName(m))
}

func legacyModelName(m catalog.ModelPackage) string {
	if len(m.Files) > 0 {
		return m.Directory
	}
	return filepath.Base(m.RemotePath)
}

// ForgetModel 移除模型登记。应用自己下载的模型同时删除文件释放空间（连同下载、更新中途留下的临时文件）；
// 外部导入的模型只解除登记，保留本地文件。
// 生成等主操作进行中不能移除（会停止推理引擎）；下载其他模型时可同时移除。
func (w *Workbench) ForgetModel(id string) error {
	doomed, err := w.retireModel(id)
	if err != nil {
		return err
	}
	w.removeRetiredModelFiles(id, doomed)
	return nil
}

// 真正删除放在锁外：删几 GB 的模型期间不挡住生成、下载与取消。
func (w *Workbench) removeRetiredModelFiles(id string, doomed []string) {
	for _, path := range doomed {
		if err := os.RemoveAll(path); err != nil {
			diag.Log(w.Store.Root, "model.files_remove_failed", "model_id", id, "path", path, "error", diag.Error(err))
		}
	}
}

// retireModel 在锁内解除登记，并把要删除的文件改名移出原位（同目录改名瞬间完成），返回待删除的路径。
// 改名后再开始的同名下载不会与删除赛跑；进程在删除前退出时，带 deletingSuffix 的残留由清理回收。
func (w *Workbench) retireModel(id string) ([]string, error) {
	w.edit.Lock()
	defer w.edit.Unlock()
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
	model, _ := installedModel(state, id)
	definition, _ := catalog.Lookup(id)
	return w.retireModelFiles(state, model, managedModelPath(state, w.Store.Root, model, legacyModelName(definition)), ""), nil
}

// retireModelFiles 在登记提交后、仍持有 mu 时移走旧文件；新包和其他模型的路径必须保留。
func (w *Workbench) retireModelFiles(state schema.State, model schema.InstalledModel, path, replacement string) []string {
	protected := func(candidate string) bool {
		if modelPathsOverlap(candidate, replacement) || slices.ContainsFunc(state.Models, func(other schema.InstalledModel) bool {
			return other.ID != model.ID && modelPathsOverlap(candidate, other.Path)
		}) {
			return true
		}
		for id, job := range state.ModelDownloads {
			if id != model.ID && modelPathsOverlap(candidate, modelTransferPath(job)) {
				return true
			}
		}
		return false
	}
	if path == "" || protected(path) {
		return nil
	}
	score.ForgetSoundFont(model.Path)
	var doomed []string
	for _, candidate := range append([]string{path}, stagingFiles(path)...) {
		if candidate != path && protected(candidate) {
			continue
		}
		if _, err := os.Lstat(candidate); err != nil {
			continue
		}
		target := candidate + "." + schema.NewID() + deletingSuffix
		if err := os.Rename(candidate, target); err != nil {
			// 未能移走的文件留在原处；释放锁后不能删除可能已被新任务使用的路径。
			diag.Log(w.Store.Root, "model.files_retire_failed", "model_id", model.ID, "path", candidate, "error", diag.Error(err))
			continue
		}
		doomed = append(doomed, target)
	}
	return doomed
}

// managedModelPath 返回应用托管的文件或包目录；其他模型和下载任务的引用在退役前另行检查。
func managedModelPath(s schema.State, root string, model schema.InstalledModel, legacyName string) string {
	if !model.Managed || !filepath.IsAbs(model.Path) {
		return ""
	}
	if owned := modelPackageDirectory(model.Path); owned != "" {
		return owned
	}
	path := filepath.Clean(model.Path)
	dirs := []string{filepath.Join(root, "models"), modelDirectory(s, root)}
	if slices.ContainsFunc(dirs, func(dir string) bool { return store.SamePath(dir, path) }) {
		return ""
	}
	// 旧版托管包可能留在上一次设置的目录中，只有符合该型号下载布局的路径才能移除。
	if store.SamePath(filepath.Base(path), legacyName) || slices.ContainsFunc(dirs, func(dir string) bool { return store.Within(dir, path) }) {
		return path
	}
	return ""
}

func modelPathsOverlap(a, b string) bool {
	if a == "" || b == "" {
		return false
	}
	if store.Within(a, b) || store.Within(b, a) {
		return true
	}
	// 外部导入可能通过符号链接引用同一个包。
	realA, errA := filepath.EvalSymlinks(a)
	realB, errB := filepath.EvalSymlinks(b)
	return errA == nil && errB == nil && (store.Within(realA, realB) || store.Within(realB, realA))
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
