// Package remote 提供远程 HTTP API、异步生成任务与 MCP 工具，只开放推理相关能力。
package remote

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
	"yovoice/internal/catalog"
	"yovoice/internal/diag"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
	"yovoice/internal/workbench"
)

// API 为远程客户端提供有限的推理接口，不开放桌面管理与任意路径访问。
type API struct {
	Workbench         *workbench.Workbench
	Token             string
	Context           context.Context
	GenerationTimeout time.Duration
	// Local 表示本机 stdio 模式：结果给出本机 WAV 路径，参考音频可按路径导入。
	Local      bool
	jobsMu     sync.Mutex
	jobs       map[string]*generationJob
	busy       sync.Mutex
	mcpOnce    sync.Once
	mcpHandler http.Handler
}

// statusRecorder 记下响应状态码供请求日志使用；Flush 透传给 MCP 的流式响应。
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	if s.status == 0 {
		s.status = code
	}
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusRecorder) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (s *statusRecorder) Unwrap() http.ResponseWriter { return s.ResponseWriter }

// ServeHTTP 记录写操作和失败的请求；轮询状态的成功 GET 不记，避免刷屏。只记路径，不记查询参数与请求体。
func (a *API) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	started := time.Now()
	recorder := &statusRecorder{ResponseWriter: w}
	a.serve(recorder, r)
	status := recorder.status
	if status == 0 {
		status = http.StatusOK
	}
	if a.Workbench != nil && (r.Method != http.MethodGet || status >= 400) {
		event := "api.request"
		if status >= 500 {
			event = "api.request_failed"
		} else if status >= 400 {
			event = "api.request_rejected"
		}
		diag.Log(a.Workbench.Store.Root, event, "method", r.Method, "path", r.URL.Path, "status", status, "elapsed_ms", time.Since(started).Milliseconds(), "local", a.Local)
	}
}

func (a *API) serve(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-store")
	if serveDocs(w, r) {
		return
	}
	if len(a.Token) < 32 || subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+a.Token)) != 1 {
		w.Header().Set("WWW-Authenticate", "Bearer")
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	if r.Header.Get("Origin") != "" && !sameOrigin(r) {
		http.Error(w, "浏览器跨域调用不受支持", http.StatusForbidden)
		return
	}
	if r.URL.Path == "/mcp" {
		a.mcpOnce.Do(func() { a.mcpHandler = a.newMCPHandler() })
		a.mcpHandler.ServeHTTP(w, r)
		return
	}
	switch {
	case strings.HasPrefix(r.URL.Path, "/v1/jobs/"):
		a.jobHTTP(w, r)
	case r.Method == "GET" && r.URL.Path == "/v1/status":
		state := a.Workbench.Store.Read()
		apiJSON(w, map[string]any{"engineVersion": catalog.EngineVersion, "engineMinimum": catalog.EngineMinimum, "activity": state.Activity, "modelActivity": state.ModelActivity, "runtimeVersion": state.RuntimeVersion, "ready": workbench.RuntimeReady(state)})
	case r.Method == "GET" && r.URL.Path == "/v1/models":
		apiJSON(w, map[string]any{"catalog": catalog.Models, "installed": a.Workbench.Store.Read().Models, "generationOptions": catalog.GenerationOptions})
	case r.Method == "GET" && r.URL.Path == "/v1/voices":
		apiJSON(w, a.Workbench.Store.Read().Voices)
	case r.Method == "GET" && strings.HasPrefix(r.URL.Path, "/v1/audio/"):
		a.audio(w, r, strings.TrimPrefix(r.URL.Path, "/v1/audio/"))
	case r.Method == "POST" && (r.URL.Path == "/v1/voices" || r.URL.Path == "/v1/generate"):
		// 单个引擎只运行一个请求，繁忙时直接拒绝，不积压无限队列。
		if !a.busy.TryLock() {
			apiError(w, errBusy)
			return
		}
		defer a.busy.Unlock()
		if r.URL.Path == "/v1/voices" {
			a.upload(w, r)
		} else {
			a.generate(w, r)
		}
	default:
		http.NotFound(w, r)
	}
}

func apiJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(value)
}

// apiError 统一错误响应：正文为 JSON `{"error": {"code", "params"}}`，状态码由 apiStatus 按错误类型映射。
// 认证、跨域与未知路径的拒绝不经过这里，仍是纯文本。
func apiError(w http.ResponseWriter, err error) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(apiStatus(err))
	_ = json.NewEncoder(w).Encode(map[string]any{"error": msg.Encode(err)})
}

// serverErrors 是服务端或引擎侧的失败，映射为 500；其余结构化错误都是请求参数或引用校验，映射为 400。
var serverErrors = map[msg.Code]bool{
	msg.ErrGenerateFailed: true, msg.ErrEngineCrashed: true, msg.ErrEngineStartFailed: true, msg.ErrEngineStartTimeout: true,
	msg.ErrEngineNoAudio: true, msg.ErrEngineUpgradeRequired: true, msg.ErrRuntimeRequired: true, msg.ErrRuntimeMissing: true,
	msg.ErrStateSaveFailed: true, msg.ErrStateCorrupt: true, msg.ErrDiskFull: true, msg.ErrDataRootMissing: true,
	msg.ErrAudioConverterMissing: true, msg.ErrUnknown: true,
}

// apiStatus 把错误映射为 HTTP 状态码：超时 504、任务或音频不存在 404、繁忙或任务 ID 冲突 409、上传超限 413、
// 服务端失败 500、其余参数或引用错误 400；没有错误码的普通错误视为服务端失败。
func apiStatus(err error) int {
	var tooLarge *http.MaxBytesError
	var callErr *msg.CallError
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		return http.StatusGatewayTimeout
	case errors.Is(err, errJobMissing):
		return http.StatusNotFound
	case errors.Is(err, errJobConflict):
		return http.StatusConflict
	case errors.As(err, &tooLarge):
		return http.StatusRequestEntityTooLarge
	case !errors.As(err, &callErr):
		return http.StatusInternalServerError
	}
	switch callErr.Code {
	case msg.ErrBusy:
		return http.StatusConflict
	case msg.ErrAudioTooLarge:
		return http.StatusRequestEntityTooLarge
	case msg.ErrAudioMissing:
		return http.StatusNotFound
	}
	if serverErrors[callErr.Code] {
		return http.StatusInternalServerError
	}
	return http.StatusBadRequest
}

// requestError 把请求体解析失败归为参数错误并附上原因；校验阶段返回的结构化错误原样保留。
func requestError(err error) error {
	var callErr *msg.CallError
	if errors.As(err, &callErr) {
		return err
	}
	return msg.Err(msg.ErrRequestInvalid, msg.Params{"detail": err.Error()})
}

func (a *API) upload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 20<<20)
	voice, err := a.Workbench.ImportVoiceFrom(r.Context(), r.Body, r.URL.Query().Get("name"))
	if err != nil {
		apiError(w, err)
		return
	}
	apiJSON(w, voice)
}

func (a *API) generate(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	d, err := decodeGeneration(r.Body)
	if err != nil {
		apiError(w, requestError(err))
		return
	}
	g, err := a.generateAudio(r.Context(), d)
	if err != nil {
		apiError(w, err)
		return
	}
	a.audio(w, r, g.ID)
}

// decodeGeneration 解析 HTTP 请求体中的生成参数，规则与 MCP 工具共用（见 workbench.DecodeRemoteGeneration）。
func decodeGeneration(body io.Reader) (schema.Draft, error) {
	return workbench.DecodeRemoteGeneration(body)
}

// errBusy 是单引擎被占用时的统一错误；界面正在生成或下载时 Synthesize 返回同一错误码，HTTP 都映射为 409。
var errBusy = msg.Err(msg.ErrBusy, nil)

func (a *API) generateAudio(ctx context.Context, d schema.Draft) (schema.Generation, error) {
	ctx, cancel := context.WithTimeout(ctx, a.generationTimeout())
	defer cancel()
	return a.Workbench.Synthesize(ctx, d)
}

func (a *API) audio(w http.ResponseWriter, r *http.Request, id string) {
	path, err := a.Workbench.MediaFile("outputs", id)
	if err != nil {
		apiError(w, err)
		return
	}
	w.Header().Set("Content-Type", "audio/wav")
	w.Header().Set("Content-Disposition", `attachment; filename="`+id+`.wav"`)
	w.Header().Set("X-Yovoice-Generation-ID", id)
	// 隐藏 io.ReaderFrom，避免 Windows sendfile 与连接后台读在 Go 1.26 中的数据竞争。
	http.ServeFile(struct{ http.ResponseWriter }{w}, r, path)
}
