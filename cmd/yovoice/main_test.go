package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"
	"yovoice/internal/workbench"
)

func wave() []byte {
	b := make([]byte, 32044)
	copy(b, "RIFF")
	binary.LittleEndian.PutUint32(b[4:], uint32(len(b)-8))
	copy(b[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(b[16:], 16)
	binary.LittleEndian.PutUint16(b[20:], 1)
	binary.LittleEndian.PutUint16(b[22:], 1)
	binary.LittleEndian.PutUint32(b[24:], 16000)
	binary.LittleEndian.PutUint32(b[28:], 32000)
	binary.LittleEndian.PutUint16(b[32:], 2)
	binary.LittleEndian.PutUint16(b[34:], 16)
	copy(b[36:], "data")
	binary.LittleEndian.PutUint32(b[40:], 32000)
	return b
}

// 测试进程充当引擎，覆盖 CLI 的真实启动、协议、结果落盘和取消流程。
func TestMain(m *testing.M) {
	if len(os.Args) > 2 && os.Args[1] == "--config" {
		b, _ := os.ReadFile(os.Args[2])
		var c struct{ Port int }
		_ = json.Unmarshal(b, &c)
		http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, "{}") })
		http.HandleFunc("/v1/tasks/run", func(w http.ResponseWriter, r *http.Request) {
			var p struct{ Request struct{ Text string } }
			_ = json.NewDecoder(r.Body).Decode(&p)
			if p.Request.Text == "等待取消" {
				<-r.Context().Done()
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"audio": base64.StdEncoding.EncodeToString(wave())})
		})
		_ = http.ListenAndServe(fmt.Sprintf("127.0.0.1:%d", c.Port), nil)
		os.Exit(0)
	}
	os.Exit(m.Run())
}
func TestStandalone(t *testing.T) {
	root := t.TempDir()
	s, e := workbench.NewStore(root)
	if e != nil {
		t.Fatal(e)
	}
	exe, _ := os.Executable()
	model := filepath.Join(root, "model.gguf")
	if e = os.WriteFile(model, []byte("test"), 0600); e != nil {
		t.Fatal(e)
	}
	e = s.Update(func(s *workbench.State) {
		s.RuntimePath = &exe
		b := "cpu"
		s.RuntimeBackend = &b
		s.Models = []workbench.InstalledModel{{ID: "index-2.5-q8", Path: model}}
	}, true)
	if e != nil {
		t.Fatal(e)
	}
	var rejected bytes.Buffer
	if err := run(context.Background(), []string{"models", "import", model, "--data-dir", root}, &rejected, &rejected); err == nil {
		t.Fatal("模型校验失败必须返回错误，不能提前报告成功")
	}
	ref := filepath.Join(root, "ref.wav")
	if e = os.WriteFile(ref, wave(), 0600); e != nil {
		t.Fatal(e)
	}
	output := filepath.Join(root, "result.wav")
	var out, progress bytes.Buffer
	args := []string{"generate", "--text", "你好", "--reference", ref, "--output", output, "--data-dir", root, "--json"}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if e = run(ctx, args, &out, &progress); e != nil {
		t.Fatal(e)
	}
	var result struct {
		Path     string
		Duration float64
		ID       string
	}
	if e = json.Unmarshal(out.Bytes(), &result); e != nil || result.Path != output || result.Duration != 1 || result.ID == "" {
		t.Fatalf("%s %v", out.String(), e)
	}
	if e = run(ctx, args, &out, &progress); e == nil {
		t.Fatal("不能覆盖已有输出")
	}
	if duration, e := workbench.Duration(output); e != nil || duration != 1 {
		t.Fatal(duration, e)
	}
	args[2] = "等待取消"
	args[6] = filepath.Join(root, "cancelled.wav")
	cancelled, stop := context.WithTimeout(ctx, time.Second)
	defer stop()
	if e = run(cancelled, args, &out, &progress); !errors.Is(e, context.DeadlineExceeded) {
		t.Fatal(e)
	}
	if _, e = os.Stat(args[6]); !os.IsNotExist(e) {
		t.Fatal("取消仍导出音频")
	}
	lock, e := workbench.Lock(filepath.Join(root, "service.lock"))
	if e != nil {
		t.Fatal(e)
	}
	if e = run(ctx, []string{"status", "--data-dir", root}, &out, &progress); e == nil {
		t.Fatal("未阻止并发访问")
	}
	lock.Close()
	out.Reset()
	if e = run(ctx, []string{"voices", "list", "--data-dir", root}, &out, &progress); e != nil || !json.Valid(out.Bytes()) {
		t.Fatal(e, out.String())
	}
}
