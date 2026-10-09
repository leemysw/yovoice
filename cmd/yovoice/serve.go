package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"time"
	"yovoice/internal/remote"
	"yovoice/internal/workbench"
)

// serveAPI 的生命周期由信号控制，不依赖桌面窗口或标准输入。
func serveAPI(ctx context.Context, wb *workbench.Workbench, address, token, cert, key string, generationTimeout time.Duration, out io.Writer) error {
	if generationTimeout <= 0 {
		return fmt.Errorf("--generation-timeout 必须大于 0")
	}
	if len(token) < 32 {
		return fmt.Errorf("请设置至少 32 字符的 YOVOICE_API_TOKEN")
	}
	if (cert == "") != (key == "") {
		return fmt.Errorf("--tls-cert 与 --tls-key 必须同时提供")
	}
	listener, err := net.Listen("tcp", address)
	if err != nil {
		return err
	}
	defer listener.Close()
	server := &http.Server{Handler: &remote.API{Workbench: wb, Token: token, Context: ctx, GenerationTimeout: generationTimeout}, ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 90 * time.Second, IdleTimeout: 60 * time.Second, BaseContext: func(net.Listener) context.Context { return ctx }}
	stopped := make(chan struct{})
	finished := make(chan struct{})
	defer func() { close(stopped); <-finished }()
	go func() {
		defer close(finished)
		select {
		case <-ctx.Done():
			wb.Close()
			shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := server.Shutdown(shutdown); err != nil {
				_ = server.Close()
			}
		case <-stopped:
		}
	}()
	scheme := "http"
	if cert != "" {
		scheme = "https"
	}
	if err = json.NewEncoder(out).Encode(map[string]string{"url": scheme + "://" + listener.Addr().String(), "mcpUrl": scheme + "://" + listener.Addr().String() + "/mcp"}); err != nil {
		return err
	}
	if cert != "" {
		err = server.ServeTLS(listener, cert, key)
	} else {
		err = server.Serve(listener)
	}
	if err == http.ErrServerClosed {
		return nil
	}
	return err
}
