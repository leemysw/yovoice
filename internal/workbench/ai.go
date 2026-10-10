package workbench

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"
	"yovoice/internal/diag"
	"yovoice/internal/llm"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
)

// AI 服务为可选功能：配置写入状态（不含密钥），密钥单独存于 secrets.json；
// 调用不占用下载、推理所用的后台操作，同一时间只运行一个 AI 请求，可单独取消。

const aiTimeout = 4 * time.Minute

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
	secrets sync.Mutex
}

func (w *Workbench) secretsPath() string { return filepath.Join(w.Store.Root, "secrets.json") }

func (w *Workbench) readSecrets() (map[string]string, error) {
	keys := map[string]string{}
	b, e := os.ReadFile(w.secretsPath())
	if errors.Is(e, os.ErrNotExist) {
		return keys, nil
	}
	if e != nil {
		return nil, e
	}
	if e = json.Unmarshal(b, &keys); e != nil {
		return nil, msg.Err(msg.ErrStateCorrupt, nil)
	}
	return keys, nil
}

// writeSecret 先写临时文件再替换，权限 0600。value 为空时删除该项。
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
	b, e := json.MarshalIndent(keys, "", "  ")
	if e != nil {
		return e
	}
	temp := w.secretsPath() + ".part"
	if e = os.WriteFile(temp, b, 0600); e != nil {
		return e
	}
	if e = os.Rename(temp, w.secretsPath()); e != nil {
		_ = os.Remove(temp)
	}
	return e
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
	if !slices.Contains(llm.Formats, p.Format) || !validEndpoint(p.BaseURL) || schema.TextLen(p.Name) > 60 || len(p.Model) > 200 || len(p.ModelsPath) > 500 {
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

// UseAIProvider 设定 AI 功能使用的服务，空串表示停用 AI 功能。
func (w *Workbench) UseAIProvider(id string) error {
	w.edit.Lock()
	defer w.edit.Unlock()
	if id != "" && !slices.ContainsFunc(w.Store.Read().AIProviders, func(x schema.AIProvider) bool { return x.ID == id }) {
		return msg.Err(msg.ErrAIProviderInvalid, nil)
	}
	return w.Store.Update(func(s *schema.State) { s.AIProviderID = id }, true)
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

// complete 用当前服务完成一次 AI 请求；同一时间只允许一个，CancelAI 可中止。
func (w *Workbench) complete(ctx context.Context, request llm.Request) (llm.Result, error) {
	_, c, e := w.aiConfig("")
	if e != nil {
		return llm.Result{}, e
	}
	if c.Model == "" {
		return llm.Result{}, msg.Err(msg.ErrAINotConfigured, nil)
	}
	w.ai.mu.Lock()
	if w.ai.cancel != nil {
		w.ai.mu.Unlock()
		return llm.Result{}, msg.Err(msg.ErrBusy, nil)
	}
	ctx, cancel := context.WithTimeout(ctx, aiTimeout)
	w.ai.cancel = cancel
	w.ai.mu.Unlock()
	defer func() {
		w.ai.mu.Lock()
		w.ai.cancel = nil
		w.ai.mu.Unlock()
		cancel()
	}()
	started := time.Now()
	result, e := llm.Complete(ctx, w.client, c, request)
	if errors.Is(ctx.Err(), context.DeadlineExceeded) && e != nil {
		e = msg.Err(msg.ErrAINetwork, msg.Params{"detail": "timeout"})
	}
	diag.Log(w.Store.Root, "ai.completed", "model", c.Model, "elapsed_ms", time.Since(started).Milliseconds(), "chars", len(result.Text), "truncated", result.Truncated, "error", diag.Error(e))
	return result, e
}

// CancelAI 取消正在进行的 AI 请求。
func (w *Workbench) CancelAI() {
	w.ai.mu.Lock()
	defer w.ai.mu.Unlock()
	if w.ai.cancel != nil {
		w.ai.cancel()
	}
}
