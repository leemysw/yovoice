package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"yovoice/internal/msg"
	"yovoice/internal/testkit"
)

// 预设与界面副本逐字节一致。
func TestPresetsMatchWeb(t *testing.T) {
	web, err := os.ReadFile(testkit.RepoFile(t, "web", "src", "shared", "lib", "ai-presets.json"))
	testkit.Must(t, err)
	if !bytes.Equal(presetsJSON, web) {
		t.Fatal("internal/llm/presets.json 与 web/src/shared/lib/ai-presets.json 不一致")
	}
	for _, p := range Presets {
		if p.Key == "" || p.Name == "" || (p.Endpoint != "custom" && !strings.HasPrefix(p.BaseURL, "http")) {
			t.Errorf("预设 %+v 不完整", p)
		}
	}
}

func TestJoin(t *testing.T) {
	for _, c := range [][3]string{
		{"https://api.openai.com/v1/", "/models", "https://api.openai.com/v1/models"},
		{"https://api.openai.com/v1", "models", "https://api.openai.com/v1/models"},
		{"https://x.test/api/v1/models", "/models", "https://x.test/api/v1/models"},
		{"https://x.test/v1", "https://y.test/list", "https://y.test/list"},
		{"https://x.test/v1", "", "https://x.test/v1"},
	} {
		if got := Join(c[0], c[1]); got != c[2] {
			t.Errorf("Join(%q, %q) = %q, 期望 %q", c[0], c[1], got, c[2])
		}
	}
}

// 三种协议的路径、鉴权头、请求体与回复解析。
func TestCompleteProtocols(t *testing.T) {
	cases := []struct {
		format, path, reply string
		check               func(*http.Request, map[string]any) error
	}{
		{FormatChat, "/v1/chat/completions", `{"choices":[{"message":{"content":"<think>想一想</think>你好"},"finish_reason":"stop"}]}`, func(r *http.Request, body map[string]any) error {
			if r.Header.Get("Authorization") != "Bearer sk-test-key-1234567" || r.Header.Get("x-api-key") != "" {
				return errors.New("chat 鉴权头不对")
			}
			if messages := body["messages"].([]any); len(messages) != 2 || messages[0].(map[string]any)["role"] != "system" || body["max_tokens"] != float64(50) {
				return errors.New("chat 请求体不对")
			}
			return nil
		}},
		{FormatAnthropic, "/v1/messages", `{"content":[{"type":"thinking","thinking":"x"},{"type":"text","text":"你好"}],"stop_reason":"end_turn"}`, func(r *http.Request, body map[string]any) error {
			if r.Header.Get("x-api-key") != "sk-test-key-1234567" || r.Header.Get("anthropic-version") == "" || body["system"] != "sys" {
				return errors.New("anthropic 请求不对")
			}
			return nil
		}},
		{FormatResponses, "/v1/responses", `{"status":"completed","output":[{"content":[{"type":"output_text","text":"你好"}]}]}`, func(r *http.Request, body map[string]any) error {
			if body["instructions"] != "sys" || body["max_output_tokens"] != float64(50) || body["store"] != false {
				return errors.New("responses 请求体不对")
			}
			return nil
		}},
	}
	for _, c := range cases {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var body map[string]any
			raw, _ := io.ReadAll(r.Body)
			_ = json.Unmarshal(raw, &body)
			if r.URL.Path != c.path {
				t.Errorf("%s 路径 %s，期望 %s", c.format, r.URL.Path, c.path)
			}
			if e := c.check(r, body); e != nil {
				t.Error(e)
			}
			_, _ = w.Write([]byte(c.reply))
		}))
		base := server.URL + "/v1"
		if c.format == FormatAnthropic {
			base = server.URL
		}
		result, err := Complete(context.Background(), server.Client(), Config{Format: c.format, BaseURL: base, Key: "sk-test-key-1234567", Model: "m"}, Request{System: "sys", Messages: []Message{{Role: "user", Content: "hi"}}, MaxTokens: 50})
		server.Close()
		if err != nil || result.Text != "你好" || result.Truncated {
			t.Errorf("%s: %+v %v", c.format, result, err)
		}
	}
}

// HTTP 状态映射为界面错误码，错误详情中不出现密钥。
func TestErrorsAreClassifiedAndSanitized(t *testing.T) {
	key := "sk-secret-value-123456"
	for status, code := range map[int]msg.Code{401: msg.ErrAIAuth, 403: msg.ErrAIAuth, 429: msg.ErrAIRateLimit, 400: msg.ErrAIResponse, 500: msg.ErrAIResponse} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(status)
			_, _ = w.Write([]byte(`{"error":{"message":"bad key ` + key + ` Bearer ` + key + `"}}`))
		}))
		_, err := Complete(context.Background(), server.Client(), Config{Format: FormatChat, BaseURL: server.URL, Key: key, Model: "m"}, Request{Messages: []Message{{Role: "user", Content: "hi"}}})
		server.Close()
		var ce *msg.CallError
		if !errors.As(err, &ce) || ce.Code != code {
			t.Errorf("%d: %v", status, err)
			continue
		}
		if raw, _ := json.Marshal(ce.Params); strings.Contains(string(raw), key) {
			t.Errorf("%d 错误详情泄露密钥：%s", status, raw)
		}
	}
	_, err := Complete(context.Background(), http.DefaultClient, Config{Format: FormatChat, BaseURL: "http://127.0.0.1:1", Model: "m"}, Request{Messages: []Message{{Role: "user", Content: "hi"}}})
	var ce *msg.CallError
	if !errors.As(err, &ce) || ce.Code != msg.ErrAINetwork {
		t.Fatal("连接失败应返回 aiNetwork", err)
	}
}

func TestTruncatedAndModels(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			_, _ = w.Write([]byte(`{"data":[{"id":"b"},{"id":"a"},{"id":"a"},{"name":"c"}]}`))
			return
		}
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"x\":"},"finish_reason":"length"}]}`))
	}))
	defer server.Close()
	c := Config{Format: FormatChat, BaseURL: server.URL, ModelsPath: "/models", Model: "m"}
	result, err := Complete(context.Background(), server.Client(), c, Request{Messages: []Message{{Role: "user", Content: "hi"}}})
	if err != nil || !result.Truncated {
		t.Fatal("应标记截断", result, err)
	}
	models, err := Models(context.Background(), server.Client(), c)
	if err != nil || strings.Join(models, ",") != "a,b,c" {
		t.Fatal(models, err)
	}
	c.ModelsPath = ""
	if _, err = Models(context.Background(), server.Client(), c); err == nil {
		t.Fatal("没有模型列表路径时应报错")
	}
}

func TestMaskAndExtract(t *testing.T) {
	if Mask("sk-abcdefghijklmnop") != "sk-a••••••••mnop" || Mask("short") != "•••••" || Mask("") != "" {
		t.Fatal(Mask("sk-abcdefghijklmnop"))
	}
	if ExtractJSON("好的：\n```json\n{\"a\":{\"b\":1}}\n```") != `{"a":{"b":1}}` || ExtractJSON("没有") != "" {
		t.Fatal("ExtractJSON")
	}
}
