package remote

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"yovoice/internal/catalog"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
	"yovoice/internal/workbench"
)

func TestRemoteAPI(t *testing.T) {
	wb, err := workbench.New(t.TempDir())
	must(t, err)
	defer wb.Close()
	token := strings.Repeat("a", 32)
	api := &API{Workbench: wb, Token: token}
	request := func(method, path, body, auth string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Authorization", auth)
		w := httptest.NewRecorder()
		api.ServeHTTP(w, r)
		return w
	}
	// 所有错误响应统一为 JSON {"error": {"code": ...}}，返回其中的错误码。
	errorCode := func(w *httptest.ResponseRecorder) string {
		t.Helper()
		if ct := w.Header().Get("Content-Type"); ct != "application/json" {
			t.Fatalf("错误响应 Content-Type 为 %q：%s", ct, w.Body.String())
		}
		var body struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil || body.Error.Code == "" {
			t.Fatalf("错误正文不是 {\"error\":{\"code\":...}}：%s", w.Body.String())
		}
		return body.Error.Code
	}
	if w := request("GET", "/v1/models", "", ""); w.Code != 401 {
		t.Fatal(w.Code)
	}
	if w := request("POST", "/api/call", `{"method":"model.download"}`, "Bearer "+token); w.Code != 404 {
		t.Fatal(w.Code)
	}
	r := httptest.NewRequest("GET", "/v1/models", nil)
	r.Header.Set("Authorization", "Bearer "+token)
	r.Header.Set("Origin", "https://evil.test")
	rejected := httptest.NewRecorder()
	api.ServeHTTP(rejected, r)
	if rejected.Code != 403 {
		t.Fatal(rejected.Code)
	}
	uploaded := request("POST", "/v1/voices?name=remote", string(wav()), "Bearer "+token)
	if uploaded.Code != 200 {
		t.Fatal(uploaded.Code, uploaded.Body.String())
	}
	var voice schema.Voice
	must(t, json.Unmarshal(uploaded.Body.Bytes(), &voice))
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
	for _, body := range []string{`{"text":"hi","path":"/etc/passwd"}`, `{"text":"hi"} {}`, `{"text":""}`} {
		w := request("POST", "/v1/generate", body, "Bearer "+token)
		if w.Code != 400 {
			t.Fatal(w.Code, w.Body.String())
		}
		errorCode(w)
	}
	// 引用不存在的音色是客户端错误，返回 400 而不是 500。
	if w := request("POST", "/v1/generate", `{"text":"hi","voiceId":"`+strings.Repeat("f", 32)+`"}`, "Bearer "+token); w.Code != 400 || errorCode(w) != string(msg.ErrVoiceRequired) {
		t.Fatal(w.Code, w.Body.String())
	}
	if w := request("GET", "/v1/audio/"+schema.NewID(), "", "Bearer "+token); w.Code != 404 || errorCode(w) != string(msg.ErrAudioMissing) {
		t.Fatal(w.Code, w.Body.String())
	}
	if w := request("GET", "/v1/jobs/"+schema.NewID(), "", "Bearer "+token); w.Code != 404 || errorCode(w) != string(msg.ErrJobMissing) {
		t.Fatal(w.Code, w.Body.String())
	}
	body := `{"text":"远程生成","voiceId":"` + voice.ID + `"}`
	if w := request("PUT", "/v1/jobs/not-hex", body, "Bearer "+token); w.Code != 400 || errorCode(w) != string(msg.ErrRequestInvalid) {
		t.Fatal(w.Code, w.Body.String())
	}
	drafts := len(wb.Store.Read().Drafts)
	result := request("POST", "/v1/generate", body, "Bearer "+token)
	if result.Code != 200 || !bytes.Equal(result.Body.Bytes(), wav()) {
		t.Fatal(result.Code, result.Body.String())
	}
	// 远程请求只写入历史，不为每次调用新建作品。
	if len(wb.Store.Read().Drafts) != drafts {
		t.Fatal("远程生成不应新建作品")
	}
	if result.Header().Get("X-Yovoice-Generation-ID") == "" {
		t.Fatal("缺少结果 ID")
	}
	// 用已有模拟引擎验证断开连接时释放推理资源和请求锁。
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	pending := httptest.NewRequest("POST", "/v1/generate", strings.NewReader(strings.Replace(body, "远程生成", "等待取消", 1))).WithContext(ctx)
	pending.Header.Set("Authorization", "Bearer "+token)
	done := make(chan struct{})
	go func() { defer close(done); api.ServeHTTP(httptest.NewRecorder(), pending) }()
	deadline := time.Now().Add(5 * time.Second)
	for {
		s := wb.Store.Read()
		if s.Activity != nil && s.Activity.Status == "running" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("任务未启动")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if w := request("POST", "/v1/generate", body, "Bearer "+token); w.Code != http.StatusConflict || errorCode(w) != string(msg.ErrBusy) {
		t.Fatal(w.Code, w.Body.String())
	}
	cancel()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("取消未完成")
	}
	if w := request("POST", "/v1/generate", body, "Bearer "+token); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	waitJob := func(id, status string) GenerationJob {
		t.Helper()
		deadline := time.Now().Add(5 * time.Second)
		for {
			res := request("GET", "/v1/jobs/"+id, "", "Bearer "+token)
			var job GenerationJob
			must(t, json.Unmarshal(res.Body.Bytes(), &job))
			if job.Status == status {
				return job
			}
			if time.Now().After(deadline) {
				t.Fatalf("任务状态: %+v，期望 %s", job, status)
			}
			time.Sleep(10 * time.Millisecond)
		}
	}
	id := schema.NewID()
	submitted := request("PUT", "/v1/jobs/"+id, body, "Bearer "+token)
	if submitted.Code != 200 {
		t.Fatal(submitted.Body.String())
	}
	job := waitJob(id, "completed")
	replay := request("PUT", "/v1/jobs/"+id, body, "Bearer "+token)
	var same GenerationJob
	must(t, json.Unmarshal(replay.Body.Bytes(), &same))
	if same.ID != job.ID {
		t.Fatal("重试重复生成")
	}
	if res := request("PUT", "/v1/jobs/"+id, strings.Replace(body, "远程生成", "其他文本", 1), "Bearer "+token); res.Code != 409 || errorCode(res) != string(msg.ErrJobConflict) {
		t.Fatal(res.Code, res.Body.String())
	}
	if res := request("GET", job.DownloadPath, "", "Bearer "+token); !bytes.Equal(res.Body.Bytes(), wav()) {
		t.Fatal("异步音频不正确")
	}
	api.GenerationTimeout = 100 * time.Millisecond
	id = schema.NewID()
	request("PUT", "/v1/jobs/"+id, strings.Replace(body, "远程生成", "等待取消", 1), "Bearer "+token)
	waitJob(id, "timed_out")
	// 超时必须释放单任务槽，后续请求仍能提交。
	id = schema.NewID()
	if res := request("PUT", "/v1/jobs/"+id, body, "Bearer "+token); res.Code != 200 {
		t.Fatal(res.Code)
	}
	request("DELETE", "/v1/jobs/"+id, "", "Bearer "+token)
	waitJob(id, "cancelled")
	// 引擎失败时返回稳定错误码，客户端无需读取服务端日志。
	api.GenerationTimeout = 0
	id = schema.NewID()
	request("PUT", "/v1/jobs/"+id, strings.Replace(body, "远程生成", "模拟生成失败", 1), "Bearer "+token)
	if failed := waitJob(id, "failed"); !strings.Contains(failed.Error, string(msg.ErrGenerateFailed)) {
		t.Fatal(failed.Error)
	}
	if len(wb.Store.Read().Drafts) != drafts {
		t.Fatal("远程生成不应新建作品")
	}

}
