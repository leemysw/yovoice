package workbench

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"time"
	"yovoice/internal/catalog"
	"yovoice/internal/diag"
	"yovoice/internal/domain"
	"yovoice/internal/msg"
)

func (w *Workbench) Call(method string, data json.RawMessage) (result any, callErr error) {
	started := time.Now()
	defer func() {
		if callErr != nil {
			diag.Log(w.Store.Root, "rpc.failed", "method", method, "elapsed_ms", time.Since(started).Milliseconds(), "error", diag.Error(callErr))
		}
	}()
	var p struct {
		ID     string `json:"id"`
		Kind   string `json:"kind"`
		Name   string `json:"name"`
		Path   string `json:"path"`
		Base64 string `json:"base64"`
	}
	if len(data) == 0 || string(data) == "null" {
		return nil, msg.Err(msg.ErrRequestInvalid, nil)
	}
	if e := json.Unmarshal(data, &p); e != nil {
		return nil, e
	}
	var err error
	switch method {
	case "character.save", "character.delete", "character.preview", "character.discardPreview", "voice.fromGeneration", "voice.update":
		return w.libraryCall(method, data)
	case "project.export":
		return true, w.ExportProject(p.ID, p.Path)
	case "project.import":
		return w.ImportProject(p.Path)
	case "state.get":
		return map[string]any{"state": w.Store.Read(), "catalog": catalog.Models, "desktop": true}, nil
	case "media.path":
		return w.MediaFile(p.Kind, p.ID)
	case "media.rename":
		err = w.rename(p.Kind, p.ID, p.Name)
	case "media.delete":
		err = w.deleteMedia(p.Kind, p.ID)
	case "draft.delete":
		if !domain.ValidID(p.ID) {
			return nil, msg.Err(msg.ErrDraftIDInvalid, nil)
		}
		err = w.Store.Update(func(s *domain.State) {
			s.Drafts = slices.DeleteFunc(s.Drafts, func(d domain.Draft) bool { return d.ID == p.ID })
		}, true)
	case "generation.cue":
		var input struct {
			Draft  domain.Draft `json:"draft"`
			CueID  string       `json:"cueId"`
			ClipID string       `json:"clipId"`
		}
		if err = json.Unmarshal(data, &input); err != nil {
			return nil, err
		}
		if input.CueID == "" {
			return nil, msg.Err(msg.ErrSubtitleInvalid, nil)
		}
		err = w.generateAudio(input.Draft, "", input.CueID, input.ClipID)
	case "draft.save", "generation.start":
		d := domain.DefaultDraft()
		if e := json.Unmarshal(data, &d); e != nil {
			return nil, e
		}
		if method == "draft.save" {
			err = w.SaveDraft(d)
		} else {
			err = w.generate(d)
		}
	case "preferences.save":
		preferences := domain.Preferences{DownloadSource: "modelscope", Backend: "cpu", UiLocale: domain.UiLocaleZhCN}
		if e := json.Unmarshal(data, &preferences); e != nil {
			return nil, e
		}
		err = w.preferences(preferences)
	case "voice.import":
		return w.ImportVoice(context.Background(), p.Path, "")
	case "voice.record", "timeline.import":
		b, e := base64.StdEncoding.DecodeString(p.Base64)
		if e != nil {
			return nil, e
		}
		if len(b) > 20<<20 {
			return nil, msg.Err(msg.ErrAudioTooLarge, nil)
		}
		path := filepath.Join(w.Store.Root, "downloads", domain.NewID()+".wav")
		defer os.Remove(path)
		if e = os.WriteFile(path, b, 0600); e != nil {
			return nil, e
		}
		if method == "timeline.import" {
			return w.importTimelineAudio(context.Background(), path, p.Name)
		}
		return w.ImportVoice(context.Background(), path, p.Name)
	case "model.import":
		err = w.importModel(p.Path)
	case "model.directory":
		s := w.Store.Read()
		s.Preferences.ModelDirectory = ptr(p.Path)
		err = w.preferences(s.Preferences)
	case "model.download":
		err = w.download(p.ID)
	case "model.forget":
		w.mu.Lock()
		defer w.mu.Unlock()
		activity := w.Store.Read().Activity
		// 下载其他模型不占用推理引擎，也不会改写当前模型的登记。
		if w.cancel != nil && (activity == nil || activity.Kind != "download" || activity.ModelID == nil || *activity.ModelID == p.ID) {
			return nil, msg.Err(msg.ErrModelForgetBlocked, nil)
		}
		w.engine.Stop()
		err = w.Store.Update(func(s *domain.State) {
			s.Models = slices.DeleteFunc(s.Models, func(m domain.InstalledModel) bool { return m.ID == p.ID })
		}, true)
	case "runtime.install":
		err = w.install()
	case "operation.cancel":
		w.Cancel()
	default:
		return nil, msg.Err(msg.ErrMethodUnsupported, nil)
	}
	return true, err
}
