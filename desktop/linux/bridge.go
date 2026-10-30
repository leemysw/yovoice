package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"time"
)

func asCallError(err error, target **callError) bool { return errors.As(err, target) }

// handle 处理页面经 chrome.webview 发来的调用：窗口状态与文件对话框由宿主处理，其余转发给本地服务。
// 与 Windows MainWindow.HandleMessageAsync 的方法与返回值保持一致。
func (a *app) handle(m message) {
	result, err := a.dispatch(m.Method, m.Data)
	var ce *callError
	switch {
	case asCallError(err, &ce):
		hostLog(a.root, "rpc.failed:"+m.Method, err)
		a.post(map[string]any{"id": m.ID, "error": ce.wire})
	case err != nil:
		hostLog(a.root, "bridge.failed:"+m.Method, err)
		a.post(map[string]any{"id": m.ID, "error": err.Error()})
	default:
		a.post(map[string]any{"id": m.ID, "result": result})
	}
	a.mu.Lock()
	relocated := m.Method == "storage.directory" && a.storageRelocated && !a.closing
	a.mu.Unlock()
	if relocated {
		a.ask(T("数据迁移完成", "Data Moved"), T("数据已复制到新目录，yovoice 将自动重启以使用新目录；旧目录会在重启后自动删除。", "Your data has been copied to the new folder. yovoice will restart to use it; the old folder will be removed after restart."), T("立即重启", "Restart Now"))
		a.mu.Lock()
		a.restartRequested = true
		a.mu.Unlock()
		a.requestExit()
	}
}

func (a *app) pick(action int32, title, name string, filters ...fileFilter) string {
	return uiWait(func() string { return choose(a.window, action, title, name, filters...) })
}

func (a *app) dispatch(method string, data json.RawMessage) (any, error) {
	var input struct {
		Available   *bool           `json:"available"`
		Visible     *bool           `json:"visible"`
		Size        *float64        `json:"size"`
		IsCollapsed *bool           `json:"isCollapsed"`
		ID          string          `json:"id"`
		Name        string          `json:"name"`
		Version     string          `json:"version"`
		Format      string          `json:"format"`
		Text        *string         `json:"text"`
		UILocale    string          `json:"uiLocale"`
		Score       json.RawMessage `json:"score"`
	}
	_ = json.Unmarshal(data, &input)
	switch method {
	case "inspector.available":
		// 只有工作区有右侧面板，离开工作区时隐藏标题栏开关。
		available := input.Available != nil && *input.Available
		ui(func() { gtkWidgetSetVisible(a.inspectorButton, available) })
		return true, nil
	case "window.immersive":
		// macOS 播放页把网页铺进标题栏；Linux 保留系统标题栏，与 Windows 一致。
		return true, nil
	case "assistant.entry":
		// 网页右下角入口在时不重复显示标题栏入口，移走后才由标题栏接替。
		visible := input.Visible != nil && *input.Visible
		ui(func() { gtkWidgetSetVisible(a.ochoButton, visible) })
		return true, nil
	case "sidebar.save":
		if input.Size == nil || input.IsCollapsed == nil || *input.Size < 180 || *input.Size > 360 {
			return nil, errors.New(T("侧栏设置无效。", "Invalid sidebar settings."))
		}
		saved, _ := json.Marshal(map[string]any{"size": *input.Size, "isCollapsed": *input.IsCollapsed})
		return true, writeAtomic(filepath.Join(a.root, "sidebar.json"), saved)
	case "project.export":
		name := input.Name
		if name == "" {
			name = "project"
		}
		path := a.pick(chooseSave, T("导出工程", "Export Project"), filepath.Base(name)+".yovoice", fileFilter{T("Yovoice 工程", "Yovoice Project"), []string{"yovoice"}})
		if path == "" {
			return false, nil
		}
		return a.svc.Call(method, map[string]any{"id": input.ID, "path": path}, 0)
	case "logs.export":
		// 诊断包由本地服务打包写入，宿主只负责选择保存位置。
		path := a.pick(chooseSave, T("导出诊断包", "Export Diagnostics"), "yovoice-diagnostics-"+time.Now().Format("20060102-150405")+".zip", fileFilter{T("诊断包", "Diagnostics"), []string{"zip"}})
		if path == "" {
			return false, nil
		}
		return a.svc.Call(method, map[string]any{"path": path, "version": input.Version}, 0)
	case "project.import":
		path := a.pick(chooseOpen, T("导入工程", "Import Project"), "", fileFilter{T("Yovoice 工程", "Yovoice Project"), []string{"yovoice"}})
		if path == "" {
			return nil, nil
		}
		return a.svc.Call(method, map[string]any{"path": path}, 0)
	case "score.import":
		path := a.pick(chooseOpen, T("导入乐谱", "Import Score"), "", fileFilter{T("MIDI 或乐谱", "MIDI or Score"), []string{"mid", "midi", "json"}})
		if path == "" {
			return nil, nil
		}
		return a.svc.Call(method, map[string]any{"path": path}, 0)
	case "score.export":
		// 编曲导出 MIDI 或乐谱 JSON，扩展名由界面指定，写文件交给本地服务。
		format, filter := "mid", fileFilter{"MIDI", []string{"mid"}}
		if input.Format == "json" {
			format, filter = "json", fileFilter{T("乐谱 JSON", "Score JSON"), []string{"json"}}
		}
		name := input.Name
		if name == "" {
			name = "score"
		}
		path := a.pick(chooseSave, T("导出乐谱", "Export Score"), filepath.Base(name)+"."+format, filter)
		if path == "" {
			return false, nil
		}
		return a.svc.Call(method, map[string]any{"path": path, "score": input.Score}, 0)
	case "audio.export":
		// 时间线合成的音频已由页面上传到本地服务的临时文件，这里只选位置并复制，用完即删。
		location, err := a.svc.Call("export.path", map[string]any{"id": input.ID}, 0)
		if err != nil {
			return nil, err
		}
		var source string
		if err = json.Unmarshal(location, &source); err != nil {
			return nil, err
		}
		defer os.Remove(source)
		name := input.Name
		if name == "" {
			name = "yovoice.wav"
		}
		path := a.pick(chooseSave, T("导出音频", "Export Audio"), filepath.Base(name), fileFilter{T("WAV 音频", "WAV Audio"), []string{"wav"}})
		if path == "" {
			return false, nil
		}
		wav, err := os.ReadFile(source)
		if err != nil {
			return nil, err
		}
		return true, writeAtomic(path, wav)
	case "output.export":
		// 已生成的版本直接复制 outputs 中的文件，不经页面传音频字节，长歌也不受消息大小限制。
		location, err := a.svc.Call("media.path", map[string]any{"kind": "outputs", "id": input.ID}, 0)
		if err != nil {
			return nil, err
		}
		var source string
		if err = json.Unmarshal(location, &source); err != nil {
			return nil, err
		}
		if _, err = os.Stat(source); err != nil {
			return nil, errors.New(T("音频文件不存在。", "The audio file doesn't exist."))
		}
		name := input.Name
		if name == "" {
			name = "yovoice.wav"
		}
		path := a.pick(chooseSave, T("导出音频", "Export Audio"), filepath.Base(name), fileFilter{T("WAV 音频", "WAV Audio"), []string{"wav"}})
		if path == "" {
			return false, nil
		}
		wav, err := os.ReadFile(source)
		if err != nil {
			return nil, err
		}
		return true, writeAtomic(path, wav)
	case "text.export":
		// 字幕（SRT/VTT）、歌词（LRC）与旋律谱（ABC）是界面生成的 UTF-8 文本，宿主只负责选位置并写文件。
		names := map[string]string{"srt": T("SRT 字幕", "SRT Subtitles"), "vtt": T("WebVTT 字幕", "WebVTT Subtitles"), "lrc": T("LRC 歌词", "LRC Lyrics"), "abc": T("ABC 旋律谱", "ABC Melody Score")}
		label, ok := names[input.Format]
		if !ok || input.Text == nil || len(*input.Text) > 20_000_000 {
			return nil, errors.New(T("导出文件格式无效。", "The exported file format is invalid."))
		}
		name := input.Name
		if name == "" {
			name = "yovoice." + input.Format
		}
		path := a.pick(chooseSave, T("导出", "Export"), filepath.Base(name), fileFilter{label, []string{input.Format}})
		if path == "" {
			return false, nil
		}
		return true, writeAtomic(path, []byte(*input.Text))
	case "media.reveal":
		location, err := a.svc.Call("media.path", data, 0)
		if err != nil {
			return nil, err
		}
		var path string
		if err = json.Unmarshal(location, &path); err != nil {
			return nil, err
		}
		if _, err = os.Stat(path); err != nil {
			return nil, errors.New(T("音频文件不存在。", "The audio file doesn't exist."))
		}
		return true, reveal(path)
	case "model.directory":
		path := a.pick(chooseFolder, T("选择模型目录", "Choose Model Folder"), "")
		if path == "" {
			return nil, nil
		}
		return a.svc.Call(method, map[string]any{"path": path}, 0)
	case "model.directory.open":
		state, err := a.svc.Call("state.get", struct{}{}, 0)
		if err != nil {
			return nil, err
		}
		var reply struct {
			State struct {
				Preferences struct {
					ModelDirectory *string `json:"modelDirectory"`
				} `json:"preferences"`
			} `json:"state"`
		}
		if err = json.Unmarshal(state, &reply); err != nil {
			return nil, err
		}
		directory := filepath.Join(a.root, "models")
		if reply.State.Preferences.ModelDirectory != nil && *reply.State.Preferences.ModelDirectory != "" {
			directory = *reply.State.Preferences.ModelDirectory
		}
		if err = os.MkdirAll(directory, 0700); err != nil {
			return nil, err
		}
		return true, openPath(directory)
	case "storage.directory":
		path := a.pick(chooseFolder, T("选择数据存储目录", "Choose Data Storage Folder"), "")
		if path == "" {
			return nil, nil
		}
		// 迁移以服务端当前状态为准，先保存界面里尚在防抖窗口内的正文，避免迁移后丢字。
		if draft := a.draft(); string(draft) != "null" {
			if _, err := a.svc.Call("draft.save", draft, 0); err != nil {
				return nil, err
			}
		}
		// 跨盘复制模型可能远超普通请求的 120 秒上限，进度通过状态推送展示。
		result, err := a.svc.Call("storage.relocate", map[string]any{"path": path}, 24*time.Hour)
		if err == nil {
			a.mu.Lock()
			a.storageRelocated = true
			a.mu.Unlock()
			hostLog(a.root, "storage.relocated", nil)
		}
		return result, err
	case "storage.directory.open":
		if err := os.MkdirAll(a.root, 0700); err != nil {
			return nil, err
		}
		return true, openPath(a.root)
	case "app.update.get":
		// Linux 包暂不自动更新，返回 null 时界面隐藏更新入口。
		return nil, nil
	case "app.update.check", "app.update.install":
		return false, nil
	case "logs.open":
		return true, openPath(filepath.Join(a.root, "logs"))
	case "preferences.save":
		result, err := a.svc.Call(method, data, 0)
		// 设置保存成功后原生文字随之切换语言。
		if err == nil && input.UILocale != "" && applyLocale(input.UILocale) {
			ui(a.applyLocale)
		}
		return result, err
	}
	return a.svc.Call(method, data, 0)
}
