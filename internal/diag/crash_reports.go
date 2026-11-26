package diag

import (
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"time"
)

// crashProcesses 是本应用各进程的可执行文件名（不含扩展名）：原生宿主、本地服务与推理引擎。
var crashProcesses = []string{"VoiceWorkbenchMac", "yovoice", "yovoice-service", "audiocpp_server"}

// crashReportWindow 内的系统崩溃报告才收进诊断包，crashReportLimit 是最多收录的份数（新的优先）。
const (
	crashReportWindow = 30 * 24 * time.Hour
	crashReportLimit  = 5
)

// crashReports 找出系统为本应用进程记录的崩溃报告：macOS 在 ~/Library/Logs/DiagnosticReports（.ips / .crash），
// Windows 的错误报告在 %LOCALAPPDATA%\Microsoft\Windows\WER 下按 AppCrash_<程序>_… 分目录存放 Report.wer。
// Linux 的核心转储由系统服务管理，普通用户通常读不到，不收录。
// 返回的键是诊断包里的文件名：Windows 的报告都叫 Report.wer，改用所在目录名区分。
func crashReports(now time.Time) map[string]string {
	type report struct {
		name, path string
		at         time.Time
	}
	var found []report
	add := func(name, path string, info os.FileInfo) {
		if info.Mode().IsRegular() && now.Sub(info.ModTime()) <= crashReportWindow {
			found = append(found, report{name, path, info.ModTime()})
		}
	}
	switch runtime.GOOS {
	case "darwin":
		home, err := os.UserHomeDir()
		if err != nil {
			return nil
		}
		dir := filepath.Join(home, "Library", "Logs", "DiagnosticReports")
		items, _ := os.ReadDir(dir)
		for _, item := range items {
			name := item.Name()
			ext := filepath.Ext(name)
			if (ext != ".ips" && ext != ".crash") || !isCrashOf(strings.TrimSuffix(name, ext), "-") {
				continue
			}
			if info, err := item.Info(); err == nil {
				add(name, filepath.Join(dir, name), info)
			}
		}
	case "windows":
		local := os.Getenv("LOCALAPPDATA")
		if local == "" {
			return nil
		}
		for _, sub := range []string{"ReportArchive", "ReportQueue"} {
			dir := filepath.Join(local, "Microsoft", "Windows", "WER", sub)
			items, _ := os.ReadDir(dir)
			for _, item := range items {
				name := item.Name()
				// 目录名里的程序名可能被截断，如 AppCrash_yovoice-service.e_<摘要>_<编号>。
				program, ok := strings.CutPrefix(name, "AppCrash_")
				if !item.IsDir() || !ok || !isCrashOf(program, ".") {
					continue
				}
				path := filepath.Join(dir, name, "Report.wer")
				if info, err := os.Stat(path); err == nil {
					add(name+".wer", path, info)
				}
			}
		}
	}
	slices.SortFunc(found, func(a, b report) int { return b.at.Compare(a.at) })
	reports := map[string]string{}
	for _, r := range found[:min(len(found), crashReportLimit)] {
		reports[r.name] = r.path
	}
	return reports
}

// isCrashOf 判断报告名是否以本应用某个进程名开头，后面紧跟分隔符（如 audiocpp_server-2026-11-24-101010），不区分大小写。
func isCrashOf(name, separator string) bool {
	name = strings.ToLower(name)
	for _, process := range crashProcesses {
		if rest, ok := strings.CutPrefix(name, strings.ToLower(process)); ok && strings.HasPrefix(rest, separator) {
			return true
		}
	}
	return false
}
