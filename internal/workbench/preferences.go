package workbench

import (
	"path/filepath"
	"runtime"
	"strings"
	"yovoice/internal/catalog"
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
	return w.Store.Update(func(s *schema.State) {
		s.Preferences = p
		if p.Backend == "cpu" && w.bundledCPU != "" {
			useRuntime(s, w.bundledCPU, "cpu")
		} else if runtime.GOOS == "darwin" && s.RuntimePath != nil {
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
	return w.savePreferences(p)
}
