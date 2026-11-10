package workbench

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"yovoice/internal/catalog"
	"yovoice/internal/download"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
)

// SetModelDirectory 更换后续下载目录；若发现已有包，则在后台校验并恢复登记。
func (w *Workbench) SetModelDirectory(path string) error {
	return w.SetModelDirectoryContext(context.Background(), path)
}

func (w *Workbench) SetModelDirectoryContext(ctx context.Context, path string) error {
	return w.setModelDirectory(ctx, path, catalog.Models)
}

func (w *Workbench) setModelDirectory(ctx context.Context, path string, models []catalog.ModelPackage) error {
	if !filepath.IsAbs(path) {
		return msg.Err(msg.ErrModelDirAbsolute, nil)
	}
	path = filepath.Clean(path)
	entries, err := os.ReadDir(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	w.edit.Lock()
	defer w.edit.Unlock()
	w.mu.Lock()
	defer w.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	state := w.Store.Read()
	if w.closed || scanningModelDirectory(state) {
		return msg.Err(msg.ErrBusy, nil)
	}

	var private []string
	for _, entry := range entries {
		if entry.IsDir() && modelTransferDirectory.MatchString(entry.Name()) {
			root := filepath.Join(path, entry.Name())
			pending := false
			for _, job := range state.ModelDownloads {
				if modelPathsOverlap(root, modelTransferPath(job)) {
					pending = true
					break
				}
			}
			if !pending {
				private = append(private, root)
			}
		}
	}
	var missing []catalog.ModelPackage
	for _, model := range models {
		if old, ok := installedModel(state, model.ID); ok && (!old.Managed || existsPath(old.Path)) {
			continue
		}
		if _, pending := state.ModelDownloads[model.ID]; pending {
			continue
		}
		if len(private) > 0 || existsPath(filepath.Join(path, legacyModelName(model))) {
			missing = append(missing, model)
		}
	}
	save := func(s *schema.State) { s.Preferences.ModelDirectory = ptr(path) }
	if len(missing) == 0 {
		return w.Store.Update(save, true)
	}
	_, err = w.startLocked("import", msg.ActivityVerifying, nil, nil, func(ctx context.Context) error {
		return w.recoverModels(ctx, path, private, missing)
	}, save)
	return err
}

func scanningModelDirectory(s schema.State) bool {
	a := s.Activity
	return a != nil && a.Kind == "import" && a.Status == "running" && a.ModelID == nil
}

type modelRecovery struct {
	model schema.InstalledModel
	files map[string]catalog.ModelFile
}

// recoverModels 先按目录结构和大小筛选，再在后台逐文件校验。相同文件只读取一次。
func (w *Workbench) recoverModels(ctx context.Context, dir string, private []string, models []catalog.ModelPackage) error {
	var candidates []modelRecovery
	for _, model := range models {
		legacy := filepath.Join(dir, legacyModelName(model))
		roots := append(slices.Clone(private), legacy)
		versions := []catalog.ModelPackage{model}
		for _, version := range model.History {
			old := model
			old.Size, old.SHA256, old.Files = version.Size, version.SHA256, version.Files
			versions = append(versions, old)
		}
		if old := catalog.LegacyModelFiles[model.ID]; len(model.Files) == 0 && old.Size > 0 {
			legacyVersion := model
			legacyVersion.Size, legacyVersion.SHA256 = old.Size, old.SHA256
			versions = append(versions, legacyVersion)
		}
		// 同时存在多个完整版本时优先选最新的目录版本。
		for _, version := range versions {
			for _, root := range roots {
				if err := ctx.Err(); err != nil {
					return err
				}
				if candidate, ok := inspectModelPackage(ctx, version, root, root != legacy); ok {
					candidates = append(candidates, candidate)
				}
			}
		}
	}

	sizes := make(map[string]int64)
	var total int64
	for _, candidate := range candidates {
		for path, file := range candidate.files {
			if _, seen := sizes[path]; !seen {
				sizes[path] = file.Size
				total += file.Size
			}
		}
	}
	w.progressOf("import", msg.ActivityVerifying, nil, 0, total)
	digests := make(map[string]string, len(sizes))
	found := make(map[string]bool)
	var installed []schema.InstalledModel
	var done int64
	for _, candidate := range candidates {
		if found[candidate.model.ID] {
			continue
		}
		valid := true
		for path, file := range candidate.files {
			digest, seen := digests[path]
			if !seen {
				var err error
				digest, err = download.HashProgress(ctx, path, func(read int64) {
					w.progressOf("import", msg.ActivityVerifying, nil, done+read, total)
				})
				if err != nil {
					digest = ""
				}
				digests[path] = digest
				done += file.Size
				w.progressOf("import", msg.ActivityVerifying, nil, done, total)
			}
			if err := ctx.Err(); err != nil {
				return err
			}
			if digest != file.SHA256 {
				valid = false
				break
			}
		}
		if valid {
			found[candidate.model.ID] = true
			installed = append(installed, candidate.model)
		}
	}

	w.progressOf("import", msg.ActivityVerifying, nil, done, done)
	w.mu.Lock()
	defer w.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	if len(installed) == 0 {
		return nil
	}
	return w.Store.Update(func(s *schema.State) {
		for _, model := range installed {
			putInstalledModel(s, model)
		}
	}, true)
}

func inspectModelPackage(ctx context.Context, model catalog.ModelPackage, root string, private bool) (modelRecovery, bool) {
	path := root
	if private && len(model.Files) == 0 {
		path = filepath.Join(root, filepath.Base(model.RemotePath))
	}
	files := make(map[string]catalog.ModelFile)
	for _, file := range model.PackageFiles() {
		target := path
		if len(model.Files) > 0 {
			target = filepath.Join(root, filepath.FromSlash(model.LocalPath(file.Path)))
		}
		info, err := os.Lstat(target)
		if err != nil || !info.Mode().IsRegular() || file.Size <= 0 || info.Size() != file.Size {
			return modelRecovery{}, false
		}
		files[target] = file
	}

	managed := true
	if private || len(model.Files) > 0 {
		// 不能把链接指向的外部文件或用户加在旧版模型目录里的其他文件收归托管。
		matched := 0
		err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if err := ctx.Err(); err != nil {
				return err
			}
			if !entry.IsDir() {
				if _, ok := files[path]; ok && entry.Type().IsRegular() {
					matched++
				} else {
					managed = false
				}
			}
			return nil
		})
		if err != nil || matched != len(files) || (private && !managed) {
			return modelRecovery{}, false
		}
	}
	return modelRecovery{
		model: schema.InstalledModel{ID: model.ID, Path: path, SHA256: model.MainFile().SHA256, Managed: managed},
		files: files,
	}, true
}
