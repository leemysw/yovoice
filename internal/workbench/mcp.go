package workbench

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// newMCPHandler 由官方 SDK 处理协议协商与传输，工具与 HTTP 共用实例和并发限制。
func (a *API) newMCPHandler() http.Handler {
	server := mcp.NewServer(&mcp.Implementation{Name: "yovoice", Version: "1.0.0"}, nil)
	mcp.AddTool(server, &mcp.Tool{Name: "status", Description: "查看推理引擎及当前任务状态"}, func(ctx context.Context, req *mcp.CallToolRequest, in struct{}) (*mcp.CallToolResult, any, error) {
		s := a.Workbench.Store.Read()
		return nil, map[string]any{"engineVersion": EngineVersion, "activity": s.Activity, "ready": s.RuntimePath != nil}, nil
	})
	mcp.AddTool(server, &mcp.Tool{Name: "list_models", Description: "查询模型 ID、安装状态和高级参数定义；生成前选择已安装模型"}, func(ctx context.Context, req *mcp.CallToolRequest, in struct{}) (*mcp.CallToolResult, any, error) {
		return nil, map[string]any{"catalog": Catalog, "installed": a.Workbench.Store.Read().Models, "generationOptions": GenerationOptions}, nil
	})
	mcp.AddTool(server, &mcp.Tool{Name: "list_voices", Description: "列出已上传参考音色及 voiceId"}, func(ctx context.Context, req *mcp.CallToolRequest, in struct{}) (*mcp.CallToolResult, any, error) {
		return nil, map[string]any{"voices": a.Workbench.Store.Read().Voices}, nil
	})
	mcp.AddTool(server, &mcp.Tool{Name: "upload_voice", Description: "上传 Base64 编码的参考音频，限 20 MB、1–60 秒，返回 voiceId。大文件优先通过 HTTP POST /v1/voices 上传"}, func(ctx context.Context, req *mcp.CallToolRequest, in struct {
		Audio string `json:"audio" jsonschema:"参考音频的纯 Base64 字符串，不含 data URL 前缀"`
		Name  string `json:"name,omitempty" jsonschema:"音色名称"`
	}) (*mcp.CallToolResult, any, error) {
		if !a.busy.TryLock() {
			return nil, nil, fmt.Errorf("推理服务繁忙，请稍后重试")
		}
		defer a.busy.Unlock()
		if len(in.Audio) > base64.StdEncoding.EncodedLen(20<<20) {
			return nil, nil, fmt.Errorf("音频超过 20 MB")
		}
		data, err := base64.StdEncoding.DecodeString(in.Audio)
		if err != nil {
			return nil, nil, err
		}
		voice, err := a.uploadVoice(ctx, bytes.NewReader(data), in.Name)
		return nil, voice, err
	})
	mcp.AddTool(server, &mcp.Tool{Name: "generate", Description: "同步生成，长耗时优先使用 submit_generation。完整生成语音，返回 id、duration 和 downloadPath。通过服务端地址加 downloadPath 下载 WAV，HTTP 请求需携带相同 Bearer Token；不返回服务器本地路径"}, func(ctx context.Context, req *mcp.CallToolRequest, in struct {
		Text     string         `json:"text" jsonschema:"需要朗读的正文"`
		Settings map[string]any `json:"settings,omitempty" jsonschema:"声音参数，与 HTTP API 同名，例如 modelId、voiceId、voxMode、voiceDescription、speaker、referenceText、seed、modelOptions"`
	}) (*mcp.CallToolResult, any, error) {
		if !a.busy.TryLock() {
			return nil, nil, fmt.Errorf("推理服务繁忙，请稍后重试")
		}
		defer a.busy.Unlock()
		if in.Settings == nil {
			in.Settings = map[string]any{}
		}
		in.Settings["text"] = in.Text
		data, err := json.Marshal(in.Settings)
		if err != nil {
			return nil, nil, err
		}
		if len(data) > 1<<20 {
			return nil, nil, fmt.Errorf("生成参数超过 1 MB")
		}
		d, err := decodeGeneration(bytes.NewReader(data))
		if err != nil {
			return nil, nil, err
		}
		g, err := a.generateAudio(ctx, d)
		if err != nil {
			return nil, nil, err
		}
		return nil, map[string]any{"id": g.ID, "duration": g.Duration, "downloadPath": "/v1/audio/" + g.ID}, nil
	})
	mcp.AddTool(server, &mcp.Tool{Name: "submit_generation", Description: "提交异步语音生成，立即返回任务状态。requestId 为客户端生成的32位十六进制随机ID；相同ID和参数重试不会重复生成。随后用 get_generation 查询，完成后下载音频。优先使用此工具避免长连接超时"}, func(ctx context.Context, req *mcp.CallToolRequest, in struct {
		RequestID string         `json:"requestId"`
		Text      string         `json:"text"`
		Settings  map[string]any `json:"settings,omitempty"`
	}) (*mcp.CallToolResult, any, error) {
		if in.Settings == nil {
			in.Settings = map[string]any{}
		}
		in.Settings["text"] = in.Text
		data, err := json.Marshal(in.Settings)
		if err != nil {
			return nil, nil, err
		}
		if len(data) > 1<<20 {
			return nil, nil, fmt.Errorf("生成参数超过 1 MB")
		}
		d, err := decodeGeneration(bytes.NewReader(data))
		if err != nil {
			return nil, nil, err
		}
		job, err := a.submitJob(in.RequestID, d)
		return nil, job, err
	})
	for _, name := range []string{"get_generation", "cancel_generation"} {
		mcp.AddTool(server, &mcp.Tool{Name: name, Description: map[string]string{"get_generation": "按 requestId 查询任务；建议每2–5秒查询，completed 后使用 downloadPath 下载", "cancel_generation": "按 requestId 取消任务；取消后查询至终态，终态任务保持不变"}[name]}, func(ctx context.Context, req *mcp.CallToolRequest, in struct {
			RequestID string `json:"requestId"`
		}) (*mcp.CallToolResult, any, error) {
			job, err := a.getJob(in.RequestID, name == "cancel_generation")
			return nil, job, err
		})
	}

	return mcp.NewStreamableHTTPHandler(func(r *http.Request) *mcp.Server { return server }, &mcp.StreamableHTTPOptions{Stateless: true, JSONResponse: true, MaxRequestBodyBytes: 28 << 20, PropagateRequestCancellation: true})
}
