package desktop

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"yovoice/internal/domain"
	"yovoice/internal/msg"
	"yovoice/internal/workbench"
)

// 分发器只做解码与路由：业务错误原样返回，失败调用写入诊断日志。
func TestCallDecodesAndLogsFailures(t *testing.T) {
	w, err := workbench.New(t.TempDir())
	must(t, err)
	defer w.Close()
	var callErr *msg.CallError
	if _, err = Call(w, "draft.save", nil); !errors.As(err, &callErr) || callErr.Code != msg.ErrRequestInvalid {
		t.Fatal("空请求应返回 requestInvalid", err)
	}
	if _, err = Call(w, "unknown.method", json.RawMessage(`{}`)); !errors.As(err, &callErr) || callErr.Code != msg.ErrMethodUnsupported {
		t.Fatal("未知方法应返回 methodUnsupported", err)
	}
	d := domain.DefaultDraft()
	d.Title = "经由 RPC 保存"
	raw, err := json.Marshal(d)
	must(t, err)
	if result, err := Call(w, "draft.save", raw); err != nil || result != true {
		t.Fatal(result, err)
	}
	if w.Store.Read().Drafts[0].Title != "经由 RPC 保存" {
		t.Fatal("作品未保存")
	}
	d.Kind = "invalid"
	raw, err = json.Marshal(d)
	must(t, err)
	if _, err = Call(w, "draft.save", raw); err == nil {
		t.Fatal("应拒绝无效作品")
	}
	b, err := os.ReadFile(filepath.Join(w.Store.Root, "logs", "service.log"))
	must(t, err)
	if !strings.Contains(string(b), `"rpc.failed"`) || !strings.Contains(string(b), `"method":"draft.save"`) {
		t.Fatal("缺少调用失败诊断")
	}
	asset, err := Call(w, "timeline.import", json.RawMessage(`{"name":"不是音频","base64":"bm90IGF1ZGlv"}`))
	if err == nil {
		t.Fatal("应拒绝无法解析的音频", asset)
	}
}
