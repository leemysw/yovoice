// Package diag 写入滚动诊断日志；日志失败不影响业务结果。
package diag

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"runtime/debug"
	"strings"
	"sync"
	"time"
	"yovoice/internal/msg"
)

var diagnosticMu sync.Mutex

// 日志里的用户主目录替换为 ~，诊断包可以直接发给别人；取不到主目录时不替换。
var home = func() []byte {
	dir, err := os.UserHomeDir()
	if err != nil || len(dir) < 4 {
		return nil
	}
	b, _ := json.Marshal(dir)
	return b[1 : len(b)-1]
}()

// Level 按事件名和错误字段推断级别：带非空 error 或失败类事件为 ERROR，跳过、慢调用等为 WARN。
func Level(event string, fields ...any) slog.Level {
	for i := 0; i+1 < len(fields); i += 2 {
		if key, ok := fields[i].(string); ok && key == "error" && !isNil(fields[i+1]) {
			return slog.LevelError
		}
	}
	for _, suffix := range []string{"_failed", "_rejected", "_denied", ".failed", ".corrupt", ".error", ".crashed", ".panic"} {
		if strings.HasSuffix(event, suffix) {
			return slog.LevelError
		}
	}
	for _, suffix := range []string{"_skipped", ".slow", "_invalid", "_killed", ".exited", ".warning", "_timeout"} {
		if strings.HasSuffix(event, suffix) {
			return slog.LevelWarn
		}
	}
	return slog.LevelInfo
}

func isNil(v any) bool {
	if v == nil {
		return true
	}
	switch value := v.(type) {
	case map[string]any:
		return value == nil
	case error:
		return value == nil
	}
	return false
}

// 每条日志独立落盘，滚动保留上一份；日志失败不改变业务结果。
func Log(root, event string, fields ...any) {
	var line bytes.Buffer
	slog.New(slog.NewJSONHandler(&line, nil)).Log(context.Background(), Level(event, fields...), event, fields...)
	out := line.Bytes()
	if home != nil {
		out = bytes.ReplaceAll(out, home, []byte("~"))
	}
	diagnosticMu.Lock()
	defer diagnosticMu.Unlock()
	path := filepath.Join(root, "logs", "service.log")
	if info, err := os.Stat(path); err == nil && info.Size() >= serviceLogLimit {
		_ = os.Remove(path + ".1")
		if err = os.Rename(path, path+".1"); err != nil {
			fmt.Fprintln(os.Stderr, "日志轮转失败:", err)
			return
		}
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		fmt.Fprintln(os.Stderr, "日志写入失败:", err)
		return
	}
	defer f.Close()
	_, _ = f.Write(out)
}

const serviceLogLimit = 5 << 20

// 子进程输出日志统一追加到同一文件：超过 5MB 时滚动为 .1，每轮启动写一行分隔，
// 既能看到崩溃前后的连续记录，也不会每次启动都切出新文件。
const processLogLimit = 5 << 20

func OpenProcessLog(path, title string) (*os.File, error) {
	if info, err := os.Stat(path); err == nil && info.Size() >= processLogLimit {
		_ = os.Remove(path + ".1")
		_ = os.Rename(path, path+".1")
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		return nil, err
	}
	_, _ = fmt.Fprintf(f, "\n===== %s %s =====\n", time.Now().Format(time.RFC3339), title)
	return f, nil
}

// Go 在新 goroutine 中运行 fn：后台任务里的 panic 记成 <name>.panic 事件（带堆栈），不让整个服务退出。
func Go(root, name string, fn func()) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				Log(root, name+".panic", "panic", fmt.Sprint(r), "stack", string(debug.Stack()))
			}
		}()
		fn()
	}()
}

// Catch 运行 fn 并把其中的 panic 转成错误返回：后台操作据此报告失败，而不是让服务崩溃或让调用方永远等不到结果。
func Catch(root, name string, fn func() error) (err error) {
	defer func() {
		if r := recover(); r != nil {
			Log(root, name+".panic", "panic", fmt.Sprint(r), "stack", string(debug.Stack()))
			err = msg.Err(msg.ErrUnknown, msg.Params{"detail": fmt.Sprintf("panic: %v", r)})
		}
	}()
	return fn()
}

// 业务错误保留稳定错误码及参数，普通错误保留底层系统原因。
func Error(err error) any {
	if err == nil {
		return nil
	}
	return msg.Encode(err)
}
