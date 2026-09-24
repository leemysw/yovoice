package main

import (
	"bufio"
	"bytes"
	"context"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestShutdownDrainsResponses(t *testing.T) {
	root := t.TempDir()
	binary := filepath.Join(root, "service")
	if output, err := exec.Command("go", "build", "-o", binary, ".").CombinedOutput(); err != nil {
		t.Fatalf("构建服务失败：%v\n%s", err, output)
	}
	// 保留一个尚未读完的响应，确保关闭监听器后仍须等待活动请求完成。
	payload := bytes.Repeat([]byte("audio"), 2<<20)
	if err := os.WriteFile(filepath.Join(root, "payload"), payload, 0600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, binary)
	const secret = "0123456789abcdef0123456789abcdef"
	command.Env = append(os.Environ(), "WORKBENCH_DATA="+filepath.Join(root, "data"), "WORKBENCH_WEB="+root, "WORKBENCH_TOKEN="+secret, "WORKBENCH_ENGINE=")
	input, err := command.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	output, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	command.Stderr = os.Stderr
	if err = command.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = command.Process.Kill(); _ = command.Wait() }()
	origin, err := bufio.NewReader(output).ReadString('\n')
	if err != nil {
		t.Fatal(err)
	}
	origin = origin[:len(origin)-1]
	client := &http.Client{Timeout: 15 * time.Second}
	defer client.CloseIdleConnections()
	request := func(method, path string) *http.Response {
		t.Helper()
		req, err := http.NewRequestWithContext(ctx, method, origin+path, nil)
		if err != nil {
			t.Fatal(err)
		}
		req.AddCookie(&http.Cookie{Name: "vw-" + secret[:12], Value: secret})
		response, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		if response.StatusCode != http.StatusOK {
			response.Body.Close()
			t.Fatalf("请求失败：%s", response.Status)
		}
		return response
	}
	pending := request(http.MethodGet, "/payload")
	defer pending.Body.Close()
	shutdown := request(http.MethodPost, "/shutdown")
	body, err := io.ReadAll(shutdown.Body)
	shutdown.Body.Close()
	if err != nil || string(body) != "{}" {
		t.Fatalf("退出响应不完整：%q，%v", body, err)
	}
	body, err = io.ReadAll(pending.Body)
	if err != nil || !bytes.Equal(body, payload) {
		t.Fatalf("退出截断活动响应：收到 %d/%d 字节，%v", len(body), len(payload), err)
	}
	if err = command.Wait(); err != nil {
		t.Fatal(err)
	}
}
