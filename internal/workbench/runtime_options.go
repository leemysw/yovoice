package workbench

import (
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"yovoice/internal/catalog"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
)

// runtimeCapabilities 确认所选引擎明确声明的模式与白名单参数，不透传任意配置。
func runtimeCapabilities(executable string) (map[string][]string, map[string][]string, map[string][]string) {
	requests, sessions, modes := map[string][]string{}, map[string][]string{}, map[string][]string{}
	if executable == "" {
		return requests, sessions, modes
	}
	for family, sessionOptions := range catalog.RuntimeOptions {
		options := catalog.GenerationOptions[family]
		file, err := os.Open(filepath.Join(filepath.Dir(executable), "model_specs", family+".json"))
		if err != nil {
			continue
		}
		var spec struct {
			Family  string   `json:"family"`
			Modes   []string `json:"modes"`
			Options map[string][]struct {
				Name string `json:"name"`
			} `json:"options"`
		}
		err = json.NewDecoder(io.LimitReader(file, 1<<20)).Decode(&spec)
		file.Close()
		if err != nil || spec.Family != family {
			continue
		}
		modes[family] = spec.Modes
		declared := map[string]bool{}
		for _, item := range spec.Options["request"] {
			declared[item.Name] = true
		}
		for _, option := range options {
			if option.RequiresRuntime && declared[option.Key] {
				requests[family] = append(requests[family], option.Key)
			}
		}
		declared = map[string]bool{}
		for _, item := range spec.Options["session"] {
			declared[family+"."+item.Name] = true
		}
		for _, option := range sessionOptions {
			if declared[option.Key] {
				sessions[family] = append(sessions[family], option.Key)
			}
		}
	}
	return requests, sessions, modes
}

// RefreshRuntimeCapabilities 在宿主选定内核后重新读取临时能力信息。
func (w *Workbench) RefreshRuntimeCapabilities() error {
	return w.Store.Update(func(s *schema.State) {
		s.RuntimeOptions, s.RuntimeSessionOptions, s.RuntimeModes = runtimeCapabilities(schema.Deref(s.RuntimePath))
	}, false)
}

// modelOptionsReady 拒绝旧项目或 API 携带当前引擎不支持的参数，避免显示已保存却实际无效。
func modelOptionsReady(state schema.State, draft schema.Draft) error {
	model, err := catalog.Lookup(draft.ModelID)
	if err != nil {
		return err
	}
	for _, option := range catalog.GenerationOptions[model.Family] {
		if option.StreamOnly && (draft.Runtime == nil || !draft.Runtime.Streaming) {
			continue
		}
		if _, set := draft.ModelOptions[model.Family][option.Key]; set && option.RequiresRuntime && !slices.Contains(state.RuntimeOptions[model.Family], option.Key) {
			return msg.Err(msg.ErrModelOptionUnsupported, msg.Params{"name": option.Key})
		}
	}
	// 设置里为当前模型族填写的会话参数，当前引擎不支持时明确报错，不静默忽略。
	if engine := state.Preferences.Engine; engine != nil {
		for key := range engine.Session {
			if strings.HasPrefix(key, model.Family+".") && !slices.Contains(state.RuntimeSessionOptions[model.Family], key) {
				return msg.Err(msg.ErrModelOptionUnsupported, msg.Params{"name": key})
			}
		}
	}
	if draft.Runtime != nil {
		if draft.Runtime.Streaming && !slices.Contains(state.RuntimeModes[model.Family], "streaming") {
			return msg.Err(msg.ErrModelOptionUnsupported, msg.Params{"name": "streaming"})
		}
		if draft.Runtime.Streaming && model.Family == "voxcpm2" && draft.ModelOptions[model.Family]["retry_badcase"] == true {
			return msg.Err(msg.ErrStreamingRetry, nil)
		}
	}
	return nil
}
