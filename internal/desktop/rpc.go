package desktop

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"time"
	"yovoice/internal/catalog"
	"yovoice/internal/diag"
	"yovoice/internal/domain"
	"yovoice/internal/msg"
	"yovoice/internal/workbench"
)

// Call 解码桌面界面的 RPC 请求并调用应用服务；耗时操作由 Workbench 调度，结果通过状态事件广播。
func Call(w *workbench.Workbench, method string, data json.RawMessage) (result any, callErr error) {
	started := time.Now()
	defer func() {
		if callErr != nil {
			diag.Log(w.Store.Root, "rpc.failed", "method", method, "elapsed_ms", time.Since(started).Milliseconds(), "error", diag.Error(callErr))
		}
	}()
	var p struct {
		ID            string `json:"id"`
		Kind          string `json:"kind"`
		Name          string `json:"name"`
		Path          string `json:"path"`
		Base64        string `json:"base64"`
		ReferenceText string `json:"referenceText"`
	}
	if len(data) == 0 || string(data) == "null" {
		return nil, msg.Err(msg.ErrRequestInvalid, nil)
	}
	if e := json.Unmarshal(data, &p); e != nil {
		return nil, e
	}
	ctx := context.Background()
	switch method {
	case "state.get":
		return map[string]any{"state": w.Store.Read(), "catalog": catalog.Models, "desktop": true}, nil
	case "draft.save", "generation.start":
		d := domain.DefaultDraft()
		if e := json.Unmarshal(data, &d); e != nil {
			return nil, e
		}
		if method == "draft.save" {
			return true, w.SaveDraft(d)
		}
		return true, w.Generate(d)
	case "generation.cue":
		var input struct {
			Draft  domain.Draft `json:"draft"`
			CueID  string       `json:"cueId"`
			ClipID string       `json:"clipId"`
		}
		if e := json.Unmarshal(data, &input); e != nil {
			return nil, e
		}
		return true, w.GenerateCue(input.Draft, input.CueID, input.ClipID)
	case "draft.delete":
		return true, w.DeleteDraft(p.ID)
	case "project.export":
		return true, w.ExportProject(p.ID, p.Path)
	case "project.import":
		return w.ImportProject(p.Path)
	case "character.save", "character.preview":
		var c domain.Character
		if e := json.Unmarshal(data, &c); e != nil {
			return nil, e
		}
		if method == "character.preview" {
			return w.PreviewCharacter(c)
		}
		return w.SaveCharacter(c)
	case "character.delete":
		return true, w.DeleteCharacter(p.ID)
	case "character.discardPreview":
		return true, w.DiscardPreview(p.ID)
	case "voice.fromGeneration":
		return w.VoiceFromGeneration(p.ID, p.Name, p.ReferenceText)
	case "voice.update":
		return true, w.UpdateVoice(p.ID, p.Name, p.ReferenceText)
	case "voice.import":
		return w.ImportVoice(ctx, p.Path, "")
	case "voice.record", "timeline.import":
		b, e := base64.StdEncoding.DecodeString(p.Base64)
		if e != nil {
			return nil, e
		}
		if method == "timeline.import" {
			return w.ImportTimelineFrom(ctx, bytes.NewReader(b), p.Name)
		}
		return w.ImportVoiceFrom(ctx, bytes.NewReader(b), p.Name)
	case "media.path":
		return w.MediaFile(p.Kind, p.ID)
	case "media.rename":
		return true, w.RenameMedia(p.Kind, p.ID, p.Name)
	case "media.delete":
		return true, w.DeleteMedia(p.Kind, p.ID)
	case "preferences.save":
		preferences := domain.Preferences{DownloadSource: "modelscope", Backend: "cpu", UiLocale: domain.UiLocaleZhCN}
		if e := json.Unmarshal(data, &preferences); e != nil {
			return nil, e
		}
		return true, w.SavePreferences(preferences)
	case "model.directory":
		return true, w.SetModelDirectory(p.Path)
	case "model.download":
		return true, w.DownloadModel(p.ID)
	case "model.import":
		return true, w.ImportModel(p.Path)
	case "model.forget":
		return true, w.ForgetModel(p.ID)
	case "runtime.install":
		return true, w.InstallRuntime()
	case "operation.cancel":
		w.Cancel()
		return true, nil
	}
	return nil, msg.Err(msg.ErrMethodUnsupported, nil)
}
