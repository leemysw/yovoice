package workbench

import (
	"path/filepath"
	"runtime"
	"strings"
)

func (w *Workbench) preferences(p Preferences) error {
	p.ProxyURL = strings.TrimSpace(p.ProxyURL)
	if p.ProxyEnabled != nil && *p.ProxyEnabled && p.ProxyURL == "" {
		return Err(MsgErrProxyURL, nil)
	}
	if _, err := parseProxyURL(p.ProxyURL); err != nil {
		return err
	}
	if _, e := runtimeArchives(p.Backend); e != nil {
		return e
	}
	if _, e := Catalog[0].URL(p.DownloadSource); e != nil {
		return e
	}
	if p.ModelDirectory != nil && !filepath.IsAbs(*p.ModelDirectory) {
		return Err(MsgErrModelDirAbsolute, nil)
	}
	if p.UiLocale == "" {
		p.UiLocale = w.Store.Read().Preferences.UiLocale
		if p.UiLocale == "" {
			p.UiLocale = UiLocaleZhCN
		}
	} else if _, e := ParseUiLocale(string(p.UiLocale)); e != nil {
		return e
	}
	return w.Store.Update(func(s *State) {
		s.Preferences = p
		if p.Backend == "cpu" && w.bundledCPU != "" {
			s.RuntimePath = ptr(w.bundledCPU)
			s.RuntimeBackend = ptr("cpu")
		} else if runtime.GOOS == "darwin" && s.RuntimePath != nil {
			s.RuntimeBackend = ptr(p.Backend)
		}
	}, true)
}
