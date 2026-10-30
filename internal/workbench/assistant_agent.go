package workbench

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"slices"
	"strings"
	"time"
	"yovoice/internal/catalog"
	"yovoice/internal/diag"
	"yovoice/internal/msg"
	"yovoice/internal/schema"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// 助手的应用级能力：只读状态与错误日志、用户偏好记忆，以及需要用户确认才执行的写操作提议。

// registerAgentTools 把状态、偏好与提议工具注册到内置助手的 MCP server。
func (w *Workbench) registerAgentTools(server *mcp.Server) {
	mcp.AddTool(server, &mcp.Tool{Name: "get_app_status", Description: "查看应用整体状态：已安装模型、推理引擎（版本、计算设备、是否可用）、性能优先设置、正在进行的生成与下载、磁盘占用。回答“装了哪些模型”“为什么用不了”之类的问题前调用。"}, w.appStatusTool)
	mcp.AddTool(server, &mcp.Tool{Name: "get_recent_errors", Description: "读取最近的警告与错误日志（事件名、错误码与少量字段，已脱敏）。排查生成失败、下载失败、引擎问题时调用；错误码含义见 yovoice-product skill。"}, w.recentErrorsTool)
	mcp.AddTool(server, &mcp.Tool{Name: "remember_preference", Description: "记住一条用户明确表达的长期偏好（常用音色、风格、语言、语速、称呼等），以后每次对话都会带上。只记用户亲口说的偏好，一条一件事，不记一次性的要求。"}, w.rememberTool)
	mcp.AddTool(server, &mcp.Tool{Name: "forget_preference", Description: "删除一条已记住的偏好（id 见 <ui_context> 里的 preferences）。用户说不再需要或偏好变了时调用。"}, w.forgetTool)
	mcp.AddTool(server, &mcp.Tool{Name: "propose_action", Description: "提议一个需要用户确认的操作，界面显示确认卡片，用户点确认后才执行。action：delete_work（target=作品 ID）、delete_generation（target=生成记录 ID）、delete_character（target=声音库角色 ID）、install_model（target=模型 ID；已安装且有更新时提议更新）、install_engine（安装或更新推理引擎）、cleanup_storage（清理无用的临时文件与孤立生成）、set_backend（value=计算设备，如 metal、cpu、cuda、vulkan）、set_download_source（value=huggingface、mirror 或 modelscope）、set_performance_first（value=on/off，仅 CUDA 且推理内核 v0.9.3+）。调用后告诉用户去卡片上确认，不要声称已经完成。"}, w.proposeTool)
}

func (w *Workbench) appStatusTool(ctx context.Context, req *mcp.CallToolRequest, in struct{}) (*mcp.CallToolResult, any, error) {
	s := w.Store.Read()
	models := make([]map[string]any, 0, len(s.Models))
	for _, installed := range s.Models {
		item := map[string]any{"id": installed.ID}
		if definition, e := catalog.Lookup(installed.ID); e == nil {
			item["name"], item["family"] = definition.Name, definition.Family
			item["updateAvailable"] = installed.SHA256 != "" && installed.SHA256 != definition.MainFile().SHA256
		}
		models = append(models, item)
	}
	engine := map[string]any{"ready": RuntimeReady(s), "required": catalog.EngineVersion, "minimum": catalog.EngineMinimum, "backend": s.Preferences.Backend}
	if s.RuntimeVersion != nil {
		engine["installed"] = *s.RuntimeVersion
	}
	out := map[string]any{"models": models, "engine": engine, "downloadSource": s.Preferences.DownloadSource, "performanceFirst": s.Preferences.PerformanceFirst, "works": len(s.Drafts), "generations": len(s.History), "characters": len(s.Characters)}
	if a := s.Activity; a != nil && a.Status == "running" {
		out["activity"] = activitySummary(*a)
	}
	if a := s.ModelActivity; a != nil && a.Status == "running" {
		out["modelActivity"] = activitySummary(*a)
	}
	if info, e := w.StorageInfo(); e == nil {
		out["storageBytes"] = map[string]int64{"models": info.ModelsBytes, "outputs": info.OutputsBytes, "voices": info.VoicesBytes, "downloads": info.DownloadsBytes, "total": info.TotalBytes}
	}
	w.chatCard("get_app_status", "查看了应用状态", "Checked app status", "done")
	return nil, out, nil
}

// activitySummary 只给出任务的类型、状态、进度与错误码，不含路径。
func activitySummary(a schema.Activity) map[string]any {
	out := map[string]any{"kind": a.Kind, "status": a.Status, "step": codeKey(a.Code)}
	if a.ProjectID != "" {
		out["workId"] = a.ProjectID
	}
	if a.ModelID != nil {
		out["modelId"] = *a.ModelID
	}
	if a.Total > 0 {
		out["progress"] = fmt.Sprintf("%d%%", a.Received*100/a.Total)
	}
	if a.ErrorCode != nil {
		out["error"] = codeKey(*a.ErrorCode)
	}
	return out
}

// codeKey 去掉消息码的 @yovoice. 前缀，与 yovoice-product skill 的错误码列表一致。
func codeKey(code msg.Code) string { return strings.TrimPrefix(string(code), "@yovoice.") }

func (w *Workbench) recentErrorsTool(ctx context.Context, req *mcp.CallToolRequest, in struct {
	Limit int `json:"limit,omitempty" jsonschema:"最多返回几条，默认 15，最多 40"`
}) (*mcp.CallToolResult, any, error) {
	limit := in.Limit
	if limit <= 0 {
		limit = 15
	}
	page, err := diag.Query(w.Store.Root, diag.Filter{Level: "warn", Since: time.Now().Add(-7 * 24 * time.Hour), Limit: min(limit, 40)})
	if err != nil {
		return nil, nil, err
	}
	entries := make([]map[string]any, 0, len(page.Entries))
	for _, entry := range page.Entries {
		entries = append(entries, map[string]any{"time": entry.Time.Format(time.RFC3339), "level": entry.Level, "event": entry.Event, "fields": safeFields(entry.Fields)})
	}
	w.chatCard("get_recent_errors", fmt.Sprintf("查看了最近的错误日志（%d 条）", len(entries)), fmt.Sprintf("Read recent error logs (%d)", len(entries)), "done")
	return nil, map[string]any{"entries": entries, "total": page.Total}, nil
}

// safeFields 让日志字段适合交给模型：本机绝对路径只留文件名，长文本截断，错误码去掉前缀。
func safeFields(fields map[string]any) map[string]any {
	out := make(map[string]any, len(fields))
	for key, value := range fields {
		text, ok := value.(string)
		if !ok {
			out[key] = value
			continue
		}
		// Windows 上不带盘符的 \Users\... 不算绝对路径，但同样会暴露本机目录。
		if filepath.IsAbs(text) || filepath.VolumeName(text) != "" || strings.HasPrefix(text, "/") || strings.HasPrefix(text, `\`) || strings.HasPrefix(text, "~") {
			text = filepath.Base(text)
		}
		text = strings.TrimPrefix(text, "@yovoice.")
		if runes := []rune(text); len(runes) > 240 {
			text = string(runes[:240]) + "…"
		}
		out[key] = text
	}
	return out
}

func (w *Workbench) rememberTool(ctx context.Context, req *mcp.CallToolRequest, in struct {
	Text string `json:"text" jsonschema:"偏好内容，一句话，如“旁白默认用《温柔女声》角色”"`
}) (*mcp.CallToolResult, any, error) {
	memo, err := w.RememberAssistant(in.Text)
	if err != nil {
		return nil, nil, err
	}
	w.chatCard("remember_preference", "记住了："+memo.Text, "Remembered: "+memo.Text, "done")
	return nil, map[string]any{"id": memo.ID, "remembered": memo.Text}, nil
}

func (w *Workbench) forgetTool(ctx context.Context, req *mcp.CallToolRequest, in struct {
	ID string `json:"id" jsonschema:"偏好 ID"`
}) (*mcp.CallToolResult, any, error) {
	var text string
	for _, memo := range w.Store.Read().AssistantMemory {
		if memo.ID == in.ID {
			text = memo.Text
		}
	}
	if text == "" {
		return nil, nil, fmt.Errorf("没有 id 为 %s 的偏好", in.ID)
	}
	if err := w.ForgetAssistant(in.ID); err != nil {
		return nil, nil, err
	}
	w.chatCard("forget_preference", "不再记住："+text, "Forgot: "+text, "done")
	return nil, map[string]any{"forgotten": true}, nil
}

// RememberAssistant 记下一条偏好；内容相同的旧条目移到最新，超过上限丢弃最旧的一条。
func (w *Workbench) RememberAssistant(text string) (schema.AssistantMemo, error) {
	text = strings.Join(strings.Fields(text), " ")
	if text == "" || schema.TextLen(text) > 200 {
		return schema.AssistantMemo{}, fmt.Errorf("偏好需为 1–200 字的一句话")
	}
	memo := schema.AssistantMemo{ID: schema.NewID(), Text: text, CreatedAt: time.Now().UTC()}
	err := w.Store.Update(func(s *schema.State) {
		memory := slices.DeleteFunc(slices.Clone(s.AssistantMemory), func(m schema.AssistantMemo) bool { return m.Text == text })
		memory = append(memory, memo)
		if excess := len(memory) - schema.AssistantMemoLimit; excess > 0 {
			memory = memory[excess:]
		}
		s.AssistantMemory = memory
	}, true)
	return memo, err
}

// ForgetAssistant 删除一条偏好；id 为空时清空全部。
func (w *Workbench) ForgetAssistant(id string) error {
	return w.Store.Update(func(s *schema.State) {
		if id == "" {
			s.AssistantMemory = nil
			return
		}
		s.AssistantMemory = slices.DeleteFunc(slices.Clone(s.AssistantMemory), func(m schema.AssistantMemo) bool { return m.ID == id })
	}, true)
}

// proposalLabels 是提议卡片上的动作描述（zh、en），%s 为对象名。
var proposalLabels = map[string][2]string{
	"delete_work": {"删除作品《%s》", "Delete work %q"}, "delete_generation": {"删除生成记录《%s》", "Delete take %q"},
	"delete_character": {"从声音库删除《%s》", "Delete voice %q"}, "install_model": {"下载模型 %s", "Download model %s"},
	"install_model_update": {"更新模型 %s", "Update model %s"},
	"install_engine":       {"安装推理引擎 %s", "Install inference engine %s"}, "cleanup_storage": {"清理无用文件%s", "Clean up unused files%s"},
	"set_backend": {"计算设备改为 %s", "Switch compute device to %s"}, "set_download_source": {"下载源改为 %s", "Switch download source to %s"},
	"set_performance_first": {"性能优先设为 %s", "Set performance-first to %s"},
}

type proposeInput struct {
	Action string `json:"action" jsonschema:"操作：delete_work、delete_generation、delete_character、install_model、install_engine、cleanup_storage、set_backend、set_download_source 或 set_performance_first"`
	Target string `json:"target,omitempty" jsonschema:"操作对象的 ID：作品、生成记录、角色或模型"`
	Value  string `json:"value,omitempty" jsonschema:"设置的新值：计算设备、下载源，或性能优先的 on/off"`
	Reason string `json:"reason,omitempty" jsonschema:"一句话说明为什么建议这样做，显示在卡片上"`
}

func (w *Workbench) proposeTool(ctx context.Context, req *mcp.CallToolRequest, in proposeInput) (*mcp.CallToolResult, any, error) {
	label, err := w.proposalLabel(in.Action, in.Target, in.Value)
	if err != nil {
		return nil, nil, err
	}
	proposal := &schema.AssistantProposal{ID: schema.NewID(), Action: in.Action, Target: in.Target, Value: in.Value, Label: label, Reason: strings.TrimSpace(in.Reason), State: "pending"}
	if runes := []rune(proposal.Reason); len(runes) > 200 {
		proposal.Reason = string(runes[:200]) + "…"
	}
	names := proposalLabels[in.Action]
	if in.Action == "install_model" && slices.ContainsFunc(w.Store.Read().Models, func(m schema.InstalledModel) bool { return m.ID == in.Target }) {
		names = proposalLabels["install_model_update"]
	}
	w.chatProposal("propose_action", fmt.Sprintf(names[0], label), fmt.Sprintf(names[1], label), proposal)
	return nil, map[string]any{"proposed": true, "id": proposal.ID, "hint": "确认卡片已显示，等用户点确认后才会执行；不要声称已经完成"}, nil
}

// proposalLabel 校验提议的对象与取值，并返回给用户看的对象名；对象名取自应用数据，不用模型给的文字。
func (w *Workbench) proposalLabel(action, target, value string) (string, error) {
	s := w.Store.Read()
	switch action {
	case "delete_work":
		if d, e := w.assistantWork(target); e == nil {
			return d.Title, nil
		}
		return "", fmt.Errorf("没有找到作品 %s，请先用 list_works 查看", target)
	case "delete_generation":
		for _, g := range s.History {
			if g.ID == target {
				return g.Title, nil
			}
		}
		return "", fmt.Errorf("没有找到生成记录 %s，可用 get_generation_status 查看作品最近的生成", target)
	case "delete_character":
		for _, c := range s.Characters {
			if c.ID == target {
				return c.Name, nil
			}
		}
		return "", fmt.Errorf("声音库里没有角色 %s", target)
	case "install_model":
		definition, e := catalog.Lookup(target)
		if e != nil {
			return "", fmt.Errorf("未知模型 %s，请用 list_models 查询模型 ID", target)
		}
		for _, installed := range s.Models {
			if installed.ID == target && (installed.SHA256 == "" || installed.SHA256 == definition.MainFile().SHA256) {
				return "", fmt.Errorf("模型 %s 已经安装且没有可用更新", target)
			}
		}
		return fmt.Sprintf("%s（%s，%.1f GB）", definition.Name, target, float64(definition.Size)/1e9), nil
	case "install_engine":
		return catalog.EngineVersion, nil
	case "cleanup_storage":
		return "", nil
	case "set_backend":
		if _, e := catalog.RuntimeArchives(value); e != nil {
			return "", fmt.Errorf("本机不支持计算设备 %s", value)
		}
		return value, nil
	case "set_download_source":
		if _, e := catalog.Models[0].URL(value); e != nil {
			return "", fmt.Errorf("下载源必须是 huggingface、mirror 或 modelscope")
		}
		return value, nil
	case "set_performance_first":
		if value != "on" && value != "off" {
			return "", fmt.Errorf("性能优先的 value 必须是 on 或 off")
		}
		if s.Preferences.Backend != "cuda" && s.Preferences.Backend != "cuda13" {
			return "", fmt.Errorf("性能优先只支持 CUDA 计算设备，请先将计算设备设为 cuda 或 cuda13")
		}
		if s.RuntimeVersion == nil || !catalog.VersionAtLeast(*s.RuntimeVersion, performanceFirstEngine) {
			return "", fmt.Errorf("性能优先需要推理内核 %s 或更新版本，请先安装或更新推理引擎", performanceFirstEngine)
		}
		return value, nil
	}
	return "", fmt.Errorf("不支持的操作 %s", action)
}

// ResolveAssistantProposal 处理用户对提议卡片的选择：确认则执行，否则标记为已忽略；只处理仍待确认的提议。
// 同一提议先在锁内占住再查状态，并发的两次确认只有一次会执行。
func (w *Workbench) ResolveAssistantProposal(id string, confirm bool) error {
	w.chat.mu.Lock()
	if w.chat.resolving[id] {
		w.chat.mu.Unlock()
		return msg.Err(msg.ErrBusy, nil)
	}
	if w.chat.resolving == nil {
		w.chat.resolving = map[string]bool{}
	}
	w.chat.resolving[id] = true
	w.chat.mu.Unlock()
	defer func() {
		w.chat.mu.Lock()
		delete(w.chat.resolving, id)
		w.chat.mu.Unlock()
	}()
	proposal := w.findProposal(id)
	if proposal == nil || proposal.State != "pending" {
		return msg.Err(msg.ErrRequestInvalid, nil)
	}
	next := *proposal
	next.State = "dismissed"
	if confirm {
		next.State = "confirmed"
		if err := w.runProposal(next); err != nil {
			next.State = "failed"
			var ce *msg.CallError
			if errors.As(err, &ce) {
				next.ErrorCode, next.ErrorParams = ce.Code, ce.Params
			} else {
				next.ErrorCode, next.ErrorParams = msg.ErrUnknown, msg.Params{"detail": err.Error()}
			}
		}
	}
	diag.Log(w.Store.Root, "assistant.proposal", "action", next.Action, "state", next.State)
	return w.storeProposal(next)
}

// runProposal 执行用户确认的操作，与界面按钮走同一个应用服务。
func (w *Workbench) runProposal(p schema.AssistantProposal) error {
	// 提议到确认之间数据可能变了（作品已删除、模型已装好），执行前重新校验。
	if _, err := w.proposalLabel(p.Action, p.Target, p.Value); err != nil {
		return msg.Err(msg.ErrRequestInvalid, nil)
	}
	switch p.Action {
	case "delete_work":
		return w.DeleteDraft(p.Target)
	case "delete_generation":
		return w.DeleteMedia("outputs", p.Target)
	case "delete_character":
		return w.DeleteCharacter(p.Target)
	case "install_model":
		return w.DownloadModel(p.Target)
	case "install_engine":
		return w.InstallRuntime()
	case "cleanup_storage":
		_, err := w.CleanupResiduals()
		return err
	case "set_backend", "set_download_source":
		prefs := w.Store.Read().Preferences
		if p.Action == "set_backend" {
			prefs.Backend = p.Value
		} else {
			prefs.DownloadSource = p.Value
		}
		return w.SavePreferences(prefs)
	case "set_performance_first":
		w.edit.Lock()
		defer w.edit.Unlock()
		return w.Store.Update(func(s *schema.State) {
			s.Preferences.PerformanceFirst = p.Value == "on"
		}, true)
	}
	return msg.Err(msg.ErrRequestInvalid, nil)
}

// findProposal 在进行中的一轮与已保存的会话里查找提议。
func (w *Workbench) findProposal(id string) *schema.AssistantProposal {
	w.chat.mu.Lock()
	if turn := w.chat.turn; turn != nil {
		for _, block := range turn.blocks {
			if block.Card != nil && block.Card.Proposal != nil && block.Card.Proposal.ID == id {
				found := *block.Card.Proposal
				w.chat.mu.Unlock()
				return &found
			}
		}
	}
	w.chat.mu.Unlock()
	if sessions := w.Store.Read().AssistantSessions; sessions != nil {
		for _, session := range sessions.Sessions {
			for _, m := range session.Messages {
				for _, block := range m.Blocks {
					if block.Card != nil && block.Card.Proposal != nil && block.Card.Proposal.ID == id {
						found := *block.Card.Proposal
						return &found
					}
				}
			}
		}
	}
	return nil
}

// storeProposal 写回提议的新状态：进行中的一轮更新实时状态，已保存的会话更新记录；记录写不进去时返回错误。
func (w *Workbench) storeProposal(p schema.AssistantProposal) error {
	w.chat.mu.Lock()
	var snapshot *schema.AssistantTurn
	if turn := w.chat.turn; turn != nil {
		if replaceProposal(turn.blocks, p) {
			snapshot = turn.snapshot()
		}
	}
	w.chat.mu.Unlock()
	if snapshot != nil {
		w.publishLive(func(live *schema.AssistantLive) { live.Turn = snapshot })
	}
	return w.Store.Update(func(s *schema.State) {
		if s.AssistantSessions == nil {
			return
		}
		for i := range s.AssistantSessions.Sessions {
			for j := range s.AssistantSessions.Sessions[i].Messages {
				replaceProposal(s.AssistantSessions.Sessions[i].Messages[j].Blocks, p)
			}
		}
	}, true)
}

// replaceProposal 把同 ID 的提议换成新状态；卡片整体复制后替换，不改动已广播的旧快照。
func replaceProposal(blocks []schema.AssistantBlock, p schema.AssistantProposal) bool {
	replaced := false
	for i := range blocks {
		if card := blocks[i].Card; card != nil && card.Proposal != nil && card.Proposal.ID == p.ID {
			next, value := *card, p
			next.Proposal = &value
			blocks[i].Card = &next
			replaced = true
		}
	}
	return replaced
}
