package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestServeCommand(t *testing.T) {
	token := strings.Repeat("b", 32)
	t.Setenv("YOVOICE_API_TOKEN", token)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	reader, writer := io.Pipe()
	defer reader.Close()
	result := make(chan error, 1)
	go func() {
		defer writer.Close()
		result <- run(ctx, []string{"serve", "--listen", "127.0.0.1:0", "--data-dir", t.TempDir()}, writer, io.Discard)
	}()
	var ready struct {
		URL string `json:"url"`
	}
	if err := json.NewDecoder(reader).Decode(&ready); err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequestWithContext(ctx, "GET", ready.URL+"/v1/status", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatal(response.StatusCode)
	}
	cancel()
	select {
	case err := <-result:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(6 * time.Second):
		t.Fatal("API 未退出")
	}
	t.Setenv("YOVOICE_API_TOKEN", "")
	if err := run(context.Background(), []string{"serve", "--data-dir", t.TempDir()}, io.Discard, io.Discard); err == nil {
		t.Fatal("缺少凭证仍启动服务")
	}
}
