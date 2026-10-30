//go:build !windows

package platform

import (
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
)

func Lock(path string) (*os.File, error) {
	f, e := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		return nil, e
	}
	if e = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); e != nil {
		f.Close()
		return nil, e
	}
	return f, nil
}
func ConfigureProcess(c *exec.Cmd) { c.SysProcAttr = &syscall.SysProcAttr{Setpgid: true} }

// KillProcess 结束子进程所在的整个进程组；进程组已不存在（未以 Setpgid 启动或组长已退出）时回退为只结束该进程。
// os.Process.Kill 在进程已被 Wait 回收后不会再按 PID 发信号，不会误伤复用了 PID 的其他程序。
func KillProcess(c *exec.Cmd) {
	if c.Process != nil {
		if e := syscall.Kill(-c.Process.Pid, syscall.SIGKILL); e != nil {
			_ = c.Process.Kill()
		}
	}
}
func FreeSpace(path string) (uint64, error) {
	var s syscall.Statfs_t
	e := syscall.Statfs(path, &s)
	return s.Bavail * uint64(s.Bsize), e
}

// TieToParent 在 Windows 上把子进程绑定到当前进程的生命周期；类 Unix 系统依靠 ReapOrphan 在下次启动时清理。
func TieToParent(*exec.Cmd) error { return nil }

// ProcessCommand 返回进程的完整命令行，用于确认残留进程确实是本应用启动的。
func ProcessCommand(pid int) (string, error) {
	out, e := exec.Command("ps", "-ww", "-o", "command=", "-p", strconv.Itoa(pid)).Output()
	return strings.TrimSpace(string(out)), e
}

// KillGroup 结束以 pid 为组长的整个进程组（推理进程以 Setpgid 启动）。
func KillGroup(pid int) { _ = syscall.Kill(-pid, syscall.SIGKILL) }
