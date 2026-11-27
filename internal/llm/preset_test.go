package llm

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

// roundTrip 记录每个请求并按 reply 回复，不访问网络。
type roundTrip func(*http.Request) *http.Response

func (f roundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r), nil }

func reply(r *http.Request, status int, header http.Header, body string) *http.Response {
	if header == nil {
		header = http.Header{}
	}
	return &http.Response{StatusCode: status, Header: header, Body: io.NopCloser(strings.NewReader(body)), Request: r}
}

// AI/ML API 预设：模型列表只取 Chat Completions 模型，密钥只发往 api.aimlapi.com，重定向到其他主机时不带密钥。
func TestAIMLAPIPreset(t *testing.T) {
	p, ok := LookupPreset("aimlapi")
	if !ok {
		t.Fatal("缺少 aimlapi 预设")
	}
	if p.Format != FormatChat || p.Endpoint != "fixed" || p.BaseURL != "https://api.aimlapi.com/v1" {
		t.Fatalf("aimlapi 预设配置错误：%+v", p)
	}
	type seen struct{ url, auth string }
	var calls []seen
	client := &http.Client{Transport: roundTrip(func(r *http.Request) *http.Response {
		calls = append(calls, seen{r.URL.String(), r.Header.Get("Authorization")})
		if r.URL.Host == "api.aimlapi.com" && r.URL.Path == "/v1/chat/completions" {
			return reply(r, http.StatusTemporaryRedirect, http.Header{"Location": {"https://evil.example/v1/chat/completions"}}, "")
		}
		if r.URL.Host == "api.aimlapi.com" {
			return reply(r, http.StatusOK, nil, `{"data":[{"id":"openai/gpt-4o-mini","type":"openai/chat-completions"}]}`)
		}
		return reply(r, http.StatusOK, nil, `{"choices":[{"message":{"content":"x"},"finish_reason":"stop"}]}`)
	})}
	c := Config{Format: p.Format, BaseURL: p.BaseURL, ModelsPath: p.ModelsPath, Key: "sk-test-key-1234567", Model: "openai/gpt-4o-mini"}
	ids, e := Models(context.Background(), client, c)
	if e != nil || len(ids) != 1 || ids[0] != "openai/gpt-4o-mini" {
		t.Fatalf("模型列表 %v, %v", ids, e)
	}
	if calls[0].url != "https://api.aimlapi.com/v1/models?type=openai/chat-completions" || calls[0].auth != "Bearer sk-test-key-1234567" {
		t.Fatalf("模型列表请求不对：%+v", calls[0])
	}
	calls = nil
	_, _ = Complete(context.Background(), client, c, Request{Messages: []Message{{Role: "user", Content: "hi"}}})
	if len(calls) != 2 || calls[0].url != "https://api.aimlapi.com/v1/chat/completions" || calls[0].auth == "" {
		t.Fatalf("对话请求不对：%+v", calls)
	}
	if !strings.HasPrefix(calls[1].url, "https://evil.example/") || calls[1].auth != "" {
		t.Fatalf("重定向到其他主机时带上了密钥：%+v", calls[1])
	}
}
