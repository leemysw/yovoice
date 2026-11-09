package workbench

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
	"yovoice/internal/assistant"
	"yovoice/internal/assistant/fakeocho"
	"yovoice/internal/catalog"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
)

// 上下文前缀带上选中内容、当前台词、播放位置、作品模型与最近一次生成的错误码。
func TestChatMessageRichContext(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	d := schema.DefaultDraft()
	d.Title, d.ModelID = "开场旁白", "index-2.5-q8"
	must(t, w.SaveDraft(d))
	code := msg.ErrGenerateFailed
	must(t, w.Store.Update(func(s *schema.State) {
		s.Activity = &schema.Activity{ProjectID: d.ID, Kind: "generate", Status: "failed", ErrorCode: &code, ErrorParams: msg.Params{"detail": strings.Repeat("长", 300)}}
		s.History = append([]schema.Generation{{ID: "g1", Title: "开场旁白", Duration: 12.5, CreatedAt: time.Now().Add(-3 * time.Minute), Settings: schema.Draft{ID: d.ID}}}, s.History...)
	}, true))
	text := w.chatMessageText(chatMessage{text: "这句太快了", context: AssistantContext{Page: "story", WorkID: d.ID,
		Selection: "  夜色\n很深 ", Cue: &AssistantCue{Index: 3, Total: 12, Speaker: "旁白", Text: "风停了。"}, Playhead: 83}})
	for _, want := range []string{`selected text: "夜色 很深"`, `selected line: #3 of 12, speaker "旁白": "风停了。"`, "playhead: 1:23",
		"work model: index-2.5-q8 (not installed)", "last generation: failed, error error.generateFailed", `latest take: "开场旁白", 12.5s, 3 min ago (id g1)`} {
		if !strings.Contains(text, want) {
			t.Fatalf("上下文缺少 %q：\n%s", want, text)
		}
	}
	if strings.Count(text, "长") > 130 {
		t.Fatal("错误参数应截断")
	}
}

// 偏好记忆：去重、上限、删除与清空；记住的偏好随上下文带上，工具卡片显示内容。
func TestAssistantMemory(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	if _, err = w.RememberAssistant("  "); err == nil {
		t.Fatal("空偏好应被拒绝")
	}
	first, err := w.RememberAssistant("旁白默认用 温柔女声")
	must(t, err)
	for i := range schema.AssistantMemoLimit {
		_, err = w.RememberAssistant("偏好 " + string(rune('A'+i)))
		must(t, err)
	}
	memory := w.Store.Read().AssistantMemory
	if len(memory) != schema.AssistantMemoLimit || memory[0].ID == first.ID {
		t.Fatalf("超过上限应丢弃最旧的一条：%d", len(memory))
	}
	again, err := w.RememberAssistant("偏好 C")
	must(t, err)
	memory = w.Store.Read().AssistantMemory
	if len(memory) != schema.AssistantMemoLimit || memory[len(memory)-1].ID != again.ID {
		t.Fatal("重复的偏好应移到最新而不是新增")
	}
	text := w.chatMessageText(chatMessage{text: "你好"})
	if !strings.Contains(text, "remembered preferences:") || !strings.Contains(text, "["+again.ID+"] 偏好 C") {
		t.Fatalf("上下文应带上偏好：%s", text)
	}
	_, _, err = w.forgetTool(context.Background(), toolReq, struct {
		ID string `json:"id" jsonschema:"偏好 ID"`
	}{ID: again.ID})
	must(t, err)
	if len(w.Store.Read().AssistantMemory) != schema.AssistantMemoLimit-1 {
		t.Fatal("forget_preference 应删除一条")
	}
	must(t, w.ForgetAssistant(""))
	if len(w.Store.Read().AssistantMemory) != 0 {
		t.Fatal("清空后不应留下偏好")
	}
}

// 提议：参数校验、确认卡片、用户确认后执行，已处理的提议不能重复执行。
func TestAssistantProposalFlow(t *testing.T) {
	w := assistantWorkbench(t, fakeocho.Plan{})
	keep, gone := schema.DefaultDraft(), schema.DefaultDraft()
	keep.Title, gone.Title = "保留", "草稿二"
	must(t, w.SaveDraft(keep))
	must(t, w.SaveDraft(gone))
	before := len(w.Store.Read().Drafts)
	for _, bad := range []proposeInput{{Action: "delete_work", Target: "missing"}, {Action: "format_disk"}, {Action: "install_model", Target: "nope"}, {Action: "set_download_source", Value: "ftp"}} {
		if _, _, err := w.proposeTool(context.Background(), toolReq, bad); err == nil {
			t.Fatalf("无效提议应被拒绝：%+v", bad)
		}
	}
	args, _ := json.Marshal(map[string]any{"action": "delete_work", "target": gone.ID, "reason": "重复的草稿"})
	dismissArgs, _ := json.Marshal(map[string]any{"action": "delete_work", "target": keep.ID})
	turns := [][]fakeocho.Step{{{Call: "propose_action", Args: args}, {Call: "propose_action", Args: dismissArgs}, {Result: "success"}}}
	data, _ := json.Marshal(fakeocho.Plan{Turns: turns})
	planPath := filepath.Join(t.TempDir(), "plan.json")
	must(t, os.WriteFile(planPath, data, 0600))
	w.assistant = assistant.New(w.Store.Root, assistant.Options{Tools: assistantTools, NewServer: w.newAssistantServer, ExtraEnv: []string{fakeocho.PlanEnv + "=" + planPath}})
	must(t, w.SendAssistant("把草稿二删掉", AssistantContext{Locale: schema.UiLocaleZhCN}))
	messages := waitChatIdle(t, w)
	cards := replyCards(messages[len(messages)-1])
	if len(cards) != 2 || cards[0].Proposal == nil || cards[1].Proposal == nil {
		t.Fatalf("应有两张提议卡片：%+v", cards)
	}
	proposal := cards[0].Proposal
	if proposal.State != "pending" || proposal.Label != "草稿二" || proposal.Reason != "重复的草稿" || !strings.Contains(cards[0].Summary, "草稿二") {
		t.Fatalf("提议内容不对：%+v %q", proposal, cards[0].Summary)
	}
	if len(w.Store.Read().Drafts) != before {
		t.Fatal("确认之前不应删除")
	}
	must(t, w.ResolveAssistantProposal(proposal.ID, true))
	must(t, w.ResolveAssistantProposal(cards[1].Proposal.ID, false))
	if err := w.ResolveAssistantProposal(proposal.ID, true); err == nil {
		t.Fatal("已处理的提议不能再次执行")
	}
	drafts := w.Store.Read().Drafts
	if len(drafts) != before-1 || slices.ContainsFunc(drafts, func(d schema.Draft) bool { return d.ID == gone.ID }) {
		t.Fatalf("确认后只删除提议的作品：%+v", drafts)
	}
	cards = replyCards(currentMessages(w)[len(currentMessages(w))-1])
	if cards[0].Proposal.State != "confirmed" || cards[1].Proposal.State != "dismissed" {
		t.Fatalf("提议状态应写回会话：%+v %+v", cards[0].Proposal, cards[1].Proposal)
	}
}

// 确认时对象已不存在：提议标记为失败而不是执行到别的对象上。
func TestAssistantProposalStale(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	d := schema.DefaultDraft()
	must(t, w.SaveDraft(d))
	p := schema.AssistantProposal{ID: "p1", Action: "delete_work", Target: d.ID, Label: d.Title, State: "pending"}
	must(t, w.Store.Update(func(s *schema.State) {
		s.AssistantSessions = &schema.AssistantSessions{CurrentID: "s", Sessions: []schema.AssistantSession{{ID: "s", Messages: []schema.AssistantMessage{{ID: "m", Role: "assistant",
			Blocks: []schema.AssistantBlock{{Kind: "tool", Card: &schema.AssistantToolCard{Tool: "propose_action", State: "done", Proposal: &p}}}}}}}}
	}, true))
	must(t, w.DeleteDraft(d.ID))
	must(t, w.ResolveAssistantProposal("p1", true))
	if got := w.findProposal("p1"); got == nil || got.State != "failed" || got.ErrorCode != msg.ErrRequestInvalid {
		t.Fatalf("过期的提议应标记失败：%+v", got)
	}
}

// 错误日志交给模型前去掉本机路径并截断长文本。
func TestSafeFields(t *testing.T) {
	fields := safeFields(map[string]any{"path": filepath.Join(string(filepath.Separator)+"Users", "me", "voice.wav"), "code": "@yovoice.error.busy", "detail": strings.Repeat("x", 500), "count": 3})
	if fields["path"] != "voice.wav" || fields["code"] != "error.busy" || len([]rune(fields["detail"].(string))) != 241 || fields["count"] != 3 {
		t.Fatalf("字段处理不对：%+v", fields)
	}
}

// update_work 的 settings 覆盖检查器里的全部声音设置与高级参数，并走与界面一致的校验；
// 角色可以新建、套用到作品，也可以以作品当前的声音设置为起点保存。
func TestAssistantVoiceSettingsAndCharacters(t *testing.T) {
	w := assistantWorkbench(t, fakeocho.Plan{})
	ctx := context.Background()
	_, created, err := w.createWorkTool(ctx, toolReq, createWorkInput{Kind: "text", Title: "旁白", Open: boolPtr(false)})
	must(t, err)
	id := created.(map[string]any)["id"].(string)
	if live := w.Store.Read().AssistantLive; live != nil && live.Nav != nil {
		t.Fatal("open=false 不应切换界面")
	}
	temp, seed := 0.55, 42
	description := "温柔的年轻女声"
	_, summary, err := w.updateWorkTool(ctx, toolReq, updateWorkInput{ID: id, Settings: &voiceSettingsInput{
		VoiceDescription: &description, Temperature: &temp, Seed: &seed, Emotions: []float64{0, 0, .3, 0, 0, 0, 0, .7},
		ModelOptions: map[string]map[string]any{"index_tts2": {"text_chunk_size": float64(80)}},
	}})
	must(t, err)
	if changed := summary.(map[string]any)["changed"].([]string); !slices.Contains(changed, "声音设计描述") || !slices.Contains(changed, "高级参数") {
		t.Fatalf("摘要应列出改动：%v", changed)
	}
	d := w.Store.Read().Drafts[0]
	if d.VoiceDescription != description || d.Temperature != temp || *d.Seed != 42 || d.Emotions[2] != .3 || d.ModelOptions["index_tts2"]["text_chunk_size"] != float64(80) {
		t.Fatalf("设置未写入：%+v", d.SynthesisSettings)
	}
	// 清除种子；越界的值与未知的高级参数被保存校验拒绝，作品不变。
	clear := -1
	_, _, err = w.updateWorkTool(ctx, toolReq, updateWorkInput{ID: id, Settings: &voiceSettingsInput{Seed: &clear}})
	must(t, err)
	if w.Store.Read().Drafts[0].Seed != nil {
		t.Fatal("seed=-1 应恢复随机")
	}
	tooFast := 5.0
	if _, _, err = w.updateWorkTool(ctx, toolReq, updateWorkInput{ID: id, Settings: &voiceSettingsInput{Speed: &tooFast}}); err == nil {
		t.Fatal("越界的语速应被拒绝")
	}
	if _, _, err = w.updateWorkTool(ctx, toolReq, updateWorkInput{ID: id, Settings: &voiceSettingsInput{ModelOptions: map[string]map[string]any{"index_tts2": {"nope": 1.0}}}}); err == nil {
		t.Fatal("未知的高级参数应被拒绝")
	}
	if _, _, err = w.updateWorkTool(ctx, toolReq, updateWorkInput{ID: id, Settings: &voiceSettingsInput{Emotions: []float64{1}}}); err == nil {
		t.Fatal("情绪向量必须是 8 个数")
	}
	if got := w.Store.Read().Drafts[0].Speed; got != 1 {
		t.Fatalf("被拒绝的补丁不应落盘：%v", got)
	}

	// 以作品的声音设置为起点新建角色，再改名与试听台词；不应新建作品。
	works := len(w.Store.Read().Drafts)
	name, demo := "夜间旁白", "晚上好。"
	_, saved, err := w.saveCharacterTool(ctx, toolReq, saveCharacterInput{Name: &name, DemoText: &demo, FromWork: id})
	must(t, err)
	characterID := saved.(map[string]any)["id"].(string)
	characters := w.Store.Read().Characters
	if len(characters) != 1 || characters[0].Name != name || characters[0].Settings.VoiceDescription != description || characters[0].DemoText != demo || len(w.Store.Read().Drafts) != works {
		t.Fatalf("角色应带上作品的声音设置：%+v", characters)
	}
	faster := 1.2
	_, _, err = w.saveCharacterTool(ctx, toolReq, saveCharacterInput{ID: characterID, Settings: &voiceSettingsInput{Speed: &faster}})
	must(t, err)
	if w.Store.Read().Characters[0].Settings.Speed != 1.2 {
		t.Fatal("修改角色应只改给出的项")
	}
	if _, _, err = w.saveCharacterTool(ctx, toolReq, saveCharacterInput{FromWork: id}); err == nil {
		t.Fatal("新建角色需要名称")
	}

	// 套用到另一个作品：设置整体换成角色的，并记下角色；解除关联用空字符串。
	_, other, err := w.createWorkTool(ctx, toolReq, createWorkInput{Kind: "text", Title: "另一段", Open: boolPtr(false)})
	must(t, err)
	otherID := other.(map[string]any)["id"].(string)
	_, _, err = w.updateWorkTool(ctx, toolReq, updateWorkInput{ID: otherID, CharacterID: &characterID})
	must(t, err)
	applied := w.Store.Read().Drafts[0]
	if applied.ID != otherID {
		applied = w.Store.Read().Drafts[1]
	}
	if applied.CharacterID != characterID || applied.VoiceDescription != description || applied.Speed != 1.2 {
		t.Fatalf("套用角色后作品应使用角色的设置：%+v", applied.SynthesisSettings)
	}
	missing := schema.NewID()
	if _, _, err = w.updateWorkTool(ctx, toolReq, updateWorkInput{ID: otherID, CharacterID: &missing}); err == nil || !strings.Contains(err.Error(), "list_characters") {
		t.Fatal("未知角色应提示 list_characters", err)
	}

	// 故事配音：给某个角色套用声音库角色，再单独改它的参数；其他角色不受影响。
	_, story, err := w.createWorkTool(ctx, toolReq, createWorkInput{Kind: "story", Title: "双人", Open: boolPtr(false)})
	must(t, err)
	storyID := story.(map[string]any)["id"].(string)
	_, _, err = w.updateWorkTool(ctx, toolReq, updateWorkInput{ID: storyID, Subtitles: &workSubtitles{
		Speakers: []workSubtitleSpeaker{{Name: "甲"}, {Name: "乙"}}, Cues: []workSubtitleCue{{Speaker: "甲", Text: "你好"}, {Speaker: "乙", Text: "嗯"}},
	}})
	must(t, err)
	warm := 0.4
	_, _, err = w.updateWorkTool(ctx, toolReq, updateWorkInput{ID: storyID, SpeakerSettings: []workSpeakerSetting{{Speaker: "乙", CharacterID: &characterID, Settings: &voiceSettingsInput{Temperature: &warm}}}})
	must(t, err)
	var storyDraft schema.Draft
	for _, d := range w.Store.Read().Drafts {
		if d.ID == storyID {
			storyDraft = d
		}
	}
	first, second := storyDraft.Subtitles.Speakers[0], storyDraft.Subtitles.Speakers[1]
	if second.CharacterID != characterID || second.Settings == nil || second.Settings.VoiceDescription != description || second.Settings.Temperature != warm || first.CharacterID != "" {
		t.Fatalf("角色设置应只落到乙身上：%+v / %+v", first, second)
	}
	if _, _, err = w.updateWorkTool(ctx, toolReq, updateWorkInput{ID: storyID, SpeakerSettings: []workSpeakerSetting{{Speaker: "丙", Settings: &voiceSettingsInput{}}}}); err == nil {
		t.Fatal("不在角色列表里的角色应报错")
	}
}

// Kokoro 同语言双音色正权重表达式可由 update_work 保存，首个音色决定合成语言。
func TestAssistantKokoroSpeakerBlend(t *testing.T) {
	w := assistantWorkbench(t, fakeocho.Plan{})
	_, created, err := w.createWorkTool(context.Background(), toolReq, createWorkInput{Kind: "text", Title: "混合音色", Open: boolPtr(false)})
	must(t, err)
	id := created.(map[string]any)["id"].(string)
	modelID := "kokoro-82m-q8"
	must(t, w.Store.Update(func(s *schema.State) {
		s.Models = append(s.Models, schema.InstalledModel{ID: modelID})
	}, true))
	speaker, language := "zf_xiaobei(0.7)+zf_xiaoni(0.3)", "zh"
	_, _, err = w.updateWorkTool(context.Background(), toolReq, updateWorkInput{ID: id, Settings: &voiceSettingsInput{ModelID: &modelID, Speaker: &speaker, SynthesisLanguage: &language}})
	must(t, err)
	for _, d := range w.Store.Read().Drafts {
		if d.ID == id && (d.Speaker != speaker || d.SynthesisLanguage != "zh") {
			t.Fatalf("混合 speaker 未生效：%+v", d.SynthesisSettings)
		}
	}
}

// install_model 对已安装但 SHA 不同的模型显示更新卡片；无更新与未知 SHA 仍拒绝。
func TestAssistantInstallModelUpdateProposal(t *testing.T) {
	w := assistantWorkbench(t, fakeocho.Plan{})
	modelID := "kokoro-82m-q8"
	definition, err := catalog.Lookup(modelID)
	must(t, err)
	must(t, w.Store.Update(func(s *schema.State) {
		s.Models = []schema.InstalledModel{{ID: modelID, Managed: true, SHA256: "old-sha"}}
	}, true))
	w.chat.turn = &chatTurn{locale: schema.UiLocaleZhCN}
	_, _, err = w.proposeTool(context.Background(), toolReq, proposeInput{Action: "install_model", Target: modelID})
	must(t, err)
	if len(w.chat.turn.blocks) != 1 || w.chat.turn.blocks[0].Card == nil || !strings.HasPrefix(w.chat.turn.blocks[0].Card.Summary, "更新模型 ") {
		t.Fatalf("已安装的旧模型应显示更新卡片：%+v", w.chat.turn.blocks)
	}
	if names := proposalLabels["install_model_update"]; names[0] != "更新模型 %s" || names[1] != "Update model %s" {
		t.Fatalf("更新卡片中英文文案不对：%v", names)
	}
	for _, sha := range []string{definition.MainFile().SHA256, ""} {
		must(t, w.Store.Update(func(s *schema.State) {
			s.Models[0].SHA256 = sha
		}, true))
		if _, _, err = w.proposeTool(context.Background(), toolReq, proposeInput{Action: "install_model", Target: modelID}); err == nil || !strings.Contains(err.Error(), "没有可用更新") {
			t.Fatalf("无更新模型应拒绝重复安装：sha=%q err=%v", sha, err)
		}
	}
}

// 性能优先只允许 CUDA/CUDA13 与 v0.9.3+ 内核，确认后保存偏好并出现在应用状态中。
func TestAssistantPerformanceFirstProposal(t *testing.T) {
	w := assistantWorkbench(t, fakeocho.Plan{})
	current, old := "v0.9.3", "v0.9.2"
	must(t, w.Store.Update(func(s *schema.State) {
		s.Preferences.Backend, s.RuntimeVersion = "metal", &current
	}, true))
	if _, _, err := w.proposeTool(context.Background(), toolReq, proposeInput{Action: "set_performance_first", Value: "on"}); err == nil || !strings.Contains(err.Error(), "CUDA") {
		t.Fatal("非 CUDA 应拒绝性能优先", err)
	}
	must(t, w.Store.Update(func(s *schema.State) {
		s.Preferences.Backend, s.RuntimeVersion = "cuda", &old
	}, true))
	if _, _, err := w.proposeTool(context.Background(), toolReq, proposeInput{Action: "set_performance_first", Value: "on"}); err == nil || !strings.Contains(err.Error(), performanceFirstEngine) {
		t.Fatal("旧内核应拒绝性能优先", err)
	}
	must(t, w.Store.Update(func(s *schema.State) {
		s.Preferences.Backend, s.RuntimeVersion = "cuda13", &current
	}, true))
	for _, value := range []string{"true", "", "ON"} {
		if _, _, err := w.proposeTool(context.Background(), toolReq, proposeInput{Action: "set_performance_first", Value: value}); err == nil || !strings.Contains(err.Error(), "on 或 off") {
			t.Fatalf("非法性能优先值应被拒绝：%q %v", value, err)
		}
	}
	for _, value := range []string{"on", "off"} {
		must(t, w.runProposal(schema.AssistantProposal{Action: "set_performance_first", Value: value}))
		_, status, err := w.appStatusTool(context.Background(), toolReq, struct{}{})
		must(t, err)
		want := value == "on"
		if w.Store.Read().Preferences.PerformanceFirst != want || status.(map[string]any)["performanceFirst"] != want {
			t.Fatalf("性能优先状态未保存或输出：value=%s status=%+v", value, status)
		}
	}
}
