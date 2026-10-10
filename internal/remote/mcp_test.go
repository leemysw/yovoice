package remote

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"yovoice/internal/catalog"
	"yovoice/internal/schema"
	"yovoice/internal/testkit"
	"yovoice/internal/workbench"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// 使用真实 MCP 客户端验证协议协商、工具发现、上传、推理及认证下载。
func TestMCPRemoteWorkflow(t *testing.T) {
	wb, err := workbench.New(t.TempDir())
	must(t, err)
	defer wb.Close()
	token := strings.Repeat("m", 32)
	api := &API{Workbench: wb, Token: token}
	server := httptest.NewServer(api)
	defer server.Close()
	denied, err := http.Post(server.URL+"/mcp", "application/json", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"initialize"}`))
	must(t, err)
	denied.Body.Close()
	if denied.StatusCode != 401 {
		t.Fatal(denied.StatusCode)
	}
	client := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "1"}, nil)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	httpClient := &http.Client{Transport: tokenTransport{token: token}}
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: server.URL + "/mcp", HTTPClient: httpClient, DisableStandaloneSSE: true}, nil)
	must(t, err)
	defer session.Close()
	tools, err := session.ListTools(ctx, nil)
	must(t, err)
	if len(tools.Tools) != 9 {
		t.Fatal(len(tools.Tools))
	}
	call := func(name string, args any) *mcp.CallToolResult {
		t.Helper()
		result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: name, Arguments: args})
		must(t, err)
		if result.IsError {
			t.Fatalf("%s: %+v", name, result.Content)
		}
		return result
	}
	for _, name := range []string{"status", "list_models", "list_voices"} {
		call(name, map[string]any{})
	}
	uploaded := call("upload_voice", map[string]any{"audio": base64.StdEncoding.EncodeToString(wav()), "name": "MCP 音色"})
	b, err := json.Marshal(uploaded.StructuredContent)
	must(t, err)
	var voice schema.Voice
	must(t, json.Unmarshal(b, &voice))
	executable, err := os.Executable()
	must(t, err)
	model := filepath.Join(wb.Store.Root, "models", "fake.gguf")
	must(t, os.WriteFile(model, []byte("test"), 0600))
	must(t, wb.Store.Update(func(s *schema.State) {
		s.Models = []schema.InstalledModel{{ID: "index-2.5-q8", Path: model}}
		s.RuntimePath = &executable
		s.RuntimeBackend = ptr("cpu")
		s.RuntimeVersion = ptr(catalog.EngineVersion)
		s.Preferences.Backend = "cpu"
	}, true))
	generated := call("generate", map[string]any{"text": "通过 MCP 生成", "settings": map[string]any{"voiceId": voice.ID}})
	b, err = json.Marshal(generated.StructuredContent)
	must(t, err)
	var output struct {
		DownloadPath string `json:"downloadPath"`
	}
	must(t, json.Unmarshal(b, &output))
	response, err := httpClient.Get(server.URL + output.DownloadPath)
	must(t, err)
	audio, err := io.ReadAll(response.Body)
	response.Body.Close()
	must(t, err)
	if response.StatusCode != 200 || !bytes.Equal(audio, wav()) {
		t.Fatal("音频下载不正确", response.StatusCode)
	}
	response, err = http.Get(server.URL + output.DownloadPath)
	must(t, err)
	response.Body.Close()
	if response.StatusCode != 401 {
		t.Fatal("音频绕过认证")
	}

	// Agent 通过 render_score 提交乐谱，渲染结果与语音一样经认证下载。
	font := filepath.Join(wb.Store.Root, "models", "test.sf2")
	must(t, os.WriteFile(font, testkit.SoundFont(), 0600))
	must(t, wb.Store.Update(func(s *schema.State) {
		s.Models = append(s.Models, schema.InstalledModel{ID: "musescore-general-sf2", Path: font})
	}, true))
	rendered := call("render_score", map[string]any{"title": "片头", "score": map[string]any{"tempo": 120, "timeSignature": []int{4, 4}, "tracks": []any{
		map[string]any{"id": "piano", "name": "钢琴", "role": "piano", "program": 0, "notes": []any{map[string]any{"bar": 1, "beat": 1, "pitch": 60, "length": 4, "velocity": 90}}},
	}}})
	b, err = json.Marshal(rendered.StructuredContent)
	must(t, err)
	var score struct {
		Duration     float64 `json:"duration"`
		DownloadPath string  `json:"downloadPath"`
	}
	must(t, json.Unmarshal(b, &score))
	response, err = httpClient.Get(server.URL + score.DownloadPath)
	must(t, err)
	response.Body.Close()
	if response.StatusCode != 200 || score.Duration < 3.9 || score.Duration > 4.1 {
		t.Fatal(response.StatusCode, score.Duration)
	}

	// 两代协议均使用短请求提交和轮询，任务不依赖 MCP 会话存活。
	for _, protocol := range []string{"2025-03-26", "2026-07-28"} {
		id := schema.NewID()
		rawCall := func(name string, args any) *mcp.CallToolResult {
			t.Helper()
			data, err := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": map[string]any{"name": name, "arguments": args, "_meta": map[string]any{"io.modelcontextprotocol/protocolVersion": protocol, "io.modelcontextprotocol/clientCapabilities": map[string]any{}, "io.modelcontextprotocol/clientInfo": map[string]any{"name": "test", "version": "1"}}}})
			must(t, err)
			requestCtx, disconnect := context.WithCancel(ctx)
			defer disconnect()
			req, err := http.NewRequestWithContext(requestCtx, "POST", server.URL+"/mcp", bytes.NewReader(data))
			must(t, err)
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Accept", "application/json, text/event-stream")
			req.Header.Set("MCP-Protocol-Version", protocol)
			req.Header.Set("Mcp-Method", "tools/call")
			req.Header.Set("Mcp-Name", name)
			res, err := httpClient.Do(req)
			must(t, err)
			defer res.Body.Close()
			var envelope struct {
				Result *mcp.CallToolResult
				Error  any
			}
			must(t, json.NewDecoder(res.Body).Decode(&envelope))
			if envelope.Result == nil || envelope.Result.IsError {
				t.Fatalf("%s: %+v", protocol, envelope)
			}
			return envelope.Result
		}
		args := map[string]any{"requestId": id, "text": "等待取消", "settings": map[string]any{"voiceId": voice.ID}}
		rawCall("submit_generation", args)
		rawCall("submit_generation", args)
		rawCall("cancel_generation", map[string]any{"requestId": id})
		deadline := time.Now().Add(5 * time.Second)
		for {
			result := rawCall("get_generation", map[string]any{"requestId": id})
			data, err := json.Marshal(result.StructuredContent)
			must(t, err)
			var job GenerationJob
			must(t, json.Unmarshal(data, &job))
			if job.Status == "cancelled" {
				break
			}
			if time.Now().After(deadline) {
				t.Fatalf("任务取消未完成: %+v", job)
			}
			time.Sleep(10 * time.Millisecond)
		}
	}
	// 两种协议共用同一把锁，不能绕过 HTTP 的并发限制。
	api.busy.Lock()
	result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "generate", Arguments: map[string]any{"text": "busy"}})
	api.busy.Unlock()
	must(t, err)
	if !result.IsError {
		t.Fatal("繁忙调用未拒绝")
	}
	result, err = session.CallTool(ctx, &mcp.CallToolParams{Name: "generate", Arguments: map[string]any{"text": "invalid", "settings": map[string]any{"path": "/etc/passwd"}}})
	must(t, err)
	if !result.IsError {
		t.Fatal("未知路径参数未拒绝")
	}
}

type tokenTransport struct{ token string }

func (t tokenTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	r = r.Clone(r.Context())
	r.Header.Set("Authorization", "Bearer "+t.token)
	return http.DefaultTransport.RoundTrip(r)
}
