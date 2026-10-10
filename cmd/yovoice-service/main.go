package main

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"
	"yovoice/internal/catalog"
	"yovoice/internal/desktop"
	"yovoice/internal/platform"
	"yovoice/internal/schema"
	"yovoice/internal/store"
	"yovoice/internal/workbench"
)

func run() error {
	if len(os.Args) > 1 && os.Args[1] == "--prepare-data" {
		return store.PrepareDefault()
	}
	root, secret, assets := os.Getenv("WORKBENCH_DATA"), os.Getenv("WORKBENCH_TOKEN"), os.Getenv("WORKBENCH_WEB")
	if root == "" || assets == "" || len(secret) < 32 {
		return fmt.Errorf("缺少有效的数据目录、界面目录或会话凭证。")
	}
	if e := os.MkdirAll(root, 0700); e != nil {
		return e
	}
	lock, e := platform.Lock(filepath.Join(root, "service.lock"))
	if e != nil {
		return fmt.Errorf("数据目录正被其他应用使用：%w", e)
	}
	defer lock.Close()
	wb, e := workbench.New(root)
	if e != nil {
		return e
	}
	defer wb.Close()
	bundled := os.Getenv("WORKBENCH_ENGINE")
	if runtime.GOOS == "windows" {
		// CUDA 安装包同时内置 CPU 与 CUDA 内核；先登记 CUDA，首次启动默认使用它。
		if e = wb.UseBundled("cuda", os.Getenv("WORKBENCH_ENGINE_CUDA")); e != nil {
			return e
		}
		if e = wb.UseBundled("cpu", bundled); e != nil {
			return e
		}
	}
	existing := wb.Store.Read()
	// macOS 内置 Metal 内核同时支持 CPU 与 Metal；数据目录中的内核过期时回退到内置内核。
	if _, e = os.Stat(bundled); runtime.GOOS == "darwin" && e == nil && (existing.RuntimePath == nil || strings.HasSuffix(*existing.RuntimePath, "/Contents/Resources/engine/audiocpp_server") || !workbench.RuntimeReady(existing)) {
		if e = wb.Store.Update(func(s *schema.State) {
			s.RuntimePath = &bundled
			backend := s.Preferences.Backend
			if existing.RuntimePath == nil {
				backend = "metal"
				s.Preferences.Backend = backend
			}
			s.RuntimeBackend = &backend
			// 内置 Metal 内核随应用更新，版本始终与当前应用一致。
			version := catalog.EngineVersion
			s.RuntimeVersion = &version
		}, true); e != nil {
			return e
		}
	}
	listener, e := net.Listen("tcp4", "127.0.0.1:0")
	if e != nil {
		return e
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var once sync.Once
	stop := func() { once.Do(cancel) }
	handler := &desktop.Server{Workbench: wb, Assets: assets, Secret: secret, Shutdown: stop}
	server := &http.Server{Handler: handler, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second, BaseContext: func(net.Listener) context.Context { return ctx }}
	go func() { _, _ = bufio.NewReader(os.Stdin).ReadString('\n'); stop() }()
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(signals)
	go func() {
		select {
		case <-signals:
			stop()
		case <-ctx.Done():
		}
	}()
	shutdownDone := make(chan struct{})
	go func() {
		defer close(shutdownDone)
		<-ctx.Done()
		wb.Close()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()
	fmt.Println("http://" + listener.Addr().String())
	e = server.Serve(listener)
	// Serve 在监听器关闭后立即返回；等待活动请求完成，避免进程退出截断响应。
	stop()
	<-shutdownDone
	if e == http.ErrServerClosed {
		return nil
	}
	return e
}
func main() {
	if e := run(); e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
}
