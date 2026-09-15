package workbench

import (
	"os"
	"os/exec"
	"strconv"
	"syscall"
	"unsafe"
)

func Lock(path string) (*os.File, error) {
	p, e := syscall.UTF16PtrFromString(path)
	if e != nil {
		return nil, e
	}
	h, e := syscall.CreateFile(p, syscall.GENERIC_READ|syscall.GENERIC_WRITE, 0, nil, syscall.OPEN_ALWAYS, syscall.FILE_ATTRIBUTE_NORMAL, 0)
	if e != nil {
		return nil, e
	}
	return os.NewFile(uintptr(h), path), nil
}
func configureProcess(c *exec.Cmd) {
	c.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
}
func killProcess(c *exec.Cmd) {
	if c.Process != nil {
		p := exec.Command("taskkill", "/PID", strconv.Itoa(c.Process.Pid), "/T", "/F")
		configureProcess(p)
		_ = p.Run()
		_ = c.Process.Kill()
	}
}
func freeSpace(path string) (uint64, error) {
	p, e := syscall.UTF16PtrFromString(path)
	if e != nil {
		return 0, e
	}
	var available uint64
	r, _, e := syscall.NewLazyDLL("kernel32.dll").NewProc("GetDiskFreeSpaceExW").Call(uintptr(unsafe.Pointer(p)), uintptr(unsafe.Pointer(&available)), 0, 0)
	if r == 0 {
		return 0, e
	}
	return available, nil
}
