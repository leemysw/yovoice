package workbench

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// UseBundledCPU 在服务启动时登记内置内核，保留用户已安装的 GPU 内核。
func (w *Workbench) UseBundledCPU(path string) error {
	info, err := os.Stat(path)
	if os.IsNotExist(err) || path == "" {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return Err(MsgErrCPUBundleInvalid, nil)
	}
	w.bundledCPU = path
	return w.Store.Update(func(s *State) {
		if s.RuntimePath == nil || s.Preferences.Backend == "cpu" {
			s.RuntimePath = ptr(path)
			s.RuntimeBackend = ptr("cpu")
		}
	}, true)
}
func (w *Workbench) install() error {
	backend := w.Store.Read().Preferences.Backend
	archives, e := runtimeArchives(backend)
	if e != nil {
		return e
	}
	return w.begin("runtime", MsgActivityRuntimeDownload, nil, nil, func(ctx context.Context) (err error) {
		w.engine.Stop()
		staging, err := os.MkdirTemp(filepath.Join(w.Store.Root, "runtime"), EngineVersion+"-"+backend+"-")
		if err != nil {
			return err
		}
		defer func() {
			if err != nil {
				_ = os.RemoveAll(staging)
			}
		}()
		for _, a := range archives {
			file := filepath.Join(w.Store.Root, "downloads", a.Name)
			if err = Download(ctx, w.client, "https://github.com/0xShug0/audio.cpp/releases/download/"+EngineVersion+"/"+a.Name, file, a.Hash, 0, func(r, t int64) { w.progress(MsgActivityRuntimeDownload, nil, r, t) }); err != nil {
				return err
			}
			w.progress(MsgActivityRuntimeExtract, nil, 0, 0)
			if err = Extract(ctx, file, staging); err != nil {
				return err
			}
		}
		name := "audiocpp_server"
		if runtime.GOOS == "windows" {
			name += ".exe"
		}
		executables := []string{}
		dlls := []string{}
		err = filepath.WalkDir(staging, func(p string, d os.DirEntry, e error) error {
			if e != nil {
				return e
			}
			if !d.IsDir() {
				if d.Name() == name {
					executables = append(executables, p)
				}
				if strings.EqualFold(filepath.Ext(p), ".dll") {
					dlls = append(dlls, p)
				}
			}
			return ctx.Err()
		})
		if err != nil {
			return err
		}
		if len(executables) != 1 {
			return Err(MsgErrRuntimeUnique, nil)
		}
		executable := executables[0]
		for _, dll := range dlls {
			target := filepath.Join(filepath.Dir(executable), filepath.Base(dll))
			if !strings.EqualFold(target, dll) {
				b, e := os.ReadFile(dll)
				if e != nil {
					return e
				}
				if e = os.WriteFile(target, b, 0600); e != nil {
					return e
				}
			}
		}
		if err = os.Chmod(executable, 0755); err != nil {
			return err
		}
		if err = ctx.Err(); err != nil {
			return err
		}
		return w.Store.Update(func(s *State) { s.RuntimePath = ptr(executable); s.RuntimeBackend = ptr(backend) }, true)
	})
}
