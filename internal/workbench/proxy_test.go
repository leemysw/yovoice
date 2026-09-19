package workbench

import (
	"context"
	"crypto/sha256"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

func TestProxyAddressValidation(t *testing.T) {
	for _, address := range []string{"", "http://127.0.0.1:7890", "https://proxy.example:443", "socks5://[::1]:1080"} {
		if _, err := parseProxyURL(address); err != nil {
			t.Fatalf("拒绝有效代理 %q: %v", address, err)
		}
	}
	for _, address := range []string{"127.0.0.1:7890", "ftp://proxy:21", "http://:7890", "http://proxy:0", "http://proxy:65536", "http://proxy:abc", "http://user:secret@proxy:80", "http://proxy:80/path", "http://proxy:80?x=1"} {
		if _, err := parseProxyURL(address); err == nil {
			t.Fatalf("接受了无效代理 %q", address)
		}
	}
}

func TestDownloadProxyPersistenceAndChanges(t *testing.T) {
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Host != "download.invalid" {
			t.Errorf("代理收到意外目标: %s", r.URL.Host)
		}
		fmt.Fprint(w, "proxy download")
	}))
	defer proxy.Close()
	workbench, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer workbench.Close()
	p := workbench.Store.Read().Preferences
	p.ProxyURL = "  " + proxy.URL + "  "
	if err := workbench.preferences(p); err != nil {
		t.Fatal(err)
	}
	reopened, err := NewStore(workbench.Store.Root)
	if err != nil {
		t.Fatal(err)
	}
	if reopened.Read().Preferences.ProxyURL != proxy.URL {
		t.Fatal("代理未持久化")
	}
	sum := fmt.Sprintf("%x", sha256.Sum256([]byte("proxy download")))
	if err := Download(context.Background(), workbench.client, "http://download.invalid/file", filepath.Join(t.TempDir(), "file"), sum, 0, func(int64, int64) {}); err != nil {
		t.Fatal(err)
	}
	// 保存失败不能替换当前有效配置。
	p.ProxyURL = "invalid"
	if err := workbench.preferences(p); err == nil {
		t.Fatal("无效配置未拒绝")
	}
	if workbench.Store.Read().Preferences.ProxyURL != proxy.URL {
		t.Fatal("无效配置覆盖了代理")
	}
	second := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, "updated") }))
	defer second.Close()
	p.ProxyURL = second.URL
	if err := workbench.preferences(p); err != nil {
		t.Fatal(err)
	}
	sum = fmt.Sprintf("%x", sha256.Sum256([]byte("updated")))
	if err := Download(context.Background(), workbench.client, "http://download.invalid/file", filepath.Join(t.TempDir(), "file"), sum, 0, func(int64, int64) {}); err != nil {
		t.Fatal(err)
	}
	for _, target := range []string{"http://localhost:1234", "http://127.0.0.1:1234", "http://[::1]:1234"} {
		req, _ := http.NewRequest(http.MethodGet, target, nil)
		actual, err := workbench.client.Transport.(*http.Transport).Proxy(req)
		if actual != nil || err != nil {
			t.Fatalf("本地连接不应使用代理: %s", target)
		}
	}
	p.ProxyURL = ""
	if err := workbench.preferences(p); err != nil {
		t.Fatal(err)
	}
	if workbench.Store.Read().Preferences.ProxyURL != "" {
		t.Fatal("代理未清空")
	}
}

func TestProxyTogglePreservesAddress(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	p := w.Store.Read().Preferences
	p.ProxyURL = "http://127.0.0.1:7890"
	req, _ := http.NewRequest(http.MethodGet, "https://download.invalid/file", nil)
	for _, enabled := range []bool{true, false, true} {
		p.ProxyEnabled = &enabled
		must(t, w.preferences(p))
		reopened, err := NewStore(w.Store.Root)
		must(t, err)
		saved := reopened.Read().Preferences
		if saved.ProxyEnabled == nil || *saved.ProxyEnabled != enabled || saved.ProxyURL != p.ProxyURL {
			t.Fatal("开关或代理地址未正确持久化")
		}
		proxy, err := w.client.Transport.(*http.Transport).Proxy(req)
		must(t, err)
		if enabled && (proxy == nil || proxy.String() != p.ProxyURL) || !enabled && proxy != nil {
			t.Fatal("代理开关未改变请求路由")
		}
	}
	p.ProxyURL = ""
	if err := w.preferences(p); err == nil {
		t.Fatal("不应允许开启空代理地址")
	}
}
