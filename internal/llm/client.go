package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"yovoice/internal/msg"
)

const maxBody = 4 << 20

// Config 是一次调用所需的服务配置。
type Config struct {
	Format     string
	BaseURL    string
	ModelsPath string
	Key        string
	Model      string
}

// Request 是单轮对话：系统提示与用户输入，可附带此前的回复和修正要求做一轮修复。
type Request struct {
	System      string
	Messages    []Message
	MaxTokens   int
	Temperature float64
}

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// Result 是模型输出；Truncated 表示因输出长度上限被截断。
type Result struct {
	Text      string
	Truncated bool
}

// Join 拼接服务地址与接口路径：路径为绝对 URL 时直接使用，已是地址后缀时不重复追加。
func Join(base, path string) string {
	base = strings.TrimRight(strings.TrimSpace(base), "/")
	path = strings.TrimSpace(path)
	if path == "" {
		return base
	}
	if u, e := url.Parse(path); e == nil && u.IsAbs() {
		return u.String()
	}
	path = "/" + strings.TrimLeft(path, "/")
	if strings.HasSuffix(base, path) {
		return base
	}
	return base + path
}

func endpoint(c Config) string {
	switch c.Format {
	case FormatResponses:
		return Join(c.BaseURL, "/responses")
	case FormatAnthropic:
		if strings.HasSuffix(strings.TrimRight(c.BaseURL, "/"), "/v1") {
			return Join(c.BaseURL, "/messages")
		}
		return Join(c.BaseURL, "/v1/messages")
	}
	return Join(c.BaseURL, "/chat/completions")
}

func azure(base string) bool {
	u, e := url.Parse(base)
	if e != nil {
		return false
	}
	host := strings.ToLower(u.Hostname())
	return strings.HasSuffix(host, ".openai.azure.com") || strings.HasSuffix(host, ".cognitiveservices.azure.com") || strings.HasSuffix(host, ".services.ai.azure.com")
}

// headers 与 nexus 的 applyProviderHeaders 一致：Bearer 通用，Azure 另加 api-key，Anthropic 协议用 x-api-key 与版本头。
func headers(r *http.Request, c Config) {
	key := strings.TrimSpace(c.Key)
	if key != "" {
		r.Header.Set("Authorization", "Bearer "+key)
		if azure(c.BaseURL) {
			r.Header.Set("api-key", key)
		}
	}
	if c.Format == FormatAnthropic {
		if key != "" {
			r.Header.Set("x-api-key", key)
		}
		r.Header.Set("anthropic-version", "2023-06-01")
	}
	r.Header.Set("Accept", "application/json")
}

func payload(c Config, r Request) map[string]any {
	maxTokens := r.MaxTokens
	if maxTokens <= 0 {
		maxTokens = 1024
	}
	switch c.Format {
	case FormatAnthropic:
		return map[string]any{"model": c.Model, "max_tokens": maxTokens, "temperature": r.Temperature, "system": r.System, "messages": r.Messages}
	case FormatResponses:
		return map[string]any{"model": c.Model, "instructions": r.System, "input": r.Messages, "max_output_tokens": maxTokens, "temperature": r.Temperature, "store": false}
	}
	messages := append([]Message{{Role: "system", Content: r.System}}, r.Messages...)
	body := map[string]any{"model": c.Model, "messages": messages, "temperature": r.Temperature, "stream": false}
	// Azure 与新版 OpenAI 推理模型只接受 max_completion_tokens。
	if azure(c.BaseURL) || strings.Contains(c.BaseURL, "api.openai.com") {
		body["max_completion_tokens"] = maxTokens
	} else {
		body["max_tokens"] = maxTokens
	}
	return body
}

// Complete 发送一次非流式请求并取回文本。推理模型输出的 <think> 段会被去掉。
func Complete(ctx context.Context, client *http.Client, c Config, r Request) (Result, error) {
	if strings.TrimSpace(c.Model) == "" || len(r.Messages) == 0 {
		return Result{}, msg.Err(msg.ErrAINotConfigured, nil)
	}
	raw, e := json.Marshal(payload(c, r))
	if e != nil {
		return Result{}, e
	}
	body, e := send(ctx, client, c, http.MethodPost, endpoint(c), raw)
	if e != nil {
		return Result{}, e
	}
	result, e := parse(c.Format, body)
	if e != nil {
		return Result{}, msg.Err(msg.ErrAIResponse, msg.Params{"status": 200, "detail": Sanitize(string(body), c.Key)})
	}
	result.Text = strings.TrimSpace(thinking.ReplaceAllString(result.Text, ""))
	if result.Text == "" && !result.Truncated {
		return Result{}, msg.Err(msg.ErrAIResponse, msg.Params{"status": 200, "detail": "empty output"})
	}
	return result, nil
}

var thinking = regexp.MustCompile(`(?s)<think>.*?</think>`)

func parse(format string, body []byte) (Result, error) {
	switch format {
	case FormatAnthropic:
		var v struct {
			Content []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
			StopReason string `json:"stop_reason"`
		}
		if e := json.Unmarshal(body, &v); e != nil {
			return Result{}, e
		}
		var b strings.Builder
		for _, c := range v.Content {
			if c.Type == "text" {
				b.WriteString(c.Text)
			}
		}
		return Result{Text: b.String(), Truncated: v.StopReason == "max_tokens"}, nil
	case FormatResponses:
		var v struct {
			Status     string `json:"status"`
			OutputText string `json:"output_text"`
			Output     []struct {
				Content []struct {
					Type string `json:"type"`
					Text string `json:"text"`
				} `json:"content"`
			} `json:"output"`
		}
		if e := json.Unmarshal(body, &v); e != nil {
			return Result{}, e
		}
		text := v.OutputText
		if text == "" {
			var b strings.Builder
			for _, o := range v.Output {
				for _, c := range o.Content {
					if c.Type == "output_text" || c.Type == "text" {
						b.WriteString(c.Text)
					}
				}
			}
			text = b.String()
		}
		return Result{Text: text, Truncated: v.Status == "incomplete"}, nil
	}
	var v struct {
		Choices []struct {
			Message struct {
				Content json.RawMessage `json:"content"`
			} `json:"message"`
			Text         string `json:"text"`
			FinishReason string `json:"finish_reason"`
		} `json:"choices"`
	}
	if e := json.Unmarshal(body, &v); e != nil {
		return Result{}, e
	}
	if len(v.Choices) == 0 {
		return Result{}, errors.New("no choices")
	}
	choice := v.Choices[0]
	text := choice.Text
	// content 通常是字符串，部分兼容服务返回内容片段数组。
	var s string
	var parts []struct {
		Text string `json:"text"`
	}
	if json.Unmarshal(choice.Message.Content, &s) == nil {
		text = s
	} else if json.Unmarshal(choice.Message.Content, &parts) == nil {
		var b strings.Builder
		for _, p := range parts {
			b.WriteString(p.Text)
		}
		text = b.String()
	}
	return Result{Text: text, Truncated: choice.FinishReason == "length"}, nil
}

// Models 读取服务的模型列表（OpenAI 与 Anthropic 都返回 {data:[{id}]}）。
func Models(ctx context.Context, client *http.Client, c Config) ([]string, error) {
	if strings.TrimSpace(c.ModelsPath) == "" {
		return nil, msg.Err(msg.ErrAIModelsPath, nil)
	}
	body, e := send(ctx, client, c, http.MethodGet, Join(c.BaseURL, c.ModelsPath), nil)
	if e != nil {
		return nil, e
	}
	var v struct {
		Data []struct {
			ID    string `json:"id"`
			Model string `json:"model"`
			Name  string `json:"name"`
		} `json:"data"`
		Models []struct {
			ID    string `json:"id"`
			Model string `json:"model"`
			Name  string `json:"name"`
		} `json:"models"`
	}
	if e = json.Unmarshal(body, &v); e != nil {
		return nil, msg.Err(msg.ErrAIResponse, msg.Params{"status": 200, "detail": Sanitize(string(body), c.Key)})
	}
	var ids []string
	for _, m := range append(v.Data, v.Models...) {
		id := strings.TrimSpace(m.ID)
		if id == "" {
			id = strings.TrimSpace(m.Model)
		}
		if id == "" {
			id = strings.TrimSpace(m.Name)
		}
		if id != "" && !slices.Contains(ids, id) {
			ids = append(ids, id)
		}
	}
	slices.Sort(ids)
	return ids, nil
}

func send(ctx context.Context, client *http.Client, c Config, method, target string, raw []byte) ([]byte, error) {
	u, e := url.Parse(target)
	if e != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil, msg.Err(msg.ErrAIProviderInvalid, nil)
	}
	var reader io.Reader
	if raw != nil {
		reader = bytes.NewReader(raw)
	}
	req, e := http.NewRequestWithContext(ctx, method, target, reader)
	if e != nil {
		return nil, msg.Err(msg.ErrAIProviderInvalid, nil)
	}
	headers(req, c)
	if raw != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, e := client.Do(req)
	if e != nil {
		if errors.Is(e, context.Canceled) {
			return nil, context.Canceled
		}
		return nil, msg.Err(msg.ErrAINetwork, msg.Params{"detail": Sanitize(networkDetail(e), c.Key)})
	}
	defer res.Body.Close()
	body, e := io.ReadAll(io.LimitReader(res.Body, maxBody+1))
	if e != nil {
		if errors.Is(e, context.Canceled) {
			return nil, context.Canceled
		}
		return nil, msg.Err(msg.ErrAINetwork, msg.Params{"detail": Sanitize(networkDetail(e), c.Key)})
	}
	if len(body) > maxBody {
		return nil, msg.Err(msg.ErrAIResponse, msg.Params{"status": res.StatusCode, "detail": "response too large"})
	}
	switch {
	case res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden:
		return nil, msg.Err(msg.ErrAIAuth, msg.Params{"status": res.StatusCode})
	case res.StatusCode == http.StatusTooManyRequests:
		return nil, msg.Err(msg.ErrAIRateLimit, nil)
	case res.StatusCode < 200 || res.StatusCode > 299:
		return nil, msg.Err(msg.ErrAIResponse, msg.Params{"status": res.StatusCode, "detail": errorDetail(body, c.Key)})
	}
	return body, nil
}

func networkDetail(e error) string {
	var ne net.Error
	if errors.As(e, &ne) && ne.Timeout() {
		return "timeout"
	}
	var ue *url.Error
	if errors.As(e, &ue) {
		return ue.Err.Error()
	}
	return e.Error()
}

// errorDetail 优先取服务返回的 error.message，否则截取正文。
func errorDetail(body []byte, key string) string {
	var v struct {
		Error json.RawMessage `json:"error"`
	}
	if json.Unmarshal(body, &v) == nil && len(v.Error) > 0 {
		var e struct {
			Message string `json:"message"`
		}
		var s string
		if json.Unmarshal(v.Error, &e) == nil && e.Message != "" {
			return Sanitize(e.Message, key)
		}
		if json.Unmarshal(v.Error, &s) == nil && s != "" {
			return Sanitize(s, key)
		}
	}
	return Sanitize(string(body), key)
}

var bearer = regexp.MustCompile(`(?i)(bearer\s+)[a-z0-9._\-]+`)

// Sanitize 去掉错误信息中的密钥与鉴权头，并截断到 300 字符。
func Sanitize(text string, secrets ...string) string {
	text = bearer.ReplaceAllString(text, "${1}<redacted>")
	for _, s := range secrets {
		if s = strings.TrimSpace(s); s != "" {
			text = strings.ReplaceAll(text, s, "<redacted>")
		}
	}
	text = strings.TrimSpace(text)
	if r := []rune(text); len(r) > 300 {
		text = string(r[:300]) + "…"
	}
	return text
}

// Mask 只保留密钥首尾，用于界面展示。
func Mask(key string) string {
	r := []rune(strings.TrimSpace(key))
	if len(r) == 0 {
		return ""
	}
	if len(r) <= 10 {
		return strings.Repeat("•", len(r))
	}
	return fmt.Sprintf("%s••••••••%s", string(r[:4]), string(r[len(r)-4:]))
}

// ExtractJSON 取出模型回复中的 JSON 对象：去掉 Markdown 代码块，截取第一个 { 到最后一个 }。
func ExtractJSON(text string) string {
	start, end := strings.Index(text, "{"), strings.LastIndex(text, "}")
	if start < 0 || end < start {
		return ""
	}
	return text[start : end+1]
}
