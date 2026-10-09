package workbench

import (
	"path/filepath"
	"runtime"
	"strings"
	"yovoice/internal/catalog"
	"yovoice/internal/domain"
	"yovoice/internal/download"
	"yovoice/internal/msg"
)

func (w *Workbench) preferences(p domain.Preferences) error {
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
			p.UiLocale = domain.UiLocaleZhCN
		}
	} else if _, e := domain.ParseUiLocale(string(p.UiLocale)); e != nil {
		return e
	}
	return w.Store.Update(func(s *domain.State) {
		s.Preferences = p
		if p.Backend == "cpu" && w.bundledCPU != "" {
			s.RuntimePath = ptr(w.bundledCPU)
			s.RuntimeBackend = ptr("cpu")
		} else if runtime.GOOS == "darwin" && s.RuntimePath != nil {
			s.RuntimeBackend = ptr(p.Backend)
		}
	}, true)
}
