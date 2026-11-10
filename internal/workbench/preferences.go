package workbench

import (
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

// performanceFirstEngine 是性能优先模式所需的最低内核：各模型的 perf_mode=cuda_perf 从 v0.9.3 起才有。
const performanceFirstEngine = "v0.9.3"

// performanceFirst 判断本次生成是否启用性能优先：旧内核不认识 cuda_perf，传入会导致模型加载失败。
func performanceFirst(s schema.State) bool {
	return s.Preferences.PerformanceFirst && s.RuntimeVersion != nil && catalog.VersionAtLeast(*s.RuntimeVersion, performanceFirstEngine)
}
