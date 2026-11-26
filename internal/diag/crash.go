package diag

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"strings"
	"time"
)

// 服务运行期间存在的标记文件：正常退出时删除，下次启动时还在说明上次没有正常退出（崩溃、被强制结束或断电）。
const runningMarker = "service.running"

// CrashLog 收集 Go 运行时的致命错误输出（未恢复的 panic、并发写 map 等），这类错误不经过 Log。
const CrashLog = "crash.log"

// crashLogLimit 是 crash.log 的上限：超过时只保留最后一段，反复崩溃也不会无限增长。
const crashLogLimit = 1 << 20

// MarkRunning 在服务启动时调用：上次的标记还在就记一条 service.crashed，再写入本次的标记，
// 并让运行时把致命错误追加到 logs/crash.log。返回的函数在正常退出时删除标记。
func MarkRunning(root string) func() {
	dir := filepath.Join(root, "logs")
	_ = os.MkdirAll(dir, 0700)
	marker := filepath.Join(dir, runningMarker)
	if previous, err := os.ReadFile(marker); err == nil {
		started := strings.TrimSpace(string(previous))
		Log(root, "service.crashed", "previous_start", started, "crash_log", recentCrash(filepath.Join(dir, CrashLog), started))
	}
	_ = os.WriteFile(marker, []byte(time.Now().UTC().Format(time.RFC3339)+"\n"), 0600)
	crash := filepath.Join(dir, CrashLog)
	trimCrashLog(crash)
	if f, err := os.OpenFile(crash, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600); err == nil {
		// SetCrashOutput 复制了文件描述符，这里关闭不影响之后的写入。
		_ = debug.SetCrashOutput(f, debug.CrashOptions{})
		_ = f.Close()
	}
	return func() { _ = os.Remove(marker) }
}

// recentCrash 判断上次运行期间 crash.log 是否有新内容，有则返回 "yes"，让日志里能区分程序崩溃和被强制结束。
func recentCrash(path, started string) string {
	at, err := time.Parse(time.RFC3339, started)
	info, statErr := os.Stat(path)
	if err != nil || statErr != nil || info.Size() == 0 || info.ModTime().Before(at) {
		return "no"
	}
	return "yes"
}

func trimCrashLog(path string) {
	content, err := os.ReadFile(path)
	if err != nil || len(content) <= crashLogLimit {
		return
	}
	_ = os.WriteFile(path, content[len(content)-crashLogLimit/2:], 0600)
}

// Crash 是最近一次异常退出：kind 为 service（应用服务没有正常退出）或 engine（推理引擎意外退出）。
type Crash struct {
	Time   time.Time `json:"time"`
	Kind   string    `json:"kind"`
	Family string    `json:"family,omitempty"`
}

// Problem 是诊断摘要里的一条错误：只有时间、事件名和错误码，不含正文、路径等细节。
type Problem struct {
	Time  time.Time `json:"time"`
	Event string    `json:"event"`
	Code  string    `json:"code,omitempty"`
}

// Report 是反馈问题用的诊断摘要，IssueURL 是预填了环境与最近错误的 GitHub 新建 issue 地址。
type Report struct {
	Crash    *Crash    `json:"crash,omitempty"`
	Problems []Problem `json:"problems"`
	IssueURL string    `json:"issueUrl"`
}

// Environment 是写进 issue 的运行环境。
type Environment struct {
	Version, Engine, Backend string
}

// reportWindow 内的异常退出与错误才写进摘要；更早的问题多半已经不相关。
const reportWindow = 7 * 24 * time.Hour

// issueProblems 是写进 issue 的错误条数上限，避免地址过长。
const issueProblems = 8

// Summarize 从服务日志里找出最近的异常退出和错误，生成反馈问题用的摘要。
func Summarize(root string, env Environment, now time.Time) (Report, error) {
	page, err := Query(root, Filter{Level: "warn", Since: now.Add(-reportWindow), Limit: queryLimit})
	if err != nil {
		return Report{}, err
	}
	report := Report{Problems: []Problem{}}
	for _, entry := range page.Entries {
		switch entry.Event {
		case "service.crashed":
			if report.Crash == nil {
				report.Crash = &Crash{Time: entry.Time, Kind: "service"}
			}
			continue
		case "engine.exited":
			// 推理引擎被应用主动停止时记为 engine.stopped；engine.exited 只在意外退出时出现。
			if report.Crash == nil {
				family, _ := entry.Fields["family"].(string)
				report.Crash = &Crash{Time: entry.Time, Kind: "engine", Family: family}
			}
			continue
		}
		if entry.Level != "ERROR" || len(report.Problems) >= issueProblems {
			continue
		}
		report.Problems = append(report.Problems, Problem{Time: entry.Time, Event: entry.Event, Code: errorCode(entry.Fields["error"])})
	}
	report.IssueURL = issueURL(env, report)
	return report, nil
}

// errorCode 只取业务错误码；普通系统错误可能带路径，不写进 issue。
func errorCode(value any) string {
	if fields, ok := value.(map[string]any); ok {
		if code, ok := fields["code"].(string); ok {
			return code
		}
	}
	return ""
}

func issueURL(env Environment, report Report) string {
	var body strings.Builder
	body.WriteString("### What happened / 发生了什么\n\n<!-- Steps to reproduce and what you expected. 复现步骤和预期结果。 -->\n\n")
	body.WriteString("### Diagnostics / 诊断包\n\n<!-- Drag the exported yovoice-diagnostics-*.zip here. 把导出的诊断包拖到这里。 -->\n\n")
	body.WriteString("### Environment / 环境\n\n")
	fmt.Fprintf(&body, "- yovoice: %s\n- OS: %s %s\n", orUnknown(env.Version), runtime.GOOS, runtime.GOARCH)
	fmt.Fprintf(&body, "- Engine: audio.cpp %s (%s)\n", orUnknown(env.Engine), orUnknown(env.Backend))
	if report.Crash != nil {
		kind := "app service did not exit normally"
		if report.Crash.Kind == "engine" {
			kind = "inference engine exited unexpectedly"
			if report.Crash.Family != "" {
				kind += " (" + report.Crash.Family + ")"
			}
		}
		fmt.Fprintf(&body, "- Last crash: %s, %s\n", report.Crash.Time.UTC().Format(time.RFC3339), kind)
	}
	if len(report.Problems) > 0 {
		body.WriteString("\n### Recent errors / 最近的错误\n\n")
		for _, p := range report.Problems {
			line := p.Time.UTC().Format(time.RFC3339) + " " + p.Event
			if p.Code != "" {
				line += " (" + p.Code + ")"
			}
			fmt.Fprintf(&body, "- `%s`\n", line)
		}
	}
	title := "[Bug] "
	if report.Crash != nil {
		title = "[Crash] "
	}
	query := url.Values{"title": {title}, "body": {body.String()}, "labels": {"bug"}}
	return "https://github.com/leemysw/yovoice/issues/new?" + query.Encode()
}

func orUnknown(value string) string {
	if strings.TrimSpace(value) == "" {
		return "unknown"
	}
	return value
}
