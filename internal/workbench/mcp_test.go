package workbench

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

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// 使用真实 MCP 客户端验证协议协商、工具发现、上传、推理及认证下载。
func TestMCPRemoteWorkflow(t *testing.T) {
	wb, err := New(t.TempDir())
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
	if len(tools.Tools) != 5 {
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
	var voice Voice
	must(t, json.Unmarshal(b, &voice))
	executable, err := os.Executable()
	must(t, err)
	model := filepath.Join(wb.Store.Root, "models", "fake.gguf")
	must(t, os.WriteFile(model, []byte("test"), 0600))
	must(t, wb.Store.Update(func(s *State) {
		s.Models = []InstalledModel{{ID: "index-2.5-q8", Path: model}}
		s.RuntimePath = &executable
		s.RuntimeBackend = ptr("cpu")
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
