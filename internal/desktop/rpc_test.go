package desktop

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
	"yovoice/internal/workbench"
)

// 分发器只做解码与路由：业务错误原样返回，失败调用写入诊断日志。
func TestCallDecodesAndLogsFailures(t *testing.T) {
	w, err := workbench.New(t.TempDir())
	must(t, err)
	defer w.Close()
	var callErr *msg.CallError
	if _, err = Call(context.Background(), w, "draft.save", nil); !errors.As(err, &callErr) || callErr.Code != msg.ErrRequestInvalid {
		t.Fatal("空请求应返回 requestInvalid", err)
	}
	if _, err = Call(context.Background(), w, "unknown.method", json.RawMessage(`{}`)); !errors.As(err, &callErr) || callErr.Code != msg.ErrMethodUnsupported {
		t.Fatal("未知方法应返回 methodUnsupported", err)
	}
	d := schema.DefaultDraft()
	d.Title = "经由 RPC 保存"
	raw, err := json.Marshal(d)
	must(t, err)
	if result, err := Call(context.Background(), w, "draft.save", raw); err != nil || result != true {
		t.Fatal(result, err)
	}
	if w.Store.Read().Drafts[0].Title != "经由 RPC 保存" {
		t.Fatal("作品未保存")
	}
	d.Kind = "invalid"
	raw, err = json.Marshal(d)
	must(t, err)
	if _, err = Call(context.Background(), w, "draft.save", raw); err == nil {
		t.Fatal("应拒绝无效作品")
	}
	b, err := os.ReadFile(filepath.Join(w.Store.Root, "logs", "service.log"))
	must(t, err)
	if !strings.Contains(string(b), `"rpc.failed"`) || !strings.Contains(string(b), `"method":"draft.save"`) {
		t.Fatal("缺少调用失败诊断")
	}
	asset, err := Call(context.Background(), w, "timeline.import", json.RawMessage(`{"name":"不是音频","base64":"bm90IGF1ZGlv"}`))
	if err == nil {
		t.Fatal("应拒绝无法解析的音频", asset)
	}
}

// 宿主选好路径后转发 score.export / score.import：MIDI 与乐谱 JSON 往返一致；覆盖已有文件由保存对话框确认。
func TestScoreFilesRoundTrip(t *testing.T) {
	w, err := workbench.New(t.TempDir())
	must(t, err)
	defer w.Close()
	s := schema.Score{Tempo: 90, TimeSignature: []int{3, 4}, Tracks: []schema.ScoreTrack{{ID: "p", Name: "钢琴", Program: 0, Notes: []schema.ScoreNote{{Bar: 1, Beat: 1, Pitch: 60, Length: 1, Velocity: 80}, {Bar: 2, Beat: 2.5, Pitch: 64, Length: .5, Velocity: 70}}}}}
	dir := t.TempDir()
	for _, name := range []string{"曲子.mid", "曲子.json"} {
		path := filepath.Join(dir, name)
		raw, err := json.Marshal(map[string]any{"path": path, "score": s})
		must(t, err)
		if _, err = Call(context.Background(), w, "score.export", raw); err != nil {
			t.Fatal(name, err)
		}
		if _, err = Call(context.Background(), w, "score.export", raw); err != nil {
			t.Fatal("再次导出应替换原文件", name, err)
		}
		result, err := Call(context.Background(), w, "score.import", json.RawMessage(`{"path":`+strconvQuote(path)+`}`))
		if err != nil {
			t.Fatal(name, err)
		}
		back := result.(schema.Score)
		if back.Tempo != 90 || len(back.Tracks) != 1 || len(back.Tracks[0].Notes) != 2 || back.Tracks[0].Notes[1].Beat != 2.5 {
			t.Fatalf("%s 往返不一致：%+v", name, back)
		}
	}
	var callErr *msg.CallError
	bad := filepath.Join(dir, "坏.mid")
	must(t, os.WriteFile(bad, []byte("MThd broken"), 0600))
	if _, err = Call(context.Background(), w, "score.import", json.RawMessage(`{"path":`+strconvQuote(bad)+`}`)); !errors.As(err, &callErr) || callErr.Code != msg.ErrMidiInvalid {
		t.Fatal("损坏的 MIDI 应返回 midiInvalid", err)
	}
}

func strconvQuote(s string) string { b, _ := json.Marshal(s); return string(b) }
