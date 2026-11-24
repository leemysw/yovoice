package diag

import (
	"archive/zip"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestMarkRunningDetectsUncleanExit(t *testing.T) {
	root := t.TempDir()
	MarkRunning(root)() // 正常退出：标记被删除，下次启动不报崩溃。
	MarkRunning(root)   // 这次没有清除标记，模拟崩溃或被强制结束。
	MarkRunning(root)
	page, err := Query(root, Filter{Text: "service.crashed"})
	if err != nil || page.Total != 1 {
		t.Fatalf("应只记录一次异常退出: total=%d err=%v", page.Total, err)
	}
	if page.Entries[0].Level != "ERROR" || page.Entries[0].Fields["previous_start"] == "" {
		t.Fatalf("异常退出记录不完整: %+v", page.Entries[0])
	}
}

func TestSummarizeReportsCrashAndErrorCodesOnly(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "logs"), 0700); err != nil {
		t.Fatal(err)
	}
	Log(root, "engine.stopped", "family", "kokoro_tts")
	Log(root, "generation.failed", "error", map[string]any{"code": "err.generateFailed", "params": map[string]any{"detail": "/Users/me/secret.wav"}})
	Log(root, "engine.exited", "family", "soulx_singer", "exit", "signal: segmentation fault")
	report, err := Summarize(root, Environment{Version: "0.10.0", Engine: "v0.9.6", Backend: "metal"}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if report.Crash == nil || report.Crash.Kind != "engine" || report.Crash.Family != "soulx_singer" {
		t.Fatalf("应识别推理引擎意外退出: %+v", report.Crash)
	}
	if len(report.Problems) != 1 || report.Problems[0].Code != "err.generateFailed" {
		t.Fatalf("错误摘要不对: %+v", report.Problems)
	}
	link, err := url.Parse(report.IssueURL)
	if err != nil || link.Host != "github.com" || link.Path != "/leemysw/yovoice/issues/new" {
		t.Fatalf("issue 地址无效: %s", report.IssueURL)
	}
	body := link.Query().Get("body")
	for _, want := range []string{"yovoice: 0.10.0", "audio.cpp v0.9.6 (metal)", "inference engine exited unexpectedly (soulx_singer)", "generation.failed (err.generateFailed)"} {
		if !strings.Contains(body, want) {
			t.Fatalf("issue 正文缺少 %q:\n%s", want, body)
		}
	}
	if strings.Contains(body, "secret.wav") {
		t.Fatalf("issue 正文不应包含错误参数里的路径:\n%s", body)
	}
	if !strings.HasPrefix(link.Query().Get("title"), "[Crash]") {
		t.Fatalf("有异常退出时标题应标记 Crash: %s", link.Query().Get("title"))
	}
}

func TestBundleKeepsEngineLogTail(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "logs")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	head := strings.Repeat("a", engineLogTail)
	if err := os.WriteFile(filepath.Join(dir, "engine.log"), []byte(head+"GGML_ASSERT failed\n"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"engine.log.out", runningMarker, CrashLog} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(name), 0600); err != nil {
			t.Fatal(err)
		}
	}
	path := filepath.Join(t.TempDir(), "bundle.zip")
	if err := Bundle(root, path, "0.10.0"); err != nil {
		t.Fatal(err)
	}
	archive, err := zip.OpenReader(path)
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	files := map[string]int64{}
	for _, f := range archive.File {
		files[f.Name] = int64(f.UncompressedSize64)
	}
	if size, ok := files["logs/engine.log"]; !ok || size != engineLogTail {
		t.Fatalf("engine.log 应只收最后 %d 字节: %v", engineLogTail, files)
	}
	if _, ok := files["logs/"+CrashLog]; !ok {
		t.Fatalf("应收录 crash.log: %v", files)
	}
	for _, name := range []string{"logs/engine.log.out", "logs/" + runningMarker} {
		if _, ok := files[name]; ok {
			t.Fatalf("不应收录 %s", name)
		}
	}
}

func TestCrashReportNames(t *testing.T) {
	for name, want := range map[string]bool{
		"audiocpp_server-2026-11-24-101010":   true,
		"VoiceWorkbenchMac-2026-11-24-101010": true,
		"yovoice-service-2026-11-24-101010":   true,
		"Safari-2026-11-24-101010":            false,
		"audiocpp_serverx-2026":               false,
	} {
		if isCrashOf(name, "-") != want {
			t.Errorf("isCrashOf(%q) = %v", name, !want)
		}
	}
	for name, want := range map[string]bool{
		"yovoice.exe_3f2a_1":       true,
		"yovoice-service.e_8c1d_2": true,
		"audiocpp_server.exe_aa_3": true,
		"yovoicehelper.exe_aa_3":   false,
	} {
		if isCrashOf(name, ".") != want {
			t.Errorf("isCrashOf(%q, \".\") = %v", name, !want)
		}
	}
}
