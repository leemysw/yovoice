package diag

import (
	"archive/zip"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestLevelInference(t *testing.T) {
	cases := []struct {
		event  string
		fields []any
		want   slog.Level
	}{
		{"generation.saved", []any{"error", nil}, slog.LevelInfo},
		{"operation.finished", []any{"error", map[string]any{"code": "x"}}, slog.LevelError},
		{"state.write_failed", nil, slog.LevelError},
		{"rpc.slow", nil, slog.LevelWarn},
		{"engine.exited", nil, slog.LevelWarn},
		{"engine.start_timeout", nil, slog.LevelWarn},
		{"project.export", []any{"error", errors.New("disk")}, slog.LevelError},
	}
	for _, c := range cases {
		if got := Level(c.event, c.fields...); got != c.want {
			t.Errorf("%s: 得到 %v，应为 %v", c.event, got, c.want)
		}
	}
}

func TestQueryFiltersAcrossRotationAndRedactsHome(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "logs"), 0700); err != nil {
		t.Fatal(err)
	}
	saved := home
	home = []byte("/Users/someone")
	defer func() { home = saved }()
	// 旧文件里的记录在滚动后仍能查到，排在新记录之后。
	Log(root, "generation.saved", "project_id", "p1", "path", "/Users/someone/.yovoice/outputs/a.wav")
	logs := filepath.Join(root, "logs", "service.log")
	if err := os.Rename(logs, logs+".1"); err != nil {
		t.Fatal(err)
	}
	Log(root, "rpc.slow", "method", "project.export")
	Log(root, "project.export", "id", "p1", "error", errors.New("disk full"))
	if err := os.WriteFile(logs, append(must(os.ReadFile(logs)), []byte("不是 JSON\n")...), 0600); err != nil {
		t.Fatal(err)
	}
	all, err := Query(root, Filter{})
	if err != nil {
		t.Fatal(err)
	}
	if all.Total != 3 || all.Entries[0].Event != "project.export" || all.Entries[2].Event != "generation.saved" {
		t.Fatalf("应按时间倒序合并两份日志: %+v", all.Entries)
	}
	if path := all.Entries[2].Fields["path"]; path != "~/.yovoice/outputs/a.wav" {
		t.Fatalf("主目录应替换为 ~: %v", path)
	}
	if strings.Join(all.Modules, ",") != "generation,project,rpc" {
		t.Fatalf("模块列表: %v", all.Modules)
	}
	warn, _ := Query(root, Filter{Level: "warn"})
	if warn.Total != 2 || warn.Entries[0].Level != "ERROR" || warn.Entries[1].Level != "WARN" {
		t.Fatalf("级别下限筛选: %+v", warn.Entries)
	}
	byModule, _ := Query(root, Filter{Module: "project"})
	byText, _ := Query(root, Filter{Text: "DISK FULL"})
	if byModule.Total != 1 || byText.Total != 1 || byText.Entries[0].Event != "project.export" {
		t.Fatal("模块与关键词筛选错误")
	}
	paged, _ := Query(root, Filter{Offset: 1, Limit: 1})
	if paged.Total != 3 || len(paged.Entries) != 1 || paged.Entries[0].Event != "rpc.slow" {
		t.Fatalf("分页错误: %+v", paged)
	}
	future, _ := Query(root, Filter{Since: time.Now().Add(time.Hour)})
	if future.Total != 0 || future.Entries == nil {
		t.Fatal("时间筛选后应返回空列表而不是 null")
	}
	empty, err := Query(t.TempDir(), Filter{})
	if err != nil || empty.Total != 0 {
		t.Fatal("没有日志时返回空页", err)
	}
}

func TestBundleSkipsEngineStdout(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "logs"), 0700); err != nil {
		t.Fatal(err)
	}
	saved := home
	home = []byte(`C:\\Users\\someone`)
	defer func() { home = saved }()
	for name, content := range map[string]string{"service.log": "{}\n", "host-service.log": `start C:\Users\someone\yovoice` + "\n", "engine.log": "raw", "engine.log.out": "raw"} {
		if err := os.WriteFile(filepath.Join(root, "logs", name), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	path := filepath.Join(t.TempDir(), "diagnostics.zip")
	if err := Bundle(root, path, "0.2.1"); err != nil {
		t.Fatal(err)
	}
	archive, err := zip.OpenReader(path)
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	var names []string
	for _, file := range archive.File {
		names = append(names, file.Name)
		if file.Name == "logs/host-service.log" {
			r, _ := file.Open()
			b := make([]byte, 64)
			n, _ := r.Read(b)
			_ = r.Close()
			if string(b[:n]) != "start ~\\yovoice\n" {
				t.Fatalf("宿主日志的主目录应替换: %q", b[:n])
			}
		}
	}
	if strings.Join(names, ",") != "about.txt,logs/host-service.log,logs/service.log,logs/engine.log" {
		t.Fatalf("诊断包内容: %v", names)
	}
}

func must(b []byte, err error) []byte {
	if err != nil {
		panic(err)
	}
	return b
}
