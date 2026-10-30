package workbench

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"
	"yovoice/internal/assistant"
	"yovoice/internal/assistant/fakeocho"
	"yovoice/internal/msg"
	"yovoice/internal/schema"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// 工具校验大多直接调用处理器：返回 error 即被拒绝；端到端流程另用假 ocho 驱动。
var toolReq = &mcp.CallToolRequest{}

// 一轮对话：思考与文本增量按顺序进入实时状态，工具卡片随调用更新，结束后按出现顺序写入消息记录。
func TestChatStreamsTextAndToolCards(t *testing.T) {
	w := assistantWorkbench(t, fakeocho.Plan{Turns: [][]fakeocho.Step{{
		{Thinking: "先列出作品"},
		{Delta: "你"},
		{Delta: "好"},
		{Assistant: "你好，列表在此。"},
		{Call: "list_works", Args: json.RawMessage(`{}`)},
		{Result: "success"},
	}}})
	changes, stop := w.Store.Subscribe()
	defer stop()
	must(t, w.SendAssistant("有哪些作品？", AssistantContext{Page: "text", Locale: schema.UiLocaleZhCN}))
	streamed, ran := false, false
	var lastLive *schema.AssistantLive
	deadline := time.After(30 * time.Second)
	for !(lastLive != nil && lastLive.Turn == nil && lastLive.Queued == 0 && len(currentMessages(w)) >= 2) {
		select {
		case <-changes:
		case <-deadline:
			t.Fatal("对话没有结束")
		}
		state := w.Store.Read()
		lastLive = state.AssistantLive
		if live := state.AssistantLive; live != nil && live.Turn != nil {
			ran = true
			for _, block := range live.Turn.Blocks {
				if block.Kind == "text" && strings.Contains(block.Text, "你好") {
					streamed = true
				}
			}
		}
	}
	if !ran || !streamed {
		t.Fatalf("应看到运行中的实时文本：ran=%v streamed=%v", ran, streamed)
	}
	messages := currentMessages(w)
	reply := messages[len(messages)-1]
	if reply.Role != "assistant" || reply.Status != "completed" || reply.Text != "你好，列表在此。" {
		t.Fatalf("助手消息不对：%+v", reply)
	}
	kinds := []string{}
	for _, block := range reply.Blocks {
		kinds = append(kinds, block.Kind)
	}
	if strings.Join(kinds, ",") != "thinking,text,tool" || reply.Blocks[0].Text != "先列出作品" {
		t.Fatalf("内容块顺序不对：%v", kinds)
	}
	cards := replyCards(reply)
	if len(cards) != 1 || cards[0].Tool != "list_works" || cards[0].State != "done" || cards[0].Summary == "" {
		t.Fatalf("工具卡片不对：%+v", cards)
	}
	if messages[0].Role != "user" || messages[0].Text != "有哪些作品？" {
		t.Fatalf("用户消息不对：%+v", messages[0])
	}
}

// replyCards 按顺序取出助手消息里的工具卡片。
func replyCards(m schema.AssistantMessage) []schema.AssistantToolCard {
	var cards []schema.AssistantToolCard
	for _, block := range m.Blocks {
		if block.Card != nil {
			cards = append(cards, *block.Card)
		}
	}
	return cards
}

// 运行中再发的消息排队，本轮结束后按顺序处理。
func TestChatQueuesWhileRunning(t *testing.T) {
	w := assistantWorkbench(t, fakeocho.Plan{Turns: [][]fakeocho.Step{{
		{SleepMS: 300},
		{Assistant: "第一"},
		{Result: "success"},
	}, {
		{Assistant: "第二"},
		{Result: "success"},
	}}})
	must(t, w.SendAssistant("一", AssistantContext{}))
	time.Sleep(100 * time.Millisecond)
	must(t, w.SendAssistant("二", AssistantContext{}))
	must(t, w.SendAssistant("三", AssistantContext{}))
	messages := waitChatIdle(t, w)
	if len(messages) != 6 {
		t.Fatalf("应有 6 条消息：%+v", messages)
	}
	// 用户消息发送即入库；三条回复按发送顺序在本轮结束后依次写入。
	for i, want := range []string{"一", "二", "三"} {
		if messages[i].Role != "user" || messages[i].Text != want {
			t.Fatalf("用户消息顺序不对：%+v", messages)
		}
	}
	for i, want := range []string{"第一", "第二", "第二"} {
		if messages[3+i].Role != "assistant" || messages[3+i].Text != want {
			t.Fatalf("回复顺序不对：%+v", messages)
		}
	}
}

// 取消：正在运行的一轮停止（保留已生成的部分），排队消息清空，之后能继续对话。
func TestChatCancel(t *testing.T) {
	w := assistantWorkbench(t, fakeocho.Plan{Turns: [][]fakeocho.Step{{
		{Assistant: "写到一半"},
		{WaitInterrupt: true},
	}, {
		{Result: "success"},
	}}})
	must(t, w.SendAssistant("慢慢写", AssistantContext{}))
	waitFor(t, func() bool {
		live := w.Store.Read().AssistantLive
		return live != nil && live.Turn != nil && strings.Contains(blocksText(live.Turn.Blocks), "写到一半")
	})
	must(t, w.SendAssistant("排队的", AssistantContext{}))
	waitFor(t, func() bool { return w.Store.Read().AssistantLive != nil && w.Store.Read().AssistantLive.Queued == 1 })
	w.CancelAssistant()
	messages := waitChatIdle(t, w)
	reply := messages[len(messages)-1]
	if reply.Role != "assistant" || reply.Status != "cancelled" || reply.Text != "写到一半" {
		t.Fatalf("取消后的消息不对：%+v", reply)
	}
	must(t, w.SendAssistant("再来", AssistantContext{}))
	if got := waitChatIdle(t, w); len(got) != len(messages)+2 {
		t.Fatal("取消后应能继续对话")
	}
}

// 多会话：标题取首条用户消息；切换会话用各自的助手配置目录（子进程随之重启）；
// 新建、列表、删除都作用于状态与配置目录。
func TestAssistantSessions(t *testing.T) {
	echo := filepath.Join(t.TempDir(), "user-messages.txt")
	w := assistantWorkbench(t, fakeocho.Plan{EchoUser: echo, Turns: [][]fakeocho.Step{{
		{Assistant: "第一段"},
		{Result: "success"},
	}, {
		{Assistant: "第二段"},
		{Result: "success"},
	}}})
	must(t, w.SendAssistant("第一个话题开头", AssistantContext{Page: "score", Locale: schema.UiLocaleZhCN}))
	messages := waitChatIdle(t, w)
	if len(messages) != 2 || messages[1].Text != "第一段" {
		t.Fatalf("首轮消息不对：%+v", messages)
	}
	state := w.Store.Read().AssistantSessions
	first := state.CurrentID
	if session := assistantSessionByID(w.Store.Read(), first); session == nil || session.Title != "第一个话题开头" {
		t.Fatalf("会话标题应取首条用户消息：%+v", state.Sessions)
	}
	// 新建并切换：新会话为空且成为当前，第二轮回复写入新会话。
	created, err := w.NewAssistantSession()
	must(t, err)
	if w.Store.Read().AssistantSessions.CurrentID != created.ID {
		t.Fatal("新会话应成为当前会话")
	}
	must(t, w.SendAssistant("第二个话题", AssistantContext{}))
	messages = waitChatIdle(t, w)
	if len(messages) != 2 || messages[1].Text != "第二段" {
		t.Fatalf("新会话的消息不对：%+v", messages)
	}
	if session := assistantSessionByID(w.Store.Read(), first); len(session.Messages) != 2 {
		t.Fatal("旧会话不应被新会话写入")
	}
	if sessions := w.SessionsAssistant(); len(sessions) != 2 || sessions[0].ID == first && sessions[0].UpdatedAt.Before(sessions[1].UpdatedAt) {
		t.Fatalf("会话列表应按更新时间排序：%+v", sessions)
	}
	// 切换回旧会话：配置目录不变时复用子进程，切换即换目录重启。
	must(t, w.OpenAssistantSession(first))
	if w.Store.Read().AssistantSessions.CurrentID != first {
		t.Fatal("应切回旧会话")
	}
	if err = w.OpenAssistantSession("missing"); err == nil {
		t.Fatal("切换到不存在的会话应报错")
	}
	// 删除会话：状态与配置目录都移除，当前切到剩余会话。
	second := created.ID
	must(t, w.DeleteAssistantSession(second))
	if assistantSessionByID(w.Store.Read(), second) != nil {
		t.Fatal("会话应被删除")
	}
	if _, err = os.Stat(assistantSessionDir(w.Store.Root, second)); !os.IsNotExist(err) {
		t.Fatal("会话配置目录应被删除")
	}
	if w.Store.Read().AssistantSessions.CurrentID != first {
		t.Fatal("删除当前会话后应切到剩余会话")
	}
}

// 会话切换重启助手子进程：每个会话独立的 OCHO_CONFIG_DIR 经子进程环境注入，长期记忆共享。
func TestAssistantSessionRestartsChild(t *testing.T) {
	dump := filepath.Join(t.TempDir(), "dump.txt")
	turn := func() []fakeocho.Step { return []fakeocho.Step{{AssistantPID: true}, {Result: "success"}} }
	w := assistantWorkbench(t, fakeocho.Plan{Turns: [][]fakeocho.Step{turn(), turn(), turn()}}, fakeocho.DumpEnv+"="+dump)
	pidFile := filepath.Join(w.Store.Root, "assistant", "ocho.pid")
	ask := func() string {
		t.Helper()
		must(t, w.SendAssistant("写一段", AssistantContext{}))
		waitChatIdle(t, w)
		b, err := os.ReadFile(pidFile)
		must(t, err)
		return strings.TrimSpace(string(b))
	}
	first := ask()
	if again := ask(); again != first {
		t.Fatalf("同一会话应复用子进程：%s != %s", first, again)
	}
	created, err := w.NewAssistantSession()
	must(t, err)
	_ = created
	if restarted := ask(); restarted == first {
		t.Fatal("切换会话应重启子进程")
	}
	raw, err := os.ReadFile(dump)
	must(t, err)
	text := string(raw)
	if !strings.Contains(text, "OCHO_CONFIG_DIR="+assistantSessionDir(w.Store.Root, w.Store.Read().AssistantSessions.CurrentID)) {
		t.Fatal("子进程环境应包含当前会话的配置目录")
	}
	// 偏好由 yovoice 保存：ocho 的自动记忆关闭；内置工具开放 Skill、文件读写与命令行等常规工具。
	if strings.Contains(text, "OCHO_MEMORY_DIR=") || !strings.Contains(text, "OCHO_DISABLE_AUTO_MEMORY=1") {
		t.Fatal("子进程应关闭 ocho 自动记忆")
	}
	if !strings.Contains(text, "mcp__yovoice__get_work") || !strings.Contains(text, ",Skill,Read,Write,Edit,Glob,Grep,Bash,") {
		t.Fatal("工具列表应包含 yovoice 工具与常规 agent 工具")
	}
}

// 未配置 AI 服务：消息照常入库，本轮立即以 aiNotConfigured 失败。
func TestChatWithoutProvider(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	t.Setenv("YOVOICE_OCHO_PATH", selfExecutable(t))
	must(t, w.SendAssistant("你好", AssistantContext{}))
	messages := waitChatIdle(t, w)
	reply := messages[len(messages)-1]
	if reply.Status != "failed" || reply.ErrorCode != msg.ErrAINotConfigured {
		t.Fatalf("未配置服务应失败：%+v", reply)
	}
}

// 输入校验：空消息与超长消息立即报错。
func TestChatSendValidation(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	if err = w.SendAssistant("  ", AssistantContext{}); err == nil {
		t.Fatal("空消息应报错")
	}
	if err = w.SendAssistant(strings.Repeat("长", 2001), AssistantContext{}); err == nil {
		t.Fatal("超长消息应报错")
	}
}

// 单个会话的消息有上限：超过 200 条时丢弃最旧的；会话数量超过 50 个时丢弃最旧的会话。
func TestChatHistoryLimit(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	created, err := w.NewAssistantSession()
	must(t, err)
	for i := range schema.AssistantChatLimit + 5 {
		w.appendChat(created.ID, schema.AssistantMessage{ID: string(rune('a' + i%26)), Role: "user", Text: strings.Repeat("x", i+1), CreatedAt: time.Now()})
	}
	messages := assistantSessionByID(w.Store.Read(), created.ID).Messages
	if len(messages) != schema.AssistantChatLimit {
		t.Fatalf("应截断到 %d 条，实际 %d", schema.AssistantChatLimit, len(messages))
	}
	if messages[0].Text != strings.Repeat("x", 6) {
		t.Fatalf("应保留最新的消息：%+v", messages[0])
	}
	for range schema.AssistantSessionLimit + 2 {
		_, err = w.NewAssistantSession()
		must(t, err)
	}
	if sessions := w.Store.Read().AssistantSessions.Sessions; len(sessions) != schema.AssistantSessionLimit {
		t.Fatalf("会话应截断到 %d 个，实际 %d", schema.AssistantSessionLimit, len(sessions))
	}
}

// 消息前缀：界面上下文按页面/作品/语言拼装，作品信息优先取状态里的真实值。
func TestChatMessagePrefix(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	d := schema.DefaultDraft()
	d.Title, d.Kind = "夜色钢琴", "score"
	must(t, w.SaveDraft(d))
	text := w.chatMessageText(chatMessage{text: "改一下", context: AssistantContext{Page: "score", WorkID: d.ID, WorkTitle: "旧标题", Locale: schema.UiLocaleZhCN}})
	if !strings.Contains(text, "page: arrangement") || !strings.Contains(text, `"夜色钢琴"`) || !strings.Contains(text, "kind score") || !strings.Contains(text, "ui_locale: zh-CN") || !strings.HasSuffix(text, "改一下") {
		t.Fatalf("上下文前缀不对：%q", text)
	}

}

// 作品工具的创建、读取与事件：create_work 落盘并发跳转事件，get_work 不带时间线。
func TestChatWorkTools(t *testing.T) {
	w := assistantWorkbench(t, fakeocho.Plan{})
	_, _, err := w.createWorkTool(context.Background(), toolReq, createWorkInput{Kind: "编曲错误"})
	if err == nil || !strings.Contains(err.Error(), "kind") {
		t.Fatal("无效类型应报错", err)
	}
	_, result, err := w.createWorkTool(context.Background(), toolReq, createWorkInput{Kind: "score", Title: " 夜曲 "})
	must(t, err)
	id := result.(map[string]any)["id"].(string)
	s := w.Store.Read()
	draft, ok := s.Drafts[0], false
	for _, d := range s.Drafts {
		if d.ID == id {
			draft, ok = d, true
		}
	}
	if !ok || draft.Title != "夜曲" || draft.Kind != "score" || draft.Score == nil || draft.ModelID != "musescore-general-sf2" {
		t.Fatalf("新建的编曲作品不对：%+v", draft)
	}
	if nav := s.AssistantLive.Nav; nav == nil || nav.WorkID != id {
		t.Fatalf("应发出打开作品事件：%+v", s.AssistantLive)
	}
	// get_work：可编辑内容齐全，时间线这类大字段不出现。
	must(t, w.Store.Update(func(s *schema.State) {
		for i := range s.Drafts {
			if s.Drafts[i].ID == id {
				s.Drafts[i].Timeline = &schema.AudioTimeline{Tracks: []schema.AudioLane{{ID: "l", Name: "轨", Clips: []schema.AudioClip{{ID: "c", Start: 1, Duration: 1}}}}}
			}
		}
	}, true))
	_, content, err := w.getWorkTool(context.Background(), toolReq, workIDInput{ID: id})
	must(t, err)
	encoded, _ := json.Marshal(content)
	if strings.Contains(string(encoded), "timeline") || !strings.Contains(string(encoded), "夜曲") {
		t.Fatalf("get_work 内容不对：%s", encoded)
	}
	if _, _, err = w.getWorkTool(context.Background(), toolReq, workIDInput{ID: "missing"}); err == nil || !strings.Contains(err.Error(), "list_works") {
		t.Fatal("未知作品应提示 list_works", err)
	}
}

// update_work：乐谱走同一套校验、错误信息具体；成功后作品更新并发刷新事件。
func TestChatUpdateWorkScore(t *testing.T) {
	w := assistantWorkbench(t, fakeocho.Plan{})
	_, created, err := w.createWorkTool(context.Background(), toolReq, createWorkInput{Kind: "score", Title: "示例小步舞曲"})
	must(t, err)
	id := created.(map[string]any)["id"].(string)
	bad, _ := json.Marshal(map[string]any{"tempo": 100, "timeSignature": []int{4, 4}, "tracks": []any{
		map[string]any{"id": "p", "name": "钢琴", "program": 0, "notes": []any{[]any{1, 99, 60, 1, 80}}},
	}})
	var score scoreInput
	must(t, json.Unmarshal(bad, &score))
	if _, _, err = w.updateWorkTool(context.Background(), toolReq, updateWorkInput{ID: id, Score: &score}); err == nil || !strings.Contains(err.Error(), "beat") {
		t.Fatal("越拍音符应给出具体错误", err)
	}
	good, _ := json.Marshal(map[string]any{"tempo": 96, "timeSignature": []int{4, 4}, "tracks": []any{
		map[string]any{"id": "p", "name": "钢琴", "role": "piano", "program": 0, "notes": []any{[]any{1, 1, 60, 1, 80}, []any{1, 3, 64, 1, 76}}},
	}})
	must(t, json.Unmarshal(good, &score))
	_, summary, err := w.updateWorkTool(context.Background(), toolReq, updateWorkInput{ID: id, Score: &score})
	must(t, err)
	if summary.(map[string]any)["notes"] != 2 {
		t.Fatalf("摘要不对：%+v", summary)
	}
	draft := w.Store.Read().Drafts[0]
	if draft.Score == nil || len(draft.Score.Tracks[0].Notes) != 2 || draft.Score.Tempo != 96 {
		t.Fatalf("乐谱未写入：%+v", draft.Score)
	}
	if update := w.Store.Read().AssistantLive.Update; update == nil || update.WorkID != id {
		t.Fatalf("应发出作品刷新事件：%+v", w.Store.Read().AssistantLive)
	}
}

// update_work 的其余字段：歌词纯音乐规则、演唱语言、模型与音色检查、故事配音的角色台词与音色分配。
func TestChatUpdateWorkFields(t *testing.T) {
	w := assistantWorkbench(t, fakeocho.Plan{})
	_, created, err := w.createWorkTool(context.Background(), toolReq, createWorkInput{Kind: "music", Title: "夏夜"})
	must(t, err)
	id := created.(map[string]any)["id"].(string)
	if _, _, err = w.updateWorkTool(context.Background(), toolReq, updateWorkInput{ID: id, Instrumental: boolPtr(true), Lyrics: strPtr("[verse]\n有歌词的行")}); err == nil || !strings.Contains(err.Error(), "section markers only") {
		t.Fatal("纯音乐歌词只允许段落标记", err)
	}
	if _, _, err = w.updateWorkTool(context.Background(), toolReq, updateWorkInput{ID: id, Language: strPtr("xx")}); err == nil || !strings.Contains(err.Error(), "演唱语言") {
		t.Fatal("不支持的演唱语言应报错", err)
	}
	if _, _, err = w.updateWorkTool(context.Background(), toolReq, updateWorkInput{ID: id, ModelID: strPtr("ace-step-1.5-turbo-bf16")}); err == nil || !strings.Contains(err.Error(), "尚未安装") {
		t.Fatal("未安装的模型应引导用户去设置", err)
	}
	if _, _, err = w.updateWorkTool(context.Background(), toolReq, updateWorkInput{ID: id, VoiceID: strPtr("v1")}); err == nil || !strings.Contains(err.Error(), "list_voices") {
		t.Fatal("未知音色应提示 list_voices", err)
	}
	style, lyrics, language := "city pop", "[verse]\n晚风", "zh"
	_, _, err = w.updateWorkTool(context.Background(), toolReq, updateWorkInput{ID: id, Text: &style, Lyrics: &lyrics, Language: &language})
	must(t, err)
	draft := w.Store.Read().Drafts[0]
	if draft.Text != style || draft.Lyrics != lyrics || draft.SynthesisLanguage != "zh" {
		t.Fatalf("音乐字段未写入：%+v", draft)
	}

	// 故事配音：subtitles 整体写入，speakerVoices 按名字分配已有角色。
	_, story, err := w.createWorkTool(context.Background(), toolReq, createWorkInput{Kind: "story", Title: "双人故事"})
	must(t, err)
	storyID := story.(map[string]any)["id"].(string)
	voiceID := schema.NewID()
	must(t, w.Store.Update(func(s *schema.State) {
		s.Voices = append(s.Voices, schema.Voice{ID: voiceID, Name: "暖声", FileName: "v.wav"})
	}, true))
	badCues := &workSubtitles{
		Speakers: []workSubtitleSpeaker{{Name: "旁白"}, {Name: "主角"}},
		Cues:     []workSubtitleCue{{Speaker: "旁白", Text: "夜里。"}, {Speaker: "没有这个角色", Text: "我来了。"}},
	}
	if _, _, err = w.updateWorkTool(context.Background(), toolReq, updateWorkInput{ID: storyID, Subtitles: badCues}); err == nil || !strings.Contains(err.Error(), "speaker") {
		t.Fatal("台词角色不在列表应报错", err)
	}
	_, _, err = w.updateWorkTool(context.Background(), toolReq, updateWorkInput{ID: storyID, Subtitles: &workSubtitles{
		Speakers: []workSubtitleSpeaker{{Name: "旁白"}, {Name: "主角"}},
		Cues:     []workSubtitleCue{{Speaker: "旁白", Text: "夜里。"}, {Speaker: "主角", Text: "我来了。"}},
	}})
	must(t, err)
	draft = w.Store.Read().Drafts[0]
	if len(draft.Subtitles.Speakers) != 2 || len(draft.Subtitles.Cues) != 2 || draft.Text != "夜里。\n我来了。" {
		t.Fatalf("故事配音未写入：%+v", draft.Subtitles)
	}
	_, _, err = w.updateWorkTool(context.Background(), toolReq, updateWorkInput{ID: storyID, SpeakerVoices: []workSpeakerVoice{{Speaker: "主角", VoiceID: voiceID}}})
	must(t, err)
	draft = w.Store.Read().Drafts[0]
	assigned := draft.Subtitles.Speakers[1].Settings.VoiceID
	if assigned == nil || *assigned != voiceID {
		t.Fatalf("角色音色未分配：%+v", draft.Subtitles.Speakers[1])
	}
}

// generate_work 在缺少推理内核时返回明确错误；open_page 发出页面跳转事件。
func TestChatGenerateAndOpenPage(t *testing.T) {
	w := assistantWorkbench(t, fakeocho.Plan{})
	_, created, err := w.createWorkTool(context.Background(), toolReq, createWorkInput{Kind: "text", Title: "旁白"})
	must(t, err)
	id := created.(map[string]any)["id"].(string)
	if _, _, err = w.generateWorkTool(context.Background(), toolReq, generateWorkInput{ID: id}); err == nil {
		t.Fatal("缺少推理内核应报错", err)
	} else {
		var ce *msg.CallError
		if !errors.As(err, &ce) {
			t.Fatal("应是带错误码的失败", err)
		}
	}
	_, _, err = w.openPageTool(context.Background(), toolReq, pageInput{Page: "编曲"})
	if err == nil || !strings.Contains(err.Error(), "page") {
		t.Fatal("无效页面应报错", err)
	}
	_, _, err = w.openPageTool(context.Background(), toolReq, pageInput{Page: "score"})
	must(t, err)
	if nav := w.Store.Read().AssistantLive.Nav; nav == nil || nav.Page != "score" {
		t.Fatalf("应发出页面跳转事件：%+v", w.Store.Read().AssistantLive)
	}
}

// 端到端：假 ocho 在对话里先新建编曲作品、再按已知 id 写入乐谱，界面事件与消息卡片齐全。
func TestChatEndToEndCreateAndUpdate(t *testing.T) {
	w := assistantWorkbench(t, fakeocho.Plan{})
	// 先直接建好一个编曲作品，拿到 id 写进计划（假 ocho 的计划在启动前固定）。
	_, created, err := w.createWorkTool(context.Background(), toolReq, createWorkInput{Kind: "score", Title: "示例小步舞曲"})
	must(t, err)
	id := created.(map[string]any)["id"].(string)
	args, mErr := json.Marshal(map[string]any{"id": id, "score": map[string]any{
		"tempo": 100, "timeSignature": []int{4, 4},
		"tracks": []any{map[string]any{"id": "p", "name": "钢琴", "role": "piano", "program": 0,
			"notes": []any{[]any{1, 1, 60, 1, 80}, []any{1, 3, 64, 1, 76}}}},
	}})
	must(t, mErr)
	turns := [][]fakeocho.Step{{
		{Call: "list_works", Args: json.RawMessage(`{}`)},
		{Call: "get_work", Args: json.RawMessage(`{"id":"` + id + `"}`)},
		{Call: "update_work", Args: args},
		{Result: "success"},
	}}
	data, mErr := json.Marshal(fakeocho.Plan{Turns: turns})
	must(t, mErr)
	planPath := filepath.Join(t.TempDir(), "plan.json")
	must(t, os.WriteFile(planPath, data, 0600))
	w.assistant = assistant.New(w.Store.Root, assistant.Options{Tools: assistantTools, NewServer: w.newAssistantServer,
		ExtraEnv: []string{fakeocho.PlanEnv + "=" + planPath}})
	must(t, w.SendAssistant("给这个作品写四小节钢琴旋律", AssistantContext{Page: "score", WorkID: id, WorkTitle: "示例小步舞曲", WorkKind: "score", Locale: schema.UiLocaleZhCN}))
	messages := waitChatIdle(t, w)
	reply := messages[len(messages)-1]
	if reply.Status != "completed" {
		t.Fatalf("本轮应完成：%+v", reply)
	}
	var notes []schema.ScoreNote
	for _, d := range w.Store.Read().Drafts {
		if d.ID == id && d.Score != nil && len(d.Score.Tracks) > 0 {
			notes = d.Score.Tracks[0].Notes
		}
	}
	if len(notes) != 2 {
		t.Fatalf("乐谱未写入：%+v", notes)
	}
	if cards := replyCards(reply); len(cards) != 3 || cards[2].Tool != "update_work" || cards[2].State != "done" {
		t.Fatalf("工具卡片不对：%+v", cards)
	}
	live := w.Store.Read().AssistantLive
	if live.Update == nil || live.Update.WorkID != id {
		t.Fatalf("应发出作品刷新事件：%+v", live)
	}
}

// currentMessages 返回当前会话的消息。
func currentMessages(w *Workbench) []schema.AssistantMessage {
	s := w.Store.Read()
	if s.AssistantSessions == nil {
		return nil
	}
	if session := assistantSessionByID(s, s.AssistantSessions.CurrentID); session != nil {
		return session.Messages
	}
	return nil
}

// waitFor 轮询状态直到条件满足或超时。
func waitFor(t *testing.T, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	for !ok() {
		if time.Now().After(deadline) {
			t.Fatal("等待超时")
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func strPtr(s string) *string { return &s }
func boolPtr(b bool) *bool    { return &b }

// 新作品沿用最近一次同类作品用过的已安装模型；没有时取第一个已安装的同类模型，未安装的模型不作默认。
func TestPreferredModel(t *testing.T) {
	older, newer := time.Now().Add(-time.Hour), time.Now()
	s := schema.State{
		Models: []schema.InstalledModel{{ID: "sheetsage2-q8"}, {ID: "ace-step-1.5-turbo-q8"}, {ID: "yue2-3b-q4"}, {ID: "omnivoice-q8"}, {ID: "generaluser-gs-sf2"}},
		Drafts: []schema.Draft{
			{Kind: "music", SynthesisSettings: schema.SynthesisSettings{ModelID: "yue2-3b-q4"}, UpdatedAt: &older},
			{Kind: "music", SynthesisSettings: schema.SynthesisSettings{ModelID: "ace-step-1.5-turbo-bf16"}, UpdatedAt: &newer},
		},
	}
	for kind, want := range map[string]string{"music": "yue2-3b-q4", "score": "generaluser-gs-sf2", "text": "omnivoice-q8", "story": "omnivoice-q8"} {
		if got := preferredModel(s, kind, "index-2.5-q8"); got != want {
			t.Errorf("%s 默认模型 = %s，应为 %s", kind, got, want)
		}
	}
	if got := preferredModel(schema.State{}, "music", ""); got != "ace-step-1.5-turbo-bf16" {
		t.Errorf("没有已安装模型时音乐默认 = %s", got)
	}
}

// add_timeline_audio 复制整段生成，支持按名称、序号或默认新轨添加，并默认追加到轨道末尾。
func TestAssistantAddTimelineAudio(t *testing.T) {
	w := assistantWorkbench(t, fakeocho.Plan{})
	ctx := context.Background()
	source := schema.DefaultDraft()
	source.Kind, source.Title, source.Text = "sfx", "脚步", "footsteps on gravel"
	generationID := schema.NewID()
	sourcePath := filepath.Join(w.Store.Root, "outputs", generationID+".wav")
	must(t, os.WriteFile(sourcePath, wav(), 0600))
	must(t, w.Store.Update(func(s *schema.State) {
		s.History = []schema.Generation{{ID: generationID, Title: "版本 1", FileName: generationID + ".wav", CreatedAt: time.Now(), Duration: 1, Settings: source}}
	}, true))
	story := schema.DefaultDraft()
	story.Kind, story.Title, story.Text = "story", "夜晚", ""
	story.Timeline = &schema.AudioTimeline{Tracks: []schema.AudioLane{{ID: "track-1", Name: "环境", Clips: []schema.AudioClip{{ID: "existing", GenerationID: generationID, Start: 2, Duration: 1}}}}}
	must(t, w.SaveDraft(story))

	_, added, err := w.addTimelineAudioTool(ctx, toolReq, addTimelineAudioInput{ID: story.ID, GenerationID: generationID, Track: "环境"})
	must(t, err)
	result := added.(map[string]any)
	if result["start"] != 3.0 || result["track"] != "环境" {
		t.Fatalf("按名称添加应默认追加到末尾：%+v", result)
	}
	assetID := result["assetId"].(string)
	assetPath := filepath.Join(w.Store.Root, "outputs", "import-"+assetID+".wav")
	sourceBytes, err := os.ReadFile(sourcePath)
	must(t, err)
	assetBytes, err := os.ReadFile(assetPath)
	must(t, err)
	if string(sourceBytes) != string(assetBytes) {
		t.Fatal("导入素材应复制完整源音频")
	}
	saved := func() schema.Draft {
		for _, d := range w.Store.Read().Drafts {
			if d.ID == story.ID {
				return d
			}
		}
		t.Fatal("故事作品丢失")
		return schema.Draft{}
	}
	d := saved()
	if len(d.Timeline.Assets) != 1 || d.Timeline.Assets[0].Name != "脚步 · 版本 1" {
		t.Fatalf("独立素材及命名不对：%+v", d.Timeline.Assets)
	}
	clip := d.Timeline.Tracks[0].Clips[1]
	if clip.AssetID != assetID || clip.GenerationID != "" || clip.ID == "" || clip.Offset != 0 || clip.Duration != 1 {
		t.Fatalf("素材剪辑不对：%+v", clip)
	}

	explicit := 0.5
	_, added, err = w.addTimelineAudioTool(ctx, toolReq, addTimelineAudioInput{ID: story.ID, GenerationID: generationID, Track: "1", Start: &explicit})
	must(t, err)
	if added.(map[string]any)["start"] != explicit {
		t.Fatalf("按序号与显式 start 添加失败：%+v", added)
	}
	_, added, err = w.addTimelineAudioTool(ctx, toolReq, addTimelineAudioInput{ID: story.ID, GenerationID: generationID})
	must(t, err)
	if added.(map[string]any)["track"] != "音效" || added.(map[string]any)["start"] != 0.0 {
		t.Fatalf("默认应新建音效轨并从头开始：%+v", added)
	}
	d = saved()
	if len(d.Timeline.Tracks) != 2 || len(d.Timeline.Tracks[0].Clips) != 3 || len(d.Timeline.Tracks[1].Clips) != 1 {
		t.Fatalf("轨道或剪辑数量不对：%+v", d.Timeline.Tracks)
	}
	if update := w.Store.Read().AssistantLive.Update; update == nil || update.WorkID != story.ID {
		t.Fatalf("成功添加后应发出 chatUpdate：%+v", w.Store.Read().AssistantLive)
	}

	_, content, err := w.getWorkTool(ctx, toolReq, workIDInput{ID: story.ID})
	must(t, err)
	tracks := content.(map[string]any)["tracks"].([]map[string]any)
	if len(tracks) != 2 || tracks[0]["index"] != 1 || tracks[0]["end"] != 4.0 {
		t.Fatalf("get_work 轨道摘要不对：%+v", tracks)
	}
	encoded, _ := json.Marshal(content)
	if strings.Contains(string(encoded), `"clips"`) || strings.Contains(string(encoded), `"assets"`) {
		t.Fatalf("get_work 不应返回全部剪辑或素材：%s", encoded)
	}

	if _, _, err = w.addTimelineAudioTool(ctx, toolReq, addTimelineAudioInput{ID: story.ID, GenerationID: generationID, Track: "不存在"}); err == nil {
		t.Fatal("未知轨道应被拒绝")
	}
	for _, invalid := range []float64{-1, math.NaN(), math.Inf(1), 86401} {
		if _, _, err = w.addTimelineAudioTool(ctx, toolReq, addTimelineAudioInput{ID: story.ID, GenerationID: generationID, Start: &invalid}); err == nil {
			t.Fatalf("非法 start 应被拒绝：%v", invalid)
		}
	}
	d = saved()
	d.Timeline.Tracks[0].Locked = true
	must(t, w.SaveDraft(d))
	if _, _, err = w.addTimelineAudioTool(ctx, toolReq, addTimelineAudioInput{ID: story.ID, GenerationID: generationID, Track: "1"}); err == nil || !strings.Contains(err.Error(), "锁定") {
		t.Fatal("锁定轨道应被拒绝", err)
	}
	plain := schema.DefaultDraft()
	must(t, w.SaveDraft(plain))
	if _, _, err = w.addTimelineAudioTool(ctx, toolReq, addTimelineAudioInput{ID: plain.ID, GenerationID: generationID}); err == nil || !strings.Contains(err.Error(), "story") {
		t.Fatal("非故事作品应被拒绝", err)
	}
}

// SessionsAssistant 返回会话列表，按更新时间从新到旧；只有测试在用，生产代码不再提供。
func (w *Workbench) SessionsAssistant() []schema.AssistantSession {
	s := w.Store.Read().AssistantSessions
	sessions := append([]schema.AssistantSession{}, s.Sessions...)
	sort.SliceStable(sessions, func(i, j int) bool { return sessions[i].UpdatedAt.After(sessions[j].UpdatedAt) })
	return sessions
}
