package workbench

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"yovoice/internal/catalog"
	"yovoice/internal/diag"
	"yovoice/internal/download"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
)

func (w *Workbench) SavePreferences(p schema.Preferences) error {
	w.edit.Lock()
	defer w.edit.Unlock()
	return w.savePreferences(p)
}

func (w *Workbench) savePreferences(p schema.Preferences) error {
	p.ProxyURL = strings.TrimSpace(p.ProxyURL)
	if p.ProxyEnabled != nil && *p.ProxyEnabled && p.ProxyURL == "" {
		return msg.Err(msg.ErrProxyURL, nil)
	}
	if _, err := download.ParseProxy(p.ProxyURL); err != nil {
		return err
	}
	if _, e := catalog.RuntimeArchives(p.Backend); e != nil {
		return e
	}
	if _, e := catalog.Models[0].URL(p.DownloadSource); e != nil {
		return e
	}
	if p.AITimeout != 0 && (p.AITimeout < schema.AITimeoutMin || p.AITimeout > schema.AITimeoutMax) {
		return msg.Err(msg.ErrRequestInvalid, nil)
	}
	for i, feature := range p.HiddenFeatures {
		if !slices.Contains(schema.OptionalFeatures, feature) || slices.Contains(p.HiddenFeatures[:i], feature) {
			return msg.Err(msg.ErrRequestInvalid, nil)
		}
	}
	if p.Engine != nil {
		if err := p.Engine.Validate(); err != nil {
			return err
		}
		if p.Engine.Threads == 0 && p.Engine.Device == 0 && p.Engine.IdleUnloadSeconds == nil && len(p.Engine.Session) == 0 {
			p.Engine = nil
		}
	}
	if p.Transcribe != nil {
		if err := p.Transcribe.Validate(); err != nil {
			return err
		}
		if p.Transcribe.Empty() {
			p.Transcribe = nil
		}
	}
	if p.ModelDirectory != nil && !filepath.IsAbs(*p.ModelDirectory) {
		return msg.Err(msg.ErrModelDirAbsolute, nil)
	}
	if p.UiLocale == "" {
		p.UiLocale = w.Store.Read().Preferences.UiLocale
		if p.UiLocale == "" {
			p.UiLocale = schema.UiLocaleZhCN
		}
	} else if _, e := schema.ParseUiLocale(string(p.UiLocale)); e != nil {
		return e
	}
	defer func() { w.engine.Configure(w.Store.Read().Preferences.Engine) }()
	return w.Store.Update(func(s *schema.State) {
		if s.Preferences.Backend != p.Backend {
			diag.Log(w.Store.Root, "preferences.backend", "from", s.Preferences.Backend, "to", p.Backend)
		}
		s.Preferences = p
		if !w.selectRuntime(s) && runtime.GOOS == "darwin" && s.RuntimePath != nil {
			s.RuntimeBackend = ptr(p.Backend)
		}
	}, true)
}

// SetModelDirectory 只更换后续下载目录，校验并登记其中已有的目录包。
func (w *Workbench) SetModelDirectory(path string) error {
	return w.SetModelDirectoryContext(context.Background(), path)
}

func (w *Workbench) SetModelDirectoryContext(ctx context.Context, path string) error {
	w.edit.Lock()
	defer w.edit.Unlock()
	p := w.Store.Read().Preferences
	p.ModelDirectory = ptr(path)
	if err := w.savePreferences(p); err != nil {
		return err
	}
	return w.adoptModels(ctx, path, catalog.Models)
}

// adoptModels 只认完整且摘要匹配的包。应用下载的专用包目录（.yovoice-model-*）按托管登记，
// 可继续更新和随移除删除；目录根部按旧版布局放置的文件按外部导入登记，不归应用删除。
func (w *Workbench) adoptModels(ctx context.Context, dir string, models []catalog.ModelPackage) error {
	initial := w.Store.Read()
	var packages []string
	if entries, err := os.ReadDir(dir); err == nil {
		for _, entry := range entries {
			if entry.IsDir() && modelTransferDirectory.MatchString(entry.Name()) {
				packages = append(packages, filepath.Join(dir, entry.Name()))
			}
		}
	}
	var found []schema.InstalledModel
	for _, m := range models {
		if old, ok := installedModel(initial, m.ID); ok && existsPath(old.Path) {
			continue
		}
		if _, pending := initial.ModelDownloads[m.ID]; pending {
			continue
		}
		model, ok, err := adoptLegacyLayout(ctx, dir, m)
		for _, root := range packages {
			if ok || err != nil {
				break
			}
			model, ok, err = adoptPackage(ctx, root, m)
		}
		if err != nil {
			return err
		}
		if ok {
			found = append(found, model)
		}
	}
	if len(found) == 0 {
		return nil
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.Store.Update(func(s *schema.State) {
		for _, model := range found {
			if a := s.Activity; w.cancel != nil && a != nil && a.Kind == "import" && schema.Deref(a.ModelID) == model.ID {
				continue
			}
			if old, ok := installedModel(*s, model.ID); ok && existsPath(old.Path) {
				continue
			}
			if _, pending := s.ModelDownloads[model.ID]; pending {
				continue
			}
			putInstalledModel(s, model)
		}
	}, true)
}

// adoptLegacyLayout 认回旧版直接放在目录根部的包：单文件匹配当前或更新前清单，多文件须匹配当前清单。
func adoptLegacyLayout(ctx context.Context, dir string, m catalog.ModelPackage) (schema.InstalledModel, bool, error) {
	path := filepath.Join(dir, filepath.Base(m.RemotePath))
	if len(m.Files) > 0 {
		path = filepath.Join(dir, m.Directory)
	}
	main, files := m.MainFile(), m.PackageFiles()
	if len(m.Files) == 0 && download.FileSize(path) != main.Size {
		legacy := catalog.LegacyModelFiles[m.ID]
		if legacy.Size <= 0 || download.FileSize(path) != legacy.Size {
			return schema.InstalledModel{}, false, nil
		}
		main, files = legacy, []catalog.ModelFile{legacy}
	}
	ok, err := packageVerified(ctx, m, path, files)
	return schema.InstalledModel{ID: m.ID, Path: path, SHA256: main.SHA256}, ok, err
}

// adoptPackage 认回应用下载的专用包目录，按主文件摘要确定版本，再校验该版本的全部文件。
func adoptPackage(ctx context.Context, root string, m catalog.ModelPackage) (schema.InstalledModel, bool, error) {
	mainPath := filepath.Join(root, filepath.Base(m.RemotePath))
	if len(m.Files) > 0 {
		mainPath = filepath.Join(root, filepath.FromSlash(m.LocalPath(m.RemotePath)))
	}
	size := download.FileSize(mainPath)
	known := size == m.MainFile().Size
	for _, version := range m.History {
		if old, err := m.At(version.SHA256); err == nil && old.MainFile().Size == size {
			known = true
		}
	}
	if size <= 0 || !known {
		return schema.InstalledModel{}, false, nil
	}
	digest, err := download.Hash(ctx, mainPath)
	if err != nil {
		return schema.InstalledModel{}, false, ctx.Err()
	}
	version, err := m.At(digest)
	if err != nil {
		return schema.InstalledModel{}, false, nil
	}
	path := root
	if len(m.Files) == 0 {
		path = mainPath
	}
	ok, err := packageVerified(ctx, version, path, version.PackageFiles())
	latest := m.MainFile().SHA256
	return schema.InstalledModel{ID: m.ID, Path: path, Managed: true, SHA256: digest, Pinned: digest != latest}, ok, err
}

// packageVerified 校验包内每个文件的大小和摘要；path 是单文件模型的文件或多文件模型的目录。
func packageVerified(ctx context.Context, m catalog.ModelPackage, path string, files []catalog.ModelFile) (bool, error) {
	for _, file := range files {
		target := path
		if len(m.Files) > 0 {
			target = filepath.Join(path, filepath.FromSlash(m.LocalPath(file.Path)))
		}
		if file.Size <= 0 || download.FileSize(target) != file.Size {
			return false, nil
		}
		digest, err := download.Hash(ctx, target)
		if err := ctx.Err(); err != nil {
			return false, err
		}
		if err != nil || digest != file.SHA256 {
			return false, nil
		}
	}
	return true, nil
}

// performanceFirstEngine 是性能优先模式所需的最低内核：各模型的 perf_mode=cuda_perf 从 v0.9.3 起才有。
const performanceFirstEngine = "v0.9.3"

// performanceFirst 判断本次生成是否启用性能优先：旧内核不认识 cuda_perf，传入会导致模型加载失败。
func performanceFirst(s schema.State) bool {
	return s.Preferences.PerformanceFirst && s.RuntimeVersion != nil && catalog.VersionAtLeast(*s.RuntimeVersion, performanceFirstEngine)
}
