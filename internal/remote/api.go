// Package remote 提供远程 HTTP API、异步生成任务与 MCP 工具，只开放推理相关能力。
package remote

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
	"yovoice/internal/catalog"
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
	jobsMu            sync.Mutex
	jobs              map[string]*generationJob
	busy              sync.Mutex
	mcpOnce           sync.Once
	mcpHandler        http.Handler
}

func (a *API) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-store")
	if len(a.Token) < 32 || subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+a.Token)) != 1 {
		w.Header().Set("WWW-Authenticate", "Bearer")
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	if r.Header.Get("Origin") != "" {
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
		apiJSON(w, map[string]any{"engineVersion": catalog.EngineVersion, "activity": state.Activity, "ready": state.RuntimePath != nil})
	case r.Method == "GET" && r.URL.Path == "/v1/models":
		apiJSON(w, map[string]any{"catalog": catalog.Models, "installed": a.Workbench.Store.Read().Models, "generationOptions": catalog.GenerationOptions})
	case r.Method == "GET" && r.URL.Path == "/v1/voices":
		apiJSON(w, a.Workbench.Store.Read().Voices)
	case r.Method == "GET" && strings.HasPrefix(r.URL.Path, "/v1/audio/"):
		a.audio(w, r, strings.TrimPrefix(r.URL.Path, "/v1/audio/"))
	case r.Method == "POST" && (r.URL.Path == "/v1/voices" || r.URL.Path == "/v1/generate"):
		// 单个引擎只运行一个请求，繁忙时直接拒绝，不积压无限队列。
		if !a.busy.TryLock() {
			http.Error(w, "推理服务繁忙，请稍后重试", http.StatusConflict)
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

func (a *API) upload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 20<<20)
	voice, err := a.Workbench.ImportVoiceFrom(r.Context(), r.Body, r.URL.Query().Get("name"))
	if err != nil {
		status := http.StatusBadRequest
		var tooLarge *http.MaxBytesError
		var callErr *msg.CallError
		if errors.As(err, &tooLarge) || (errors.As(err, &callErr) && callErr.Code == msg.ErrAudioTooLarge) {
			status = http.StatusRequestEntityTooLarge
		}
		http.Error(w, err.Error(), status)
		return
	}
	apiJSON(w, voice)
}

func (a *API) generate(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	d, err := decodeGeneration(r.Body)
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	g, err := a.generateAudio(r.Context(), d)
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, context.DeadlineExceeded) {
			status = http.StatusGatewayTimeout
		}
		http.Error(w, err.Error(), status)
		return
	}
	a.audio(w, r, g.ID)
}

func decodeGeneration(body io.Reader) (schema.Draft, error) {
	d := schema.DefaultDraft()
	d.Title, d.Text, d.Mode, d.EmotionText = "API 语音", "", "speaker", ""
	input := struct {
		Text string `json:"text"`
		schema.SynthesisSettings
	}{SynthesisSettings: d.SynthesisSettings}
	decoder := json.NewDecoder(body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		return d, err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return d, fmt.Errorf("仅允许一个 JSON 对象")
	}
	d.Text, d.SynthesisSettings = input.Text, input.SynthesisSettings
	if strings.TrimSpace(d.Text) == "" {
		return d, fmt.Errorf("正文不能为空")
	}
	return d, schema.Validate(d)
}

func (a *API) generateAudio(ctx context.Context, d schema.Draft) (schema.Generation, error) {
	ctx, cancel := context.WithTimeout(ctx, a.generationTimeout())
	defer cancel()
	return a.Workbench.Synthesize(ctx, d)
}

func (a *API) audio(w http.ResponseWriter, r *http.Request, id string) {
	path, err := a.Workbench.MediaFile("outputs", id)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "audio/wav")
	w.Header().Set("Content-Disposition", `attachment; filename="`+id+`.wav"`)
	w.Header().Set("X-Yovoice-Generation-ID", id)
	// 隐藏 io.ReaderFrom，避免 Windows sendfile 与连接后台读在 Go 1.26 中的数据竞争。
	http.ServeFile(struct{ http.ResponseWriter }{w}, r, path)
}
