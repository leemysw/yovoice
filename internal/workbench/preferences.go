package workbench

import (
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

// SetModelDirectory 只更换模型下载目录，其余偏好保持不变。
func (w *Workbench) SetModelDirectory(path string) error {
	w.edit.Lock()
	defer w.edit.Unlock()
	p := w.Store.Read().Preferences
	p.ModelDirectory = ptr(path)
	if err := w.savePreferences(p); err != nil {
		return err
	}
	return w.adoptModels(path)
}

// adoptModels 登记新模型目录中已有的模型：按应用下载时的布局查找（单文件模型在目录根部，
// 多文件模型在各自子目录），单文件大小匹配当前或更新前清单，多文件大小全部匹配当前清单才视为完整。
// 已登记且文件仍在的模型保持不变。
func (w *Workbench) adoptModels(dir string) error {
	type adoptedModel struct {
		path   string
		sha256 string
	}
	found := map[string]adoptedModel{}
	for _, m := range catalog.Models {
		path := filepath.Join(dir, filepath.Base(m.RemotePath))
		sha256 := m.MainFile().SHA256
		if len(m.Files) > 0 {
			path = filepath.Join(dir, m.Directory)
			if packageRoot(m, filepath.Join(path, filepath.FromSlash(m.RemotePath))) == "" {
				continue
			}
		} else {
			size := download.FileSize(path)
			if size == 0 {
				continue
			}
			if size != m.Size {
				legacy := catalog.LegacyModelFiles[m.ID]
				if size != legacy.Size {
					continue
				}
				sha256 = legacy.SHA256
			}
		}
		found[m.ID] = adoptedModel{path: path, sha256: sha256}
	}
	if len(found) == 0 {
		return nil
	}
	return w.Store.Update(func(s *schema.State) {
		for _, m := range s.Models {
			if _, err := os.Stat(m.Path); err == nil {
				delete(found, m.ID)
			}
		}
		for id, adopted := range found {
			s.Models = slices.DeleteFunc(s.Models, func(m schema.InstalledModel) bool { return m.ID == id })
			s.Models = append(s.Models, schema.InstalledModel{ID: id, Path: adopted.path, Managed: true, SHA256: adopted.sha256})
		}
		diag.Log(w.Store.Root, "model.directory_adopted", "count", len(found))
	}, true)
}

// performanceFirstEngine 是性能优先模式所需的最低内核：各模型的 perf_mode=cuda_perf 从 v0.9.3 起才有。
const performanceFirstEngine = "v0.9.3"

// performanceFirst 判断本次生成是否启用性能优先：旧内核不认识 cuda_perf，传入会导致模型加载失败。
func performanceFirst(s schema.State) bool {
	return s.Preferences.PerformanceFirst && s.RuntimeVersion != nil && catalog.VersionAtLeast(*s.RuntimeVersion, performanceFirstEngine)
}
