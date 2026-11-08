package workbench

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"
	"yovoice/internal/assistant"
	"yovoice/internal/assistant/fakeocho"
	"yovoice/internal/llm"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
)

// 服务配置写入状态，密钥只在状态库的私有设置中；清除与删除同步移除密钥。
func TestAIProviderKeysStayOutOfState(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	key := "sk-very-secret-key-000"
	p, err := w.SaveAIProvider(AIProviderInput{Preset: "deepseek", BaseURL: "http://evil.test", Format: "responses", Key: &key, Model: "deepseek-chat"})
	must(t, err)
	if p.BaseURL != "https://api.deepseek.com" || p.Format != "chat_completions" || p.KeyMask != "sk-v••••••••-000" {
		t.Fatalf("固定预设应忽略地址与协议：%+v", p)
	}
	if w.Store.Read().AIProviderID != p.ID {
		t.Fatal("第一个服务应成为当前服务")
	}
	if state, _ := json.Marshal(w.Store.Read()); strings.Contains(string(state), key) {
		t.Fatal("密钥不应出现在广播给界面的状态中")
	}
	info, err := os.Stat(filepath.Join(w.Store.Root, "yovoice.db"))
	must(t, err)
	if info.Mode().Perm()&0077 != 0 && os.PathSeparator == '/' {
		t.Fatal("状态库权限应为 0600", info.Mode())
	}
	// 不传 Key 时保留密钥。
	p, err = w.SaveAIProvider(AIProviderInput{ID: p.ID, Preset: "deepseek", Name: "我的 DeepSeek", Model: "deepseek-reasoner"})
	must(t, err)
	if _, c, _ := w.aiConfig(""); c.Key != key || p.Name != "我的 DeepSeek" {
		t.Fatal("未传密钥时应保留原密钥")
	}
	if _, err = w.SaveAIProvider(AIProviderInput{Preset: "custom", BaseURL: "ftp://x", Format: "chat_completions"}); err == nil {
		t.Fatal("应拒绝非 http 地址")
	}
	local, err := w.SaveAIProvider(AIProviderInput{Preset: "ollama", BaseURL: "http://192.168.1.5:11434/v1", Format: "anthropic_messages"})
	must(t, err)
	if local.BaseURL != "http://192.168.1.5:11434/v1" || local.Format != "chat_completions" {
		t.Fatalf("本地服务只允许改地址：%+v", local)
	}
	// 写作栏切换服务与模型：同时改当前服务和它的模型，模型留空时保持原值。
	must(t, w.UseAIProvider(local.ID, "qwen3:8b"))
	must(t, w.UseAIProvider(p.ID, ""))
	if s := w.Store.Read(); s.AIProviderID != p.ID || s.AIProviders[0].Model != "deepseek-reasoner" || s.AIProviders[1].Model != "qwen3:8b" {
		t.Fatalf("切换服务与模型错误：%+v", s.AIProviders)
	}
	if w.UseAIProvider("missing", "") == nil {
		t.Fatal("应拒绝不存在的服务")
	}
	must(t, w.DeleteAIProvider(p.ID))
	keys, err := w.readSecrets()
	must(t, err)
	if _, ok := keys[p.ID]; ok || w.Store.Read().AIProviderID != local.ID {
		t.Fatal("删除服务应移除密钥并切换当前服务")
	}
}

// fakeModels 返回一个可用的模型列表与连通测试服务，供助手测试的工作台使用。
func fakeModels(t *testing.T) *httptest.Server {
	var n atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			_, _ = w.Write([]byte(`{"data":[{"id":"qwen3"},{"id":"llama3"}]}`))
			return
		}
		n.Add(1)
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"OK"},"finish_reason":"stop"}]}`))
	}))
	t.Cleanup(server.Close)
	return server
}

// assistantWorkbench 准备一个指向假 LLM 服务的 Workbench；助手运行时指向测试二进制（假 ocho），
// 假运行时的开关经 Options.ExtraEnv 注入子进程环境。
func assistantWorkbench(t *testing.T, plan fakeocho.Plan, extraEnv ...string) *Workbench {
	w, err := New(t.TempDir())
	must(t, err)
	t.Cleanup(w.Close)
	_, err = w.SaveAIProvider(AIProviderInput{Preset: "ollama", BaseURL: fakeModels(t).URL + "/v1"})
	must(t, err)
	_, err = w.AIModels(context.Background(), "")
	must(t, err)
	t.Setenv("YOVOICE_OCHO_PATH", selfExecutable(t))
	data, err := json.Marshal(plan)
	must(t, err)
	path := filepath.Join(t.TempDir(), "plan.json")
	must(t, os.WriteFile(path, data, 0600))
	w.assistant = assistant.New(w.Store.Root, assistant.Options{Tools: assistantTools, NewServer: w.newAssistantServer,
		ExtraEnv: append([]string{fakeocho.PlanEnv + "=" + path}, extraEnv...)})
	t.Cleanup(func() {
		if t.Failed() {
			if log, e := os.ReadFile(filepath.Join(w.Store.Root, "logs", "assistant.log")); e == nil {
				t.Logf("child log:\n%s", log)
			}
		}
	})
	return w
}

func selfExecutable(t *testing.T) string {
	t.Helper()
	executable, err := os.Executable()
	must(t, err)
	return executable
}

// fakeLLM 依次返回给定的回复，记录收到的请求；供分角色、旋律谱等后台 AI 任务测试。
func fakeLLM(t *testing.T, replies ...string) (*httptest.Server, *[]map[string]any) {
	var requests []map[string]any
	var n atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			_, _ = w.Write([]byte(`{"data":[{"id":"qwen3"},{"id":"llama3"}]}`))
			return
		}
		var body map[string]any
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &body)
		requests = append(requests, body)
		i := int(n.Add(1)) - 1
		reply, _ := json.Marshal(replies[min(i, len(replies)-1)])
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":` + string(reply) + `},"finish_reason":"stop"}]}`))
	}))
	t.Cleanup(server.Close)
	return server, &requests
}

func aiWorkbench(t *testing.T, server *httptest.Server) *Workbench {
	w, err := New(t.TempDir())
	must(t, err)
	t.Cleanup(w.Close)
	_, err = w.SaveAIProvider(AIProviderInput{Preset: "ollama", BaseURL: server.URL + "/v1"})
	must(t, err)
	return w
}

// waitAI 等待后台任务结束并返回最终状态。
func waitAI(t *testing.T, w *Workbench) schema.AITask {
	t.Helper()
	changes, stop := w.Store.Subscribe()
	defer stop()
	deadline := time.After(10 * time.Second)
	for {
		if task := w.Store.Read().AITask; task != nil && task.Status != "running" {
			return *task
		}
		select {
		case <-changes:
		case <-deadline:
			t.Fatal("AI 任务没有结束")
		}
	}
}

// 模型列表与连通测试的结果写回服务。
func TestAIModelsAndTest(t *testing.T) {
	server, _ := fakeLLM(t, "OK")
	w := aiWorkbench(t, server)
	id := w.Store.Read().AIProviderID
	models, err := w.AIModels(context.Background(), id)
	must(t, err)
	p := w.Store.Read().AIProviders[0]
	if len(models) != 2 || p.Model != "llama3" || len(p.Models) != 2 {
		t.Fatalf("应保存模型列表并选中第一个：%+v", p)
	}
	result, err := w.TestAIProvider(context.Background(), id)
	must(t, err)
	if !result.OK || w.Store.Read().AIProviders[0].LastTest == nil {
		t.Fatal("测试结果应记录在服务上", result)
	}
}

// 循环段落只写一遍，由 repeats 展开；展开后超出音符上限要报错。
func TestBuildScoreRepeats(t *testing.T) {
	in := scoreInput{}
	in.Tempo, in.TimeSignature = 120, []int{4, 4}
	in.Tracks = append(in.Tracks, scoreTrack{ID: "d", Name: "鼓", Role: "drums", Notes: []scoreNoteInput{
		[]any{float64(1), float64(1), float64(36), float64(1), float64(100)},
		[]any{float64(2), float64(3), float64(38), float64(1), float64(90)},
		[]any{float64(5), float64(1), float64(49), float64(2), float64(110)},
	}, Repeats: []scoreRepeat{{From: 1, To: 2, At: []int{3, 9}}}})
	s, err := buildScore(in)
	must(t, err)
	notes := s.Tracks[0].Notes
	if len(notes) != 7 || notes[2].Bar != 3 || notes[3].Bar != 4 || notes[3].Beat != 3 || notes[4].Bar != 5 || notes[6].Bar != 10 {
		t.Fatalf("展开结果不对：%+v", notes)
	}
	many, at := make([]scoreNoteInput, 0, 400), make([]int, 0, 60)
	for i := range 400 {
		many = append(many, []any{float64(1), float64(1) + float64(i)/100, float64(60), float64(0.01), float64(80)})
	}
	for i := range 60 {
		at = append(at, i+2)
	}
	in.Tracks[0].Notes, in.Tracks[0].Repeats = many, []scoreRepeat{{From: 1, To: 1, At: at}}
	if _, err = buildScore(in); err == nil || !strings.Contains(err.Error(), "after repeats") {
		t.Fatal("展开超出上限应报错")
	}
}

// 助手子进程继承偏好里的代理设置：未配置时透传宿主环境（含小写与 NO_PROXY），
// 启用时三变量指向配置地址并保留本机直连，显式关闭时不设任何代理变量。
func TestAssistantProxyEnv(t *testing.T) {
	dump := filepath.Join(t.TempDir(), "dump.txt")
	w := assistantWorkbench(t, fakeocho.Plan{Turns: [][]fakeocho.Step{{
		{Assistant: "好"},
		{Result: "success"},
	}, {
		{Assistant: "好"},
		{Result: "success"},
	}, {
		{Assistant: "好"},
		{Result: "success"},
	}}}, fakeocho.DumpEnv+"="+dump)
	ask := func() {
		t.Helper()
		must(t, w.SendAssistant("写一段", AssistantContext{}))
		waitChatIdle(t, w)
	}
	dumpText := func() string {
		t.Helper()
		b, err := os.ReadFile(dump)
		must(t, err)
		// Windows 的环境变量名不分大小写，HTTPS_PROXY 与 https_proxy 是同一个变量，只会留下一份。
		if runtime.GOOS == "windows" {
			return strings.ToUpper(string(b))
		}
		return string(b)
	}
	has := func(text, entry string) bool {
		if runtime.GOOS == "windows" {
			entry = strings.ToUpper(entry)
		}
		return strings.Contains(text, entry)
	}
	for _, name := range []string{"HTTPS_PROXY", "https_proxy", "NO_PROXY"} {
		t.Setenv(name, "http://from-host:7890")
	}
	ask()
	if text := dumpText(); !has(text, "HTTPS_PROXY=http://from-host:7890") ||
		!has(text, "https_proxy=http://from-host:7890") || !has(text, "NO_PROXY=http://from-host:7890") {
		t.Fatal("未配置时应透传宿主代理变量")
	}
	p := w.Store.Read().Preferences
	enabled := true
	p.ProxyEnabled, p.ProxyURL = &enabled, "http://127.0.0.1:7890"
	must(t, w.SavePreferences(p))
	ask()
	if text := dumpText(); !has(text, "HTTPS_PROXY=http://127.0.0.1:7890") ||
		!has(text, "HTTP_PROXY=http://127.0.0.1:7890") || !has(text, "ALL_PROXY=http://127.0.0.1:7890") ||
		!has(text, "NO_PROXY=localhost,127.0.0.1,::1") {
		t.Fatal("启用代理时应设置三变量并保留本机直连")
	}
	disabled := false
	p.ProxyEnabled = &disabled
	must(t, w.SavePreferences(p))
	ask()
	if text := dumpText(); strings.Contains(text, "PROXY=") || strings.Contains(text, "proxy=") {
		t.Fatal("显式关闭后不应再有任何代理变量")
	}
}

// 代理设置参与 Config.Env：变化后助手子进程重启，未变化时复用进程。
func TestAssistantProxyChangeRestartsChild(t *testing.T) {
	turn := func() []fakeocho.Step {
		return []fakeocho.Step{{Assistant: "好"}, {Result: "success"}}
	}
	w := assistantWorkbench(t, fakeocho.Plan{Turns: [][]fakeocho.Step{turn(), turn(), turn()}})
	pidFile := filepath.Join(w.Store.Root, "assistant", "ocho.pid")
	compose := func() string {
		t.Helper()
		must(t, w.SendAssistant("写一段", AssistantContext{}))
		waitChatIdle(t, w)
		b, err := os.ReadFile(pidFile)
		must(t, err)
		return strings.TrimSpace(string(b))
	}
	first := compose()
	// 配置不变：复用进程。
	if again := compose(); again != first {
		t.Fatalf("配置未变不应重启：%s != %s", first, again)
	}
	enabled := true
	p := w.Store.Read().Preferences
	p.ProxyEnabled, p.ProxyURL = &enabled, "http://127.0.0.1:7890"
	must(t, w.SavePreferences(p))
	if restarted := compose(); restarted == first {
		t.Fatal("代理变化应重启助手子进程")
	}
}

// waitChatIdle 等待对话完全结束（无运行中的一轮、无排队、最后一条不是未回复的用户消息）。
func waitChatIdle(t *testing.T, w *Workbench) []schema.AssistantMessage {
	t.Helper()
	changes, stop := w.Store.Subscribe()
	defer stop()
	deadline := time.After(30 * time.Second)
	idle := func(s schema.State) []schema.AssistantMessage {
		if live := s.AssistantLive; live != nil && (live.Turn != nil || live.Queued > 0) {
			return nil
		}
		if s.AssistantSessions == nil {
			return nil
		}
		session := assistantSessionByID(s, s.AssistantSessions.CurrentID)
		if session == nil || len(session.Messages) == 0 || session.Messages[len(session.Messages)-1].Role == "user" {
			return nil
		}
		return session.Messages
	}
	for {
		if messages := idle(w.Store.Read()); messages != nil {
			return messages
		}
		select {
		case <-changes:
		case <-deadline:
			t.Fatal("对话没有结束")
		}
	}
}

// 超时按设置计时，失败原因带上秒数，界面据此提示去设置里延长。
func TestAITaskTimeout(t *testing.T) {
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			_, _ = w.Write([]byte(`{"data":[{"id":"m"}]}`))
			return
		}
		select {
		case <-release:
		case <-r.Context().Done():
		}
	}))
	defer server.Close()
	defer close(release)
	w := aiWorkbench(t, server)
	_, err := w.AIModels(context.Background(), "")
	must(t, err)
	p := w.Store.Read().Preferences
	p.AITimeout = 1
	if err = w.SavePreferences(p); err == nil {
		t.Fatal("超时低于下限应拒绝")
	}
	p.AITimeout = schema.AITimeoutMin
	must(t, w.SavePreferences(p))
	if aiTimeout(w.Store.Read().Preferences) != time.Duration(schema.AITimeoutMin)*time.Second {
		t.Fatal("应使用设置的超时")
	}
	// 测试里不等 30 秒：直接用很短的超时验证错误转换。
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	_, err = w.complete(ctx, llm.Request{System: "s", Messages: []llm.Message{{Role: "user", Content: "x"}}})
	var ce *msg.CallError
	if !errors.As(err, &ce) || ce.Code != msg.ErrAINetwork && ce.Code != msg.ErrAITimeout {
		t.Fatal("超时应返回可读的错误", err)
	}
}

// 取消会中止正在进行的任务，且同一时间只允许一个 AI 任务。
func TestCancelAI(t *testing.T) {
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			_, _ = w.Write([]byte(`{"data":[{"id":"m"}]}`))
			return
		}
		select {
		case <-release:
		case <-r.Context().Done():
		}
	}))
	defer server.Close()
	defer close(release)
	w := aiWorkbench(t, server)
	_, err := w.AIModels(context.Background(), "")
	must(t, err)
	_, err = w.StartCast(CastBrief{Title: "x", Chapters: []CastChapter{{Lines: []CastLine{{Text: "x", Quote: true}}}}})
	must(t, err)
	var ce *msg.CallError
	if _, err = w.StartCast(CastBrief{Title: "x", Chapters: []CastChapter{{Lines: []CastLine{{Text: "x", Quote: true}}}}}); !errors.As(err, &ce) || ce.Code != msg.ErrBusy {
		t.Fatal("并发请求应返回 busy", err)
	}
	w.CancelAI()
	if task := waitAI(t, w); task.Status != "cancelled" {
		t.Fatal("取消后任务应为 cancelled", task)
	}
	if _, err = w.StartCast(CastBrief{Title: "x", Chapters: []CastChapter{{Lines: []CastLine{{Text: "x", Quote: true}}}}}); err != nil {
		t.Fatal("结束后应能再次开始", err)
	}
}

// Codex 订阅没有地址和密钥：忽略界面传来的地址与协议，拒绝填写密钥；未选模型时也能发起任务（使用 CLI 默认模型）。
func TestCodexProviderSaves(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	key := "sk-should-not-be-here"
	if _, err = w.SaveAIProvider(AIProviderInput{Preset: "codex", Key: &key}); err == nil {
		t.Fatal("Codex 订阅不接受密钥")
	}
	p, err := w.SaveAIProvider(AIProviderInput{Preset: "codex", BaseURL: "http://evil.test", Format: "chat_completions"})
	must(t, err)
	if p.Format != llm.FormatCodex || p.BaseURL != "" || p.Model != "" || p.Name != "ChatGPT (Codex)" {
		t.Fatalf("Codex 服务: %+v", p)
	}
	_, c, err := w.aiConfig(p.ID)
	must(t, err)
	if c.Format != llm.FormatCodex || c.Key != "" {
		t.Fatalf("调用配置: %+v", c)
	}
}

// Moonshot（Kimi）要求每个 items 都是对象 Schema；update_work 的音符项不能退化成 items: true。
func TestUpdateWorkSchemaItemsAreObjects(t *testing.T) {
	s, err := updateWorkInputSchema()
	if err != nil {
		t.Fatal(err)
	}
	b, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	var doc any
	if err = json.Unmarshal(b, &doc); err != nil {
		t.Fatal(err)
	}
	var walk func(n any, path string)
	walk = func(n any, path string) {
		switch v := n.(type) {
		case map[string]any:
			if items, ok := v["items"]; ok {
				if m, isMap := items.(map[string]any); !isMap || len(m) == 0 {
					t.Errorf("%s.items 必须是非空对象，实际 %v", path, items)
				}
			}
			for k, c := range v {
				walk(c, path+"."+k)
			}
		case []any:
			for i, c := range v {
				walk(c, fmt.Sprintf("%s[%d]", path, i))
			}
		}
	}
	walk(doc, "")
}
