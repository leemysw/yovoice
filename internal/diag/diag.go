// Package diag 写入滚动诊断日志；日志失败不影响业务结果。
package diag

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"yovoice/internal/msg"
)

var diagnosticMu sync.Mutex

// 每条日志独立落盘，滚动保留上一份；日志失败不改变业务结果。
func Log(root, event string, fields ...any) {
	diagnosticMu.Lock()
	defer diagnosticMu.Unlock()
	path := filepath.Join(root, "logs", "service.log")
	if info, err := os.Stat(path); err == nil && info.Size() >= 5<<20 {
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
	slog.New(slog.NewJSONHandler(f, nil)).Info(event, fields...)
}

// 业务错误保留稳定错误码及参数，普通错误保留底层系统原因。
func Error(err error) any {
	if err == nil {
		return nil
	}
	return msg.Encode(err)
}
