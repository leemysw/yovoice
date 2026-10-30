package desktop

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"time"
	"yovoice/internal/catalog"
	"yovoice/internal/diag"
	"yovoice/internal/msg"
	"yovoice/internal/platform"
	"yovoice/internal/schema"
	"yovoice/internal/score"
	"yovoice/internal/workbench"
)

// audited 是需要在日志里留痕的关键操作；生成、保存与 AI 任务在各自流程里记录更详细的事件。
// 清单保存在 audited.json，web 的 shared/lib/preview-logs.ts 引用同一份文件，浏览器预览据此模拟留痕。
//
//go:embed audited.json
var auditedJSON []byte

var audited map[string]bool

func init() {
	var methods []string
	if err := json.Unmarshal(auditedJSON, &methods); err != nil {
		panic("解析 audited.json 失败：" + err.Error())
	}
	audited = make(map[string]bool, len(methods))
	for _, method := range methods {
		audited[method] = true
	}
}

// Call 解码桌面界面的 RPC 请求并调用应用服务；耗时操作由 Workbench 调度，结果通过状态事件广播。
// ctx 只约束导入等同步耗时调用；后台操作的生命周期由 Workbench 管理。
func Call(ctx context.Context, w *workbench.Workbench, method string, data json.RawMessage) (result any, callErr error) {
	started := time.Now()
	var p struct {
		ID            string    `json:"id"`
		Kind          string    `json:"kind"`
		Name          string    `json:"name"`
		Path          string    `json:"path"`
		Base64        string    `json:"base64"`
		ReferenceText string    `json:"referenceText"`
		Model         string    `json:"model"`
		Version       string    `json:"version"`
		Times         []float64 `json:"times"`
	}
	defer func() {
		elapsed := time.Since(started)
		if audited[method] {
			// 关键操作无论成败都记一条，事件名即方法名，便于在日志页按模块回溯；不记录名称与正文。
			fields := []any{"elapsed_ms", elapsed.Milliseconds(), "error", diag.Error(callErr)}
			if p.ID != "" {
				fields = append(fields, "id", p.ID)
			}
			if p.Kind != "" {
				fields = append(fields, "kind", p.Kind)
			}
			if p.Model != "" {
				fields = append(fields, "model", p.Model)
			}
			diag.Log(w.Store.Root, method, fields...)
		} else if callErr != nil {
			diag.Log(w.Store.Root, "rpc.failed", "method", method, "elapsed_ms", elapsed.Milliseconds(), "error", diag.Error(callErr))
		} else if elapsed > 10*time.Second {
			// 界面桥接 120 秒超时，慢调用提前记下，便于发现接近上限的请求。
			diag.Log(w.Store.Root, "rpc.slow", "method", method, "elapsed_ms", elapsed.Milliseconds())
		}
	}()
	if len(data) == 0 || string(data) == "null" {
		return nil, msg.Err(msg.ErrRequestInvalid, nil)
	}
	if e := json.Unmarshal(data, &p); e != nil {
		return nil, e
	}
	switch method {
	case "state.get":
		// assistant 报告随包的 AI 助手运行时是否存在：缺失时界面禁用 AI 写作并说明原因。
		_, ochoErr := platform.OchoExecutable()
		return map[string]any{"state": w.Store.Read(), "catalog": catalog.Models, "catalogRevision": catalog.Revision, "engine": map[string]string{"version": catalog.EngineVersion, "minimum": catalog.EngineMinimum}, "desktop": true, "assistant": map[string]bool{"available": ochoErr == nil}}, nil
	case "draft.save", "generation.start":
		d := schema.DefaultDraft()
		if e := json.Unmarshal(data, &d); e != nil {
			return nil, e
		}
		if method == "draft.save" {
			return true, w.SaveDraft(d)
		}
		return true, w.Generate(d)
	case "generation.cue":
		var input struct {
			Draft  schema.Draft `json:"draft"`
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
	case "score.import":
		return score.Read(p.Path)
	case "score.export":
		var input struct {
			Path  string       `json:"path"`
			Score schema.Score `json:"score"`
		}
		if e := json.Unmarshal(data, &input); e != nil {
			return nil, e
		}
		return true, score.Write(input.Path, input.Score)
	case "character.save", "character.preview":
		var c schema.Character
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
	case "timeline.fromGeneration":
		return w.ImportTimelineGeneration(ctx, p.ID)
	case "voice.update":
		return true, w.UpdateVoice(p.ID, p.Name, p.ReferenceText)
	case "voice.record", "timeline.import":
		b, e := base64.StdEncoding.DecodeString(p.Base64)
		if e != nil {
			return nil, e
		}
		if method == "timeline.import" {
			return w.ImportTimelineFrom(ctx, bytes.NewReader(b), p.Name)
		}
		return w.ImportVoiceFrom(ctx, bytes.NewReader(b), p.Name)
	case "voice.suggest":
		return w.SuggestVoiceRange(p.ID)
	case "media.path":
		return w.MediaFile(p.Kind, p.ID)
	case "export.path":
		return w.ExportPath(p.ID)
	case "media.rename":
		return true, w.RenameMedia(p.Kind, p.ID, p.Name)
	case "media.delete":
		return true, w.DeleteMedia(p.Kind, p.ID)
	case "assets.list":
		return w.ListAssets()
	case "assets.delete":
		var in struct {
			Items []workbench.AssetRef `json:"items"`
		}
		if e := json.Unmarshal(data, &in); e != nil || len(in.Items) == 0 || len(in.Items) > 2000 {
			return nil, msg.Err(msg.ErrRequestInvalid, nil)
		}
		return w.DeleteAssets(in.Items), nil
	case "assets.image":
		return w.ImagePreview(p.ID)
	case "generation.lyricTimes":
		return true, w.SetLyricTimes(p.ID, p.Times)
	case "generation.lyricWords":
		var in struct {
			ID    string             `json:"id"`
			Words []schema.LyricWord `json:"words"`
		}
		if e := json.Unmarshal(data, &in); e != nil {
			return nil, msg.Err(msg.ErrRequestInvalid, nil)
		}
		return true, w.SetLyricWords(in.ID, in.Words)
	case "generation.alignLyrics":
		var in struct {
			ID    string                `json:"id"`
			Lines []workbench.LyricLine `json:"lines"`
		}
		if e := json.Unmarshal(data, &in); e != nil {
			return nil, msg.Err(msg.ErrRequestInvalid, nil)
		}
		return true, w.AlignLyrics(in.ID, in.Lines)
	case "preferences.save":
		preferences := schema.Preferences{DownloadSource: "modelscope", Backend: "cpu", UiLocale: schema.UiLocaleZhCN}
		if e := json.Unmarshal(data, &preferences); e != nil {
			return nil, e
		}
		return true, w.SavePreferences(preferences)
	case "storage.info":
		return w.StorageInfo()
	case "storage.relocate":
		return true, w.RelocateStorage(p.Path)
	case "storage.cleanup":
		return w.CleanupResiduals()
	case "model.directory":
		return true, w.SetModelDirectory(p.Path)
	case "model.download":
		return true, w.DownloadModel(p.ID)
	case "model.forget":
		return true, w.ForgetModel(p.ID)
	case "runtime.install":
		return true, w.InstallRuntime()
	case "ai.provider.save":
		var input workbench.AIProviderInput
		if e := json.Unmarshal(data, &input); e != nil {
			return nil, e
		}
		return w.SaveAIProvider(input)
	case "ai.provider.delete":
		return true, w.DeleteAIProvider(p.ID)
	case "ai.provider.use":
		return true, w.UseAIProvider(p.ID, p.Model)
	case "ai.models":
		return w.AIModels(ctx, p.ID)
	case "ai.test":
		return w.TestAIProvider(ctx, p.ID)
	case "ai.codex.status":
		return w.CodexStatus(ctx), nil
	case "ai.codex.login":
		return true, w.LoginCodex()
	case "ai.connect":
		authURL, e := w.ConnectOrcaRouter()
		return map[string]string{"url": authURL}, e
	case "assistant.send":
		var input struct {
			Text    string                     `json:"text"`
			Context workbench.AssistantContext `json:"context"`
		}
		if e := json.Unmarshal(data, &input); e != nil {
			return nil, e
		}
		return true, w.SendAssistant(input.Text, input.Context)
	case "assistant.cancel":
		w.CancelAssistant()
		return true, nil
	case "ai.cast":
		var input workbench.CastBrief
		if e := json.Unmarshal(data, &input); e != nil {
			return nil, e
		}
		return w.StartCast(input)
	case "ai.image":
		var input workbench.ImageBrief
		if e := json.Unmarshal(data, &input); e != nil {
			return nil, e
		}
		return w.StartImage(input)
	case "melody.plan":
		d := schema.DefaultDraft()
		if e := json.Unmarshal(data, &d); e != nil {
			return nil, e
		}
		return true, w.PlanMelody(d)
	case "melody.cover":
		var input struct {
			ProjectID string `json:"projectId"`
			Base64    string `json:"base64"`
		}
		if e := json.Unmarshal(data, &input); e != nil {
			return nil, e
		}
		b, e := base64.StdEncoding.DecodeString(input.Base64)
		if e != nil {
			return nil, e
		}
		return true, w.CoverMelody(input.ProjectID, bytes.NewReader(b))
	case "melody.listen":
		var input struct {
			Abc string `json:"abc"`
		}
		if e := json.Unmarshal(data, &input); e != nil {
			return nil, e
		}
		file, e := w.ListenMelody(ctx, input.Abc)
		return map[string]string{"fileName": file}, e
	case "melody.dismiss":
		return true, w.DismissMelody(p.ID)
	case "melody.inspect", "melody.transform":
		var input struct {
			Abc   string `json:"abc"`
			Op    string `json:"op"`
			Tempo int    `json:"tempo"`
		}
		if e := json.Unmarshal(data, &input); e != nil {
			return nil, e
		}
		if method == "melody.inspect" {
			return workbench.InspectMelody(input.Abc), nil
		}
		return workbench.TransformMelody(input.Abc, input.Op, input.Tempo)
	case "ai.cancel":
		w.CancelAI()
		return true, nil
	case "assistant.open":
		return true, w.OpenAssistantSession(p.ID)
	case "assistant.new":
		return w.NewAssistantSession()
	case "assistant.delete":
		return true, w.DeleteAssistantSession(p.ID)
	case "assistant.proposal":
		var input struct {
			ID      string `json:"id"`
			Confirm bool   `json:"confirm"`
		}
		if e := json.Unmarshal(data, &input); e != nil {
			return nil, e
		}
		return true, w.ResolveAssistantProposal(input.ID, input.Confirm)
	case "assistant.forget":
		// id 为空时清空全部偏好。
		return true, w.ForgetAssistant(p.ID)
	case "diag.client":
		// 界面侧的异常（桥接超时、未捕获错误）写入同一份服务日志，便于对照排查。
		var input struct {
			Event  string `json:"event"`
			Method string `json:"method"`
			Detail string `json:"detail"`
		}
		if e := json.Unmarshal(data, &input); e != nil {
			return nil, e
		}
		diag.Log(w.Store.Root, "client."+schema.Clip(input.Event, 40), "method", schema.Clip(input.Method, 80), "detail", schema.Clip(input.Detail, 2000))
		return true, nil
	case "logs.query":
		var filter diag.Filter
		if e := json.Unmarshal(data, &filter); e != nil {
			return nil, e
		}
		return diag.Query(w.Store.Root, filter)
	case "logs.export":
		if p.Path == "" {
			return nil, msg.Err(msg.ErrRequestInvalid, nil)
		}
		return true, diag.Bundle(w.Store.Root, p.Path, schema.Clip(p.Version, 40))
	case "ai.dismiss":
		return true, w.DismissAI(p.ID)
	case "operation.cancel":
		w.Cancel()
		return true, nil
	case "model.cancel":
		w.CancelModel()
		return true, nil
	}
	return nil, msg.Err(msg.ErrMethodUnsupported, nil)
}
