package workbench

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
)

// 服务配置写入状态但密钥只在 secrets.json；清除与删除同步移除密钥。
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
	state, err := os.ReadFile(filepath.Join(w.Store.Root, "state.json"))
	must(t, err)
	if strings.Contains(string(state), key) {
		t.Fatal("密钥不应写入 state.json")
	}
	info, err := os.Stat(filepath.Join(w.Store.Root, "secrets.json"))
	must(t, err)
	if info.Mode().Perm()&0077 != 0 && os.PathSeparator == '/' {
		t.Fatal("secrets.json 权限应为 0600", info.Mode())
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
	must(t, w.DeleteAIProvider(p.ID))
	keys, err := w.readSecrets()
	must(t, err)
	if _, ok := keys[p.ID]; ok || w.Store.Read().AIProviderID != local.ID {
		t.Fatal("删除服务应移除密钥并切换当前服务")
	}
}

// fakeLLM 依次返回给定的回复，记录收到的请求。
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

// AI 写谱：接受紧凑数组音符；首次结果不合规时把问题发回，第二次合规即返回。
func TestComposeScoreRepairsOnce(t *testing.T) {
	bad := `{"tempo":100,"timeSignature":[4,4],"tracks":[{"id":"p","name":"钢琴","role":"piano","program":0,"notes":[[1,5,60,1,80]]}]}`
	good := "好的：\n```json\n" + `{"tempo":100,"timeSignature":[4,4],"key":"C 大调","sections":[{"name":"主歌","start":1,"end":2}],"tracks":[{"id":"p","name":"钢琴","role":"piano","program":0,"notes":[[1,1,60,1,80],[2,1.5,64,0.5,70]]},{"id":"d","name":"鼓","role":"drums","program":0,"drums":true,"notes":[{"bar":1,"beat":1,"pitch":36,"length":0.25,"velocity":100}]}]}` + "\n```"
	server, requests := fakeLLM(t, bad, good)
	w := aiWorkbench(t, server)
	_, err := w.AIModels(context.Background(), "")
	must(t, err)
	s, err := w.ComposeScore(context.Background(), ScoreBrief{Brief: "温暖的钢琴小品", Seconds: 10, Locale: schema.UiLocaleZhCN})
	must(t, err)
	if len(s.Tracks) != 2 || s.Tracks[0].Notes[1].Beat != 1.5 || !s.Tracks[1].Drums {
		t.Fatalf("乐谱解析不对：%+v", s)
	}
	if len(*requests) != 2 {
		t.Fatal("应修复一次", len(*requests))
	}
	last := (*requests)[1]["messages"].([]any)
	fix := last[len(last)-1].(map[string]any)["content"].(string)
	if !strings.Contains(fix, "beat 5") || !strings.Contains((*requests)[0]["messages"].([]any)[0].(map[string]any)["content"].(string), "Simplified Chinese") {
		t.Fatal("修复请求应带上具体问题", fix)
	}

	server, _ = fakeLLM(t, "不是 JSON")
	w = aiWorkbench(t, server)
	_, err = w.AIModels(context.Background(), "")
	must(t, err)
	var ce *msg.CallError
	if _, err = w.ComposeScore(context.Background(), ScoreBrief{Brief: "x"}); !errors.As(err, &ce) || ce.Code != msg.ErrAIResultInvalid {
		t.Fatal("两次都不合规应返回 aiResultInvalid", err)
	}
}

func TestWriteLyricsAndNotConfigured(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	var ce *msg.CallError
	if _, err = w.WriteLyrics(context.Background(), LyricsBrief{Brief: "夏天"}); !errors.As(err, &ce) || ce.Code != msg.ErrAINotConfigured {
		t.Fatal("未配置服务时应返回 aiNotConfigured", err)
	}
	server, _ := fakeLLM(t, `{"title":"夏夜","style":"city pop, warm synths","lyrics":"[verse]\n晚风吹过","language":"xx"}`)
	w = aiWorkbench(t, server)
	_, err = w.AIModels(context.Background(), "")
	must(t, err)
	l, err := w.WriteLyrics(context.Background(), LyricsBrief{Brief: "夏天的晚风", Language: "zh"})
	must(t, err)
	if l.Title != "夏夜" || l.Style != "city pop, warm synths" || !strings.HasPrefix(l.Lyrics, "[verse]") || l.Language != "" {
		t.Fatalf("%+v", l)
	}
}

// 取消会中止正在进行的请求，且同一时间只允许一个 AI 请求。
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
	done := make(chan error, 1)
	go func() { _, e := w.WriteLyrics(context.Background(), LyricsBrief{Brief: "x"}); done <- e }()
	for {
		w.ai.mu.Lock()
		running := w.ai.cancel != nil
		w.ai.mu.Unlock()
		if running {
			break
		}
		select {
		case e := <-done:
			t.Fatal("请求提前结束", e)
		default:
		}
	}
	var ce *msg.CallError
	if _, err = w.WriteLyrics(context.Background(), LyricsBrief{Brief: "y"}); !errors.As(err, &ce) || ce.Code != msg.ErrBusy {
		t.Fatal("并发请求应返回 busy", err)
	}
	w.CancelAI()
	if e := <-done; !errors.Is(e, context.Canceled) {
		t.Fatal("取消后应返回 context.Canceled", e)
	}
}
