package download

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
	"yovoice/internal/msg"
)

func digest(b []byte) string {
	s := sha256.Sum256(b)
	return hex.EncodeToString(s[:])
}

// quick 把看门狗与退避改短，让失败路径在毫秒级跑完。
func quick(t *testing.T, stall time.Duration) {
	t.Helper()
	oldStall, oldDelay := stallTimeout, retryDelay
	stallTimeout, retryDelay = stall, time.Millisecond
	t.Cleanup(func() { stallTimeout, retryDelay = oldStall, oldDelay })
}

func payload() []byte {
	b := make([]byte, 1000)
	for i := range b {
		b[i] = byte(i)
	}
	return b
}

// serveRange 有 Range 头时回 206，否则回 200 全量；两种响应都带强 ETag。
func serveRange(w http.ResponseWriter, r *http.Request, b []byte) {
	w.Header().Set("ETag", `"v1"`)
	if rg := r.Header.Get("Range"); rg != "" {
		start, e := strconv.ParseInt(strings.TrimSuffix(strings.TrimPrefix(rg, "bytes="), "-"), 10, 64)
		if e != nil || start < 0 || start >= int64(len(b)) {
			http.Error(w, "bad range", 416)
			return
		}
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, len(b)-1, len(b)))
		w.WriteHeader(206)
		_, _ = w.Write(b[start:])
		return
	}
	_, _ = w.Write(b)
}

func codeOf(e error) msg.Code {
	var ce *msg.CallError
	if errors.As(e, &ce) {
		return ce.Code
	}
	return ""
}

func exists(path string) bool {
	_, e := os.Stat(path)
	return e == nil
}

func noProgress(int64, int64) {}

// 已下完的 .part 在复核时遇到取消，必须原样保留，不能当作校验不符删掉。
func TestFileKeepsCompletePartialWhenCancelled(t *testing.T) {
	b := payload()
	dest := filepath.Join(t.TempDir(), "file")
	must(t, os.WriteFile(dest+".part", b, 0600))
	var hits atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits.Add(1) }))
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	e := File(ctx, server.Client(), server.URL, dest, digest(b), int64(len(b)), noProgress)
	if !errors.Is(e, context.Canceled) {
		t.Fatal("应返回上下文错误", e)
	}
	if !exists(dest + ".part") {
		t.Fatal("完整的 .part 被删除")
	}
	if exists(dest) || hits.Load() != 0 {
		t.Fatal("取消后不应改名或发请求")
	}
}

// 带来源记录的 .part 续传：请求携带 Range 与 If-Range，成功后 .meta 一并清理。
func TestFileResumesWithMeta(t *testing.T) {
	b := payload()
	for _, tc := range []struct{ name, meta, ifRange string }{
		{"strong-etag", `{"url":%q,"etag":"\"v1\"","lastModified":"Mon, 01 Jan 2024 00:00:00 GMT"}`, `"v1"`},
		{"weak-etag", `{"url":%q,"etag":"W/\"v1\"","lastModified":"Mon, 01 Jan 2024 00:00:00 GMT"}`, "Mon, 01 Jan 2024 00:00:00 GMT"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			headers := make(chan http.Header, 1)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				headers <- r.Header.Clone()
				serveRange(w, r, b)
			}))
			defer server.Close()
			dest := filepath.Join(t.TempDir(), "file")
			must(t, os.WriteFile(dest+".part", b[:400], 0600))
			must(t, os.WriteFile(dest+".part.meta", []byte(fmt.Sprintf(tc.meta, server.URL)), 0600))
			must(t, File(context.Background(), server.Client(), server.URL, dest, digest(b), int64(len(b)), noProgress))
			h := <-headers
			if h.Get("Range") != "bytes=400-" || h.Get("If-Range") != tc.ifRange {
				t.Fatal("续传头不正确", h.Get("Range"), h.Get("If-Range"))
			}
			got, e := os.ReadFile(dest)
			must(t, e)
			if digest(got) != digest(b) {
				t.Fatal("续传后内容不一致")
			}
			if exists(dest+".part") || exists(dest+".part.meta") {
				t.Fatal("完成后应清理 .part 与 .meta")
			}
		})
	}
}

// 来源记录缺失或不符时的取舍：换了地址或无法解析就从零开始；旧版本没有记录的 .part 仍续传但不带 If-Range。
func TestFileRestartsWhenMetaMismatch(t *testing.T) {
	b := payload()
	for _, tc := range []struct {
		name, meta string
		wantRange  string
	}{
		{"other-url", `{"url":"http://other.invalid/file","etag":"\"v1\""}`, ""},
		{"corrupt", `{"url":`, ""},
		{"legacy", "", "bytes=400-"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			headers := make(chan http.Header, 1)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				headers <- r.Header.Clone()
				serveRange(w, r, b)
			}))
			defer server.Close()
			dest := filepath.Join(t.TempDir(), "file")
			must(t, os.WriteFile(dest+".part", b[:400], 0600))
			if tc.meta != "" {
				must(t, os.WriteFile(dest+".part.meta", []byte(tc.meta), 0600))
			}
			must(t, File(context.Background(), server.Client(), server.URL, dest, digest(b), int64(len(b)), noProgress))
			h := <-headers
			if h.Get("Range") != tc.wantRange || h.Get("If-Range") != "" {
				t.Fatal("请求头不符合预期", h.Get("Range"), h.Get("If-Range"))
			}
			got, e := os.ReadFile(dest)
			must(t, e)
			if digest(got) != digest(b) {
				t.Fatal("下载内容不一致")
			}
			if exists(dest+".part") || exists(dest+".part.meta") {
				t.Fatal("完成后应清理 .part 与 .meta")
			}
		})
	}
}

// 响应写到一半连接断开：自动重试并从断点续传。
func TestFileResumesAfterConnectionDrop(t *testing.T) {
	quick(t, time.Second)
	b := payload()
	var hits atomic.Int32
	ranges := make(chan string, 8)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ranges <- r.Header.Get("Range")
		if hits.Add(1) == 1 {
			w.Header().Set("ETag", `"v1"`)
			w.Header().Set("Content-Length", strconv.Itoa(len(b)))
			_, _ = w.Write(b[:400])
			w.(http.Flusher).Flush()
			panic(http.ErrAbortHandler)
		}
		serveRange(w, r, b)
	}))
	defer server.Close()
	dest := filepath.Join(t.TempDir(), "file")
	must(t, File(context.Background(), server.Client(), server.URL, dest, digest(b), int64(len(b)), noProgress))
	if hits.Load() != 2 {
		t.Fatal("应恰好重试一次", hits.Load())
	}
	if first, second := <-ranges, <-ranges; first != "" || second != "bytes=400-" {
		t.Fatal("第二次请求应从断点续传", first, second)
	}
	got, e := os.ReadFile(dest)
	must(t, e)
	if digest(got) != digest(b) {
		t.Fatal("续传后内容不一致")
	}
}

// 服务器临时错误（5xx）退避后重试。
func TestFileRetriesServerError(t *testing.T) {
	quick(t, time.Second)
	b := payload()
	var hits atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if hits.Add(1) == 1 {
			http.Error(w, "busy", 500)
			return
		}
		serveRange(w, r, b)
	}))
	defer server.Close()
	dest := filepath.Join(t.TempDir(), "file")
	must(t, File(context.Background(), server.Client(), server.URL, dest, digest(b), int64(len(b)), noProgress))
	if hits.Load() != 2 {
		t.Fatal("请求次数应为 2", hits.Load())
	}
	got, e := os.ReadFile(dest)
	must(t, e)
	if digest(got) != digest(b) {
		t.Fatal("下载内容不一致")
	}
}

// 等待响应头或响应体长时间没有进展：看门狗取消本次请求并重试，耗尽后报“下载未完成”。
func TestFileStallReturnsIncomplete(t *testing.T) {
	b := payload()
	for _, stage := range []string{"header", "body"} {
		t.Run(stage, func(t *testing.T) {
			quick(t, 100*time.Millisecond)
			var hits atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				hits.Add(1)
				if stage == "body" {
					w.Header().Set("Content-Length", strconv.Itoa(len(b)))
					w.WriteHeader(200)
					w.(http.Flusher).Flush()
				}
				<-r.Context().Done()
			}))
			defer server.Close()
			dest := filepath.Join(t.TempDir(), "file")
			started := time.Now()
			e := File(context.Background(), server.Client(), server.URL, dest, digest(b), int64(len(b)), noProgress)
			if codeOf(e) != msg.ErrDownloadIncomplete {
				t.Fatal("停滞应报下载未完成", e)
			}
			if hits.Load() != 4 {
				t.Fatal("应尝试 4 次", hits.Load())
			}
			if time.Since(started) > 2*time.Second {
				t.Fatal("看门狗未按缩短后的时长生效", time.Since(started))
			}
		})
	}
}

// 哈希不符不重试，并删除 .part 与 .meta。
func TestFileChecksumMismatchNoRetry(t *testing.T) {
	quick(t, time.Second)
	var hits atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.Header().Set("ETag", `"v1"`)
		_, _ = w.Write([]byte("hello"))
	}))
	defer server.Close()
	dest := filepath.Join(t.TempDir(), "file")
	e := File(context.Background(), server.Client(), server.URL, dest, digest([]byte("other")), 0, noProgress)
	if codeOf(e) != msg.ErrDownloadChecksum {
		t.Fatal("应报校验不符", e)
	}
	if hits.Load() != 1 {
		t.Fatal("校验不符不应重试", hits.Load())
	}
	if exists(dest+".part") || exists(dest+".part.meta") || exists(dest) {
		t.Fatal("校验不符应删除 .part 与 .meta")
	}
}
