package workbench

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"slices"
	"strings"
	"sync"
	"time"
	"yovoice/internal/assistant"
	"yovoice/internal/diag"
	"yovoice/internal/download"
	"yovoice/internal/llm"
	"yovoice/internal/msg"
	"yovoice/internal/platform"
	"yovoice/internal/schema"
)

// AI 服务为可选功能：配置写入状态（不含密钥），密钥存于状态库的私有设置，不随状态广播；
// 调用不占用下载、推理所用的后台操作，同一时间只运行一个 AI 请求，可单独取消。

// AIProviderInput 是界面提交的服务配置；Key 为 nil 时保留原密钥，空串表示清除。
type AIProviderInput struct {
	ID         string  `json:"id"`
	Preset     string  `json:"preset"`
	Name       string  `json:"name"`
	Format     string  `json:"format"`
	BaseURL    string  `json:"baseURL"`
	ModelsPath string  `json:"modelsPath"`
	Model      string  `json:"model"`
	Key        *string `json:"key"`
}

type aiState struct {
	mu      sync.Mutex
	cancel  context.CancelFunc
	task    string
	done    chan struct{}
	secrets sync.Mutex
	// connect 是进行中的 OrcaRouter 一键授权。
	connect *connectSession
	// codexLogin 结束进行中的 `codex login`。
	codexLogin context.CancelFunc
}

// aiKeysPrivate 是状态库私有设置中保存 AI 服务密钥的键，值为服务 ID 到密钥的映射。
const aiKeysPrivate = "aiKeys"

func (w *Workbench) readSecrets() (map[string]string, error) {
	keys := map[string]string{}
	if _, e := w.Store.Private(aiKeysPrivate, &keys); e != nil {
		return nil, e
	}
	return keys, nil
}

// writeSecret 保存或删除（value 为空）一个服务的密钥。
func (w *Workbench) writeSecret(id, value string) error {
	w.ai.secrets.Lock()
	defer w.ai.secrets.Unlock()
	keys, e := w.readSecrets()
	if e != nil {
		return e
	}
	if value == "" {
		delete(keys, id)
	} else {
		keys[id] = value
	}
	return w.Store.SetPrivate(aiKeysPrivate, keys)
}

func validEndpoint(raw string) bool {
	u, e := url.Parse(raw)
	return e == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != "" && u.User == nil
}

// SaveAIProvider 新建或更新服务。固定地址的预设忽略界面传来的地址与协议，本地服务只允许改地址。
func (w *Workbench) SaveAIProvider(in AIProviderInput) (schema.AIProvider, error) {
	w.edit.Lock()
	defer w.edit.Unlock()
	bad := msg.Err(msg.ErrAIProviderInvalid, nil)
	preset, ok := llm.LookupPreset(in.Preset)
	if !ok {
		return schema.AIProvider{}, bad
	}
	p := schema.AIProvider{ID: in.ID, Preset: preset.Key, Name: strings.TrimSpace(in.Name), Format: preset.Format, BaseURL: preset.BaseURL, ModelsPath: preset.ModelsPath, Model: strings.TrimSpace(in.Model)}
	switch preset.Endpoint {
	case "local":
		p.BaseURL = strings.TrimSpace(in.BaseURL)
	case "custom":
		p.BaseURL, p.ModelsPath, p.Format = strings.TrimSpace(in.BaseURL), strings.TrimSpace(in.ModelsPath), in.Format
	}
	if p.Name == "" {
		p.Name = preset.Name
	}
	// Codex 订阅经本机 CLI 调用，没有地址和密钥。
	cli := preset.Endpoint == "cli"
	if cli && in.Key != nil && *in.Key != "" {
		return schema.AIProvider{}, bad
	}
	if !cli && (!slices.Contains(llm.Formats, p.Format) || !validEndpoint(p.BaseURL)) || schema.TextLen(p.Name) > 60 || len(p.Model) > 200 || len(p.ModelsPath) > 500 {
		return schema.AIProvider{}, bad
	}
	if in.Key != nil && len(*in.Key) > 4096 {
		return schema.AIProvider{}, bad
	}
	s := w.Store.Read()
	index := slices.IndexFunc(s.AIProviders, func(x schema.AIProvider) bool { return x.ID == p.ID })
	if p.ID == "" {
		if len(s.AIProviders) >= schema.AIProviderLimit {
			return schema.AIProvider{}, bad
		}
		p.ID = schema.NewID()
	} else if index < 0 {
		return schema.AIProvider{}, bad
	} else {
		old := s.AIProviders[index]
		p.Models, p.KeyMask, p.LastTest = old.Models, old.KeyMask, old.LastTest
		// 地址或协议变了，之前的模型列表和测试结果不再可信。
		if old.BaseURL != p.BaseURL || old.Format != p.Format {
			p.Models, p.LastTest = nil, nil
		}
	}
	if in.Key != nil {
		key := strings.TrimSpace(*in.Key)
		if e := w.writeSecret(p.ID, key); e != nil {
			return schema.AIProvider{}, e
		}
		p.KeyMask, p.LastTest = llm.Mask(key), nil
	}
	e := w.Store.Update(func(s *schema.State) {
		if i := slices.IndexFunc(s.AIProviders, func(x schema.AIProvider) bool { return x.ID == p.ID }); i >= 0 {
			s.AIProviders[i] = p
		} else {
			s.AIProviders = append(s.AIProviders, p)
		}
		if s.AIProviderID == "" {
			s.AIProviderID = p.ID
		}
	}, true)
	if e == nil {
		diag.Log(w.Store.Root, "ai.provider_saved", "provider_id", p.ID, "preset", p.Preset, "format", p.Format)
	}
	return p, e
}

func (w *Workbench) DeleteAIProvider(id string) error {
	w.edit.Lock()
	defer w.edit.Unlock()
	if !slices.ContainsFunc(w.Store.Read().AIProviders, func(x schema.AIProvider) bool { return x.ID == id }) {
		return msg.Err(msg.ErrAIProviderInvalid, nil)
	}
	if e := w.writeSecret(id, ""); e != nil {
		return e
	}
	return w.Store.Update(func(s *schema.State) {
		s.AIProviders = slices.DeleteFunc(s.AIProviders, func(x schema.AIProvider) bool { return x.ID == id })
		if s.AIProviderID == id {
			s.AIProviderID = ""
			if len(s.AIProviders) > 0 {
				s.AIProviderID = s.AIProviders[0].ID
			}
		}
	}, true)
}

// UseAIProvider 设定 AI 功能使用的服务与模型：写作栏可在已配置的服务和模型间切换；
// model 为空时沿用该服务原来的模型，id 为空表示停用 AI 功能。
func (w *Workbench) UseAIProvider(id, model string) error {
	w.edit.Lock()
	defer w.edit.Unlock()
	model = strings.TrimSpace(model)
	if id != "" && !slices.ContainsFunc(w.Store.Read().AIProviders, func(x schema.AIProvider) bool { return x.ID == id }) || len(model) > 200 {
		return msg.Err(msg.ErrAIProviderInvalid, nil)
	}
	return w.Store.Update(func(s *schema.State) {
		s.AIProviderID = id
		if i := slices.IndexFunc(s.AIProviders, func(x schema.AIProvider) bool { return x.ID == id }); i >= 0 && model != "" {
			s.AIProviders[i].Model = model
		}
	}, true)
}

// aiConfig 读取服务配置与密钥；id 为空时使用当前服务。
func (w *Workbench) aiConfig(id string) (schema.AIProvider, llm.Config, error) {
	s := w.Store.Read()
	if id == "" {
		id = s.AIProviderID
	}
	i := slices.IndexFunc(s.AIProviders, func(x schema.AIProvider) bool { return x.ID == id })
	if i < 0 {
		return schema.AIProvider{}, llm.Config{}, msg.Err(msg.ErrAINotConfigured, nil)
	}
	p := s.AIProviders[i]
	w.ai.secrets.Lock()
	keys, e := w.readSecrets()
	w.ai.secrets.Unlock()
	if e != nil {
		return p, llm.Config{}, e
	}
	return p, llm.Config{Format: p.Format, BaseURL: p.BaseURL, ModelsPath: p.ModelsPath, Key: keys[p.ID], Model: p.Model}, nil
}

// updateAIProvider 在网络请求结束后回写结果；服务已被删除时忽略。
func (w *Workbench) updateAIProvider(id string, change func(*schema.AIProvider)) error {
	w.edit.Lock()
	defer w.edit.Unlock()
	return w.Store.Update(func(s *schema.State) {
		if i := slices.IndexFunc(s.AIProviders, func(x schema.AIProvider) bool { return x.ID == id }); i >= 0 {
			change(&s.AIProviders[i])
		}
	}, true)
}

// AIModels 读取服务的模型列表并保存；尚未选择模型时选中第一个。
func (w *Workbench) AIModels(ctx context.Context, id string) ([]string, error) {
	p, c, e := w.aiConfig(id)
	if e != nil {
		return nil, e
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	models, e := llm.Models(ctx, w.client, c)
	if e != nil {
		return nil, e
	}
	models = models[:min(len(models), 500)]
	return models, w.updateAIProvider(p.ID, func(p *schema.AIProvider) {
		p.Models = models
		if p.Model == "" && len(models) > 0 {
			p.Model = models[0]
		}
	})
}

// TestAIProvider 用一次简短对话验证地址、密钥和模型，结果记录在服务上。
func (w *Workbench) TestAIProvider(ctx context.Context, id string) (schema.AITest, error) {
	p, c, e := w.aiConfig(id)
	if e != nil {
		return schema.AITest{}, e
	}
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	_, e = llm.Complete(ctx, w.client, c, llm.Request{System: "Reply with OK.", Messages: []llm.Message{{Role: "user", Content: "ping"}}, MaxTokens: 256})
	if errors.Is(e, context.Canceled) {
		return schema.AITest{}, e
	}
	result := schema.AITest{OK: e == nil, At: time.Now().UTC()}
	var ce *msg.CallError
	if errors.As(e, &ce) {
		result.Code, result.Params = ce.Code, ce.Params
	} else if e != nil {
		result.Code, result.Params = msg.ErrAIResponse, msg.Params{"status": 0, "detail": llm.Sanitize(e.Error(), c.Key)}
	}
	diag.Log(w.Store.Root, "ai.provider_tested", "provider_id", p.ID, "ok", result.OK, "code", result.Code)
	return result, w.updateAIProvider(p.ID, func(p *schema.AIProvider) { p.LastTest = &result })
}

// aiTimeout 返回单次 AI 请求的超时，未设置时用默认值。
func aiTimeout(p schema.Preferences) time.Duration {
	seconds := p.AITimeout
	if seconds < schema.AITimeoutMin || seconds > schema.AITimeoutMax {
		seconds = schema.AITimeoutDefault
	}
	return time.Duration(seconds) * time.Second
}

// complete 用当前服务完成一次 AI 请求，每次请求按设置单独计时；任务级的取消由 startAI 管理。
func (w *Workbench) complete(ctx context.Context, request llm.Request) (llm.Result, error) {
	p, c, e := w.aiConfig("")
	if e != nil {
		return llm.Result{}, e
	}
	if c.Model == "" && c.Format != llm.FormatCodex {
		return llm.Result{}, msg.Err(msg.ErrAINotConfigured, nil)
	}
	timeout := aiTimeout(w.Store.Read().Preferences)
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	host := ""
	if u, e := url.Parse(c.BaseURL); e == nil {
		host = u.Host
	}
	fields := []any{"provider_id", p.ID, "preset", p.Preset, "format", c.Format, "host", host, "model", c.Model, "turns", len(request.Messages), "max_tokens", request.MaxTokens, "timeout_s", int(timeout.Seconds())}
	diag.Log(w.Store.Root, "ai.request", fields...)
	started := time.Now()
	result, e := llm.Complete(ctx, w.client, c, request)
	if e != nil && errors.Is(ctx.Err(), context.DeadlineExceeded) {
		e = msg.Err(msg.ErrAITimeout, msg.Params{"seconds": int(timeout.Seconds())})
	}
	diag.Log(w.Store.Root, "ai.response", append(fields, "elapsed_ms", time.Since(started).Milliseconds(), "chars", len(result.Text), "truncated", result.Truncated, "error", diag.Error(e))...)
	return result, e
}

// providerEnv 把服务配置翻译成 ocho 的模型服务环境变量；密钥只经环境变量传给子进程。
func providerEnv(p schema.AIProvider, c llm.Config) []string {
	var env []string
	set := func(name, value string) { env = append(env, name+"="+value) }
	switch p.Format {
	case llm.FormatAnthropic:
		set("ANTHROPIC_BASE_URL", c.BaseURL)
		if c.Key != "" {
			set("ANTHROPIC_API_KEY", c.Key)
		}
	case llm.FormatResponses:
		set("OCHO_API_PROVIDER", "responses")
		set("OPENAI_BASE_URL", c.BaseURL)
		if c.Key != "" {
			set("OPENAI_API_KEY", c.Key)
		}
	default:
		set("OCHO_API_PROVIDER", "openai")
		set("OPENAI_BASE_URL", c.BaseURL)
		if c.Key != "" {
			set("OPENAI_API_KEY", c.Key)
		}
	}
	return env
}

// proxyEnvNames 是透传给助手子进程的代理环境变量名；小写形式一并透传，匹配常见代理客户端的约定。
var proxyEnvNames = []string{
	"HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy",
}

// proxyEnv 按偏好设置生成助手子进程的代理环境变量：启用时指向配置的地址（本地地址仍直连，
// 与下载代理一致），显式关闭时全部不设，未配置时从宿主环境透传，方便依赖系统代理的用户。
func proxyEnv(p schema.Preferences) []string {
	if p.ProxyEnabled != nil && !*p.ProxyEnabled {
		return nil
	}
	address := strings.TrimSpace(p.ProxyURL)
	if _, err := download.ParseProxy(address); err != nil {
		return nil
	}
	if address == "" {
		var env []string
		for _, name := range proxyEnvNames {
			if value := os.Getenv(name); value != "" {
				env = append(env, name+"="+value)
			}
		}
		return env
	}
	// NO_PROXY 兜住本机服务（如 Ollama）：代理只应接管远程模型请求。
	return []string{"HTTPS_PROXY=" + address, "HTTP_PROXY=" + address, "ALL_PROXY=" + address,
		"NO_PROXY=localhost,127.0.0.1,::1", "no_proxy=localhost,127.0.0.1,::1"}
}

// assistantConfig 由当前服务配置组装某个会话的助手子进程配置；ocho 缺失与服务未配置分别报错。
// 每个会话有独立的 OCHO_CONFIG_DIR（切换会话即重启子进程）；长期偏好由 yovoice 保存并随消息注入。
func (w *Workbench) assistantConfig(sessionID string) (assistant.Config, error) {
	executable, err := platform.OchoExecutable()
	if err != nil {
		return assistant.Config{}, msg.Err(msg.ErrAssistantMissing, nil)
	}
	p, c, err := w.aiConfig("")
	if err != nil {
		return assistant.Config{}, err
	}
	// ChatGPT 订阅经 Codex CLI 调用，没有 ocho 可用的接口地址与密钥。
	if c.Format == llm.FormatCodex {
		return assistant.Config{}, msg.Err(msg.ErrAssistantProvider, nil)
	}
	if c.Model == "" {
		return assistant.Config{}, msg.Err(msg.ErrAINotConfigured, nil)
	}
	// 会话目录预先建好：ocho 首次启动要往里写自己的配置。
	if err = os.MkdirAll(assistantSessionDir(w.Store.Root, sessionID), 0700); err != nil {
		return assistant.Config{}, err
	}
	env := append(providerEnv(p, c), proxyEnv(w.Store.Read().Preferences)...)
	env = append(env, "OCHO_CONFIG_DIR="+assistantSessionDir(w.Store.Root, sessionID))
	return assistant.Config{Executable: executable, Model: c.Model, Env: env}, nil
}

// logAIOutput 记录无法使用的模型输出的形态，便于排查格式问题；不记录输出内容，其中可能有 AI 写的歌词。
func (w *Workbench) logAIOutput(kind, issue, text string) {
	trimmed := strings.TrimSpace(text)
	diag.Log(w.Store.Root, "ai.output_invalid", "kind", kind, "issue", issue, "chars", len(text), "lines", strings.Count(trimmed, "\n")+1,
		"fenced", strings.Contains(text, "```"), "json", json.Valid([]byte(trimmed)))
}

// startAI 在后台运行一次 AI 写作任务并立即返回任务；同一时间只运行一个，CancelAI 可中止。
// 结果或错误写回状态里的 AITask，界面据此提示并取用结果。
func (w *Workbench) startAI(kind, projectID, brief string, work func(context.Context) (any, error)) (schema.AITask, error) {
	p, c, e := w.aiConfig("")
	if e != nil {
		return schema.AITask{}, e
	}
	if c.Model == "" && c.Format != llm.FormatCodex {
		return schema.AITask{}, msg.Err(msg.ErrAINotConfigured, nil)
	}
	task := schema.AITask{Kind: kind, ProjectID: projectID, Brief: brief, Stage: "writing", Provider: p.Name, Model: c.Model}
	return w.runAI(task, p.ID, work)
}

// runAI 写入任务并在后台运行 work；同一时间只运行一个 AI 任务，结束后结果或错误写回状态。
func (w *Workbench) runAI(task schema.AITask, providerID string, work func(context.Context) (any, error)) (schema.AITask, error) {
	w.ai.mu.Lock()
	defer w.ai.mu.Unlock()
	if w.ai.cancel != nil {
		return schema.AITask{}, msg.Err(msg.ErrBusy, nil)
	}
	kind := task.Kind
	task.ID, task.Status, task.StartedAt = schema.NewID(), "running", time.Now().UTC()
	task.Timeout = int(aiTimeout(w.Store.Read().Preferences).Seconds())
	if e := w.Store.Update(func(s *schema.State) { s.AITask = &task }, false); e != nil {
		return schema.AITask{}, e
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	w.ai.cancel, w.ai.task, w.ai.done = cancel, task.ID, done
	diag.Log(w.Store.Root, "ai.task_started", "task_id", task.ID, "kind", kind, "project_id", task.ProjectID, "provider_id", providerID, "model", task.Model, "timeout_s", task.Timeout)
	go func() {
		defer close(done)
		defer cancel()
		var result any
		err := diag.Catch(w.Store.Root, "ai.task", func() (e error) { result, e = work(ctx); return e })
		var raw json.RawMessage
		if err == nil {
			if raw, err = json.Marshal(result); err != nil {
				err = msg.Err(msg.ErrAIResultInvalid, msg.Params{"detail": err.Error()})
			}
		}
		status := "completed"
		if errors.Is(err, context.Canceled) {
			status = "cancelled"
		} else if err != nil {
			status = "failed"
		}
		finished := time.Now().UTC()
		diag.Log(w.Store.Root, "ai.task_finished", "task_id", task.ID, "kind", kind, "status", status, "elapsed_ms", finished.Sub(task.StartedAt).Milliseconds(), "error", diag.Error(err))
		w.ai.mu.Lock()
		defer w.ai.mu.Unlock()
		w.ai.cancel, w.ai.task = nil, ""
		_ = w.Store.Update(func(s *schema.State) {
			if s.AITask == nil || s.AITask.ID != task.ID {
				return
			}
			t := s.AITask
			t.Status, t.FinishedAt, t.Result = status, &finished, raw
			var ce *msg.CallError
			if errors.As(err, &ce) {
				t.ErrorCode, t.ErrorParams = ce.Code, ce.Params
			} else if err != nil && status == "failed" {
				t.ErrorCode, t.ErrorParams = msg.ErrUnknown, msg.Params{"detail": err.Error()}
			}
		}, false)
	}()
	return task, nil
}

// setAIStage 更新正在运行的任务阶段（如修正格式），没有任务时忽略。
func (w *Workbench) setAIStage(stage string) {
	w.ai.mu.Lock()
	id := w.ai.task
	w.ai.mu.Unlock()
	if id == "" {
		return
	}
	_ = w.Store.Update(func(s *schema.State) {
		if s.AITask != nil && s.AITask.ID == id && s.AITask.Status == "running" {
			s.AITask.Stage = stage
		}
	}, false)
}

// setAIProgress 更新分段任务的进度。
func (w *Workbench) setAIProgress(done, total int) {
	w.ai.mu.Lock()
	id := w.ai.task
	w.ai.mu.Unlock()
	if id == "" {
		return
	}
	_ = w.Store.Update(func(s *schema.State) {
		if s.AITask != nil && s.AITask.ID == id && s.AITask.Status == "running" {
			s.AITask.Done, s.AITask.Total = done, total
		}
	}, false)
}

// CancelAI 取消正在进行的 AI 任务。
func (w *Workbench) CancelAI() {
	w.ai.mu.Lock()
	defer w.ai.mu.Unlock()
	if w.ai.cancel != nil {
		diag.Log(w.Store.Root, "ai.task_cancel_requested", "task_id", w.ai.task)
		w.ai.cancel()
	}
}

// stopAI 取消并等待后台 AI 任务结束，服务关闭时调用。
func (w *Workbench) stopAI() {
	w.ai.mu.Lock()
	connect := w.ai.connect
	w.ai.mu.Unlock()
	if connect != nil {
		w.closeConnect(connect)
	}
	w.ai.mu.Lock()
	done := w.ai.done
	if w.ai.codexLogin != nil {
		w.ai.codexLogin()
	}
	if w.ai.cancel != nil {
		w.ai.cancel()
	}
	w.ai.mu.Unlock()
	if done != nil {
		<-done
	}
}

// DismissAI 在界面取用结果或关闭提示后清除已结束的任务。
func (w *Workbench) DismissAI(id string) error {
	return w.Store.Update(func(s *schema.State) {
		if s.AITask != nil && s.AITask.ID == id && s.AITask.Status != "running" {
			s.AITask = nil
		}
	}, false)
}
