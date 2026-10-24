package engine

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"yovoice/internal/msg"
)

// 推理中途连接被引擎关闭且进程随即退出时，报“引擎意外退出”并带上 engine.log 里的断言，而不是底层的网络错误。
func TestCrashedReportsEngineExit(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "logs"), 0700); err != nil {
		t.Fatal(err)
	}
	log := "\n===== 2026-10-24T22:00:00+08:00 engine index_tts2 =====\nload_backend: loaded CUDA backend\nggml_backend_cuda_graph_compute: CUDA graph warmup complete\n" +
		"\n===== 2026-10-24T23:00:32+08:00 engine index_tts2 =====\n[warning][model_spec] GGUF embeds a legacy model spec.\nggml_backend_cuda_graph_compute: CUDA graph warmup complete\n" +
		"D:\\a\\audio.cpp\\external\\ggml\\src\\ggml.c:1685: GGML_ASSERT(ctx->mem_buffer != NULL) failed\n"
	if err := os.WriteFile(filepath.Join(root, "logs", "engine.log"), []byte(log), 0600); err != nil {
		t.Fatal(err)
	}
	reset := errors.New("wsarecv: An existing connection was forcibly closed by the remote host.")
	e := &Engine{root: root, done: make(chan error, 1)}
	e.done <- errors.New("exit status 0xc0000409")
	var ce *msg.CallError
	if err := e.crashed(context.Background(), reset); !errors.As(err, &ce) || ce.Code != msg.ErrEngineCrashed || ce.Params["detail"] != `D:\a\audio.cpp\external\ggml\src\ggml.c:1685: GGML_ASSERT(ctx->mem_buffer != NULL) failed` {
		t.Fatalf("err = %v", err)
	}
	// 本次输出里没有错误行时退回退出码，不拿上一轮的内容。
	if err := os.WriteFile(filepath.Join(root, "logs", "engine.log"), []byte(log+"\n===== 2026-10-24T23:10:00+08:00 engine index_tts2 =====\nggml_backend_cuda_graph_compute: CUDA graph warmup complete\n"), 0600); err != nil {
		t.Fatal(err)
	}
	e.done = make(chan error, 1)
	e.done <- errors.New("exit status 0xc0000409")
	if err := e.crashed(context.Background(), reset); !errors.As(err, &ce) || ce.Params["detail"] != "exit status 0xc0000409" {
		t.Fatalf("err = %v", err)
	}
	// 取消导致的断开原样返回。
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := e.crashed(ctx, reset); err != reset {
		t.Fatalf("err = %v", err)
	}
}
