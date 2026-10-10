package workbench

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"yovoice/internal/catalog"
	"yovoice/internal/download"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
)

// RuntimeReady 判断已安装内核与所选后端一致，且版本不低于当前应用要求的最低版本。
// 应用升级后仍可沿用满足最低版本的内核，升级到推荐版本由用户选择。
func RuntimeReady(s schema.State) bool {
	return s.RuntimePath != nil && value(s.RuntimeBackend) == s.Preferences.Backend && catalog.VersionAtLeast(value(s.RuntimeVersion), catalog.EngineMinimum)
}

func useRuntime(s *schema.State, path, backend, version string) {
	s.RuntimePath, s.RuntimeBackend, s.RuntimeVersion = ptr(path), ptr(backend), ptr(version)
}

// bundledRuntime 是安装包内置的内核；版本取自打包时写入的 yovoice-engine.json。
// 应用更新包不含内核，内置内核可能低于当前推荐版本。
type bundledRuntime struct{ path, version string }

// UseBundled 在服务启动时登记安装包内置的内核。内核同时支持 CPU，因此也登记为 CPU 内核。
// 首次启动直接采用并选中其后端；之后仅在所选后端相同、且现有内核缺失或不比它新时接管，
// 保留用户在设置中另行安装或升级的内核。
func (w *Workbench) UseBundled(path string) error {
	info, err := os.Stat(path)
	if os.IsNotExist(err) || path == "" {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return msg.Err(msg.ErrCPUBundleInvalid, nil)
	}
	// 缺少描述文件的旧安装视为 CPU 内核且版本未知，界面会提示更新。
	manifest := struct{ Version, Backend string }{Backend: "cpu"}
	if b, e := os.ReadFile(filepath.Join(filepath.Dir(path), "yovoice-engine.json")); e == nil {
		if e = json.Unmarshal(bytes.TrimPrefix(b, []byte("\xef\xbb\xbf")), &manifest); e != nil {
			return msg.Err(msg.ErrCPUBundleInvalid, nil)
		}
	} else if !os.IsNotExist(e) {
		return e
	}
	backends := []string{manifest.Backend}
	if manifest.Backend != "cpu" {
		backends = append(backends, "cpu")
	}
	for _, b := range backends {
		w.bundled[b] = bundledRuntime{path, manifest.Version}
	}
	return w.Store.Update(func(s *schema.State) {
		if s.RuntimePath == nil {
			s.Preferences.Backend = manifest.Backend
		}
		w.selectRuntime(s)
	}, true)
}

// selectRuntime 为所选后端挑选内核：优先沿用当前内核，其次是此前为该后端下载安装的内核，
// 内置内核更新或其余内核缺失时改用内置内核；都没有时保持原状，由界面提示安装。
func (w *Workbench) selectRuntime(s *schema.State) bool {
	w.rememberRuntime(s)
	backend := s.Preferences.Backend
	path, version := "", ""
	if s.RuntimePath != nil && value(s.RuntimeBackend) == backend && exists(*s.RuntimePath) {
		path, version = *s.RuntimePath, value(s.RuntimeVersion)
	} else if r, ok := s.Runtimes[backend]; ok && exists(r.Path) {
		path, version = r.Path, r.Version
	}
	if bundled, ok := w.bundled[backend]; ok && (path == "" || path == bundled.path || !catalog.VersionAtLeast(version, bundled.version)) {
		path, version = bundled.path, bundled.version
	}
	if path == "" {
		return false
	}
	useRuntime(s, path, backend, version)
	return true
}

// rememberRuntime 登记当前使用的下载内核，旧版本数据切换设备前也能保留已安装的 GPU 内核。
func (w *Workbench) rememberRuntime(s *schema.State) {
	if s.RuntimePath == nil || s.RuntimeBackend == nil {
		return
	}
	for _, bundled := range w.bundled {
		if bundled.path == *s.RuntimePath {
			return
		}
	}
	if s.Runtimes == nil {
		s.Runtimes = map[string]schema.InstalledRuntime{}
	}
	s.Runtimes[*s.RuntimeBackend] = schema.InstalledRuntime{Path: *s.RuntimePath, Version: value(s.RuntimeVersion)}
}
func (w *Workbench) InstallRuntime() error {
	backend := w.Store.Read().Preferences.Backend
	archives, e := catalog.RuntimeArchives(backend)
	if e != nil {
		return e
	}
	return w.begin("runtime", msg.ActivityRuntimeDownload, nil, nil, func(ctx context.Context) (err error) {
		w.engine.Stop()
		staging, err := os.MkdirTemp(filepath.Join(w.Store.Root, "runtime"), catalog.EngineVersion+"-"+backend+"-")
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
			if err = download.File(ctx, w.client, "https://github.com/0xShug0/audio.cpp/releases/download/"+catalog.EngineVersion+"/"+a.Name, file, a.Hash, 0, func(r, t int64) { w.progress(msg.ActivityRuntimeDownload, nil, r, t) }); err != nil {
				return err
			}
			w.progress(msg.ActivityRuntimeExtract, nil, 0, 0)
			if err = download.Extract(ctx, file, staging); err != nil {
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
			return msg.Err(msg.ErrRuntimeUnique, nil)
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
		if err = w.Store.Update(func(s *schema.State) {
			useRuntime(s, executable, backend, catalog.EngineVersion)
			w.rememberRuntime(s)
		}, true); err != nil {
			return err
		}
		// 每次安装解压到新目录，旧版本已不再引用，及时清理避免重复安装持续占用磁盘。
		w.removeStaleRuntimes()
		return nil
	})
}

// adoptRuntimes 登记数据目录中已解压、但状态未记录的内核：旧版本切换计算设备时会丢失
// GPU 内核的登记，文件仍在时按“版本-后端-随机数”目录名找回，每个后端取版本最新的一个。
func (w *Workbench) adoptRuntimes() error {
	s := w.Store.Read()
	entries, err := os.ReadDir(filepath.Join(w.Store.Root, "runtime"))
	if err != nil {
		return nil
	}
	name := "audiocpp_server"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	found := map[string]schema.InstalledRuntime{}
	for _, entry := range entries {
		if !entry.IsDir() || !runtimeDir.MatchString(entry.Name()) {
			continue
		}
		parts := strings.Split(entry.Name(), "-")
		version, backend := parts[0], parts[1]
		if r, ok := s.Runtimes[backend]; ok && exists(r.Path) {
			continue
		}
		if r, ok := found[backend]; ok && catalog.VersionAtLeast(r.Version, version) {
			continue
		}
		executables := []string{}
		_ = filepath.WalkDir(filepath.Join(w.Store.Root, "runtime", entry.Name()), func(p string, d os.DirEntry, e error) error {
			if e == nil && !d.IsDir() && d.Name() == name {
				executables = append(executables, p)
			}
			return nil
		})
		if len(executables) == 1 {
			found[backend] = schema.InstalledRuntime{Path: executables[0], Version: version}
		}
	}
	if len(found) == 0 {
		return nil
	}
	return w.Store.Update(func(s *schema.State) {
		if s.Runtimes == nil {
			s.Runtimes = map[string]schema.InstalledRuntime{}
		}
		for backend, r := range found {
			s.Runtimes[backend] = r
		}
	}, true)
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// recordLegacyRuntimeVersion 为旧版本安装、未记录版本的内核补记版本：数据目录中的
// 内核安装目录以“版本-后端-随机数”命名，可直接取得版本，用户无需重新下载。
func (w *Workbench) recordLegacyRuntimeVersion() error {
	s := w.Store.Read()
	if s.RuntimePath == nil || s.RuntimeVersion != nil {
		return nil
	}
	rel, err := filepath.Rel(filepath.Join(w.Store.Root, "runtime"), *s.RuntimePath)
	if err != nil {
		return nil
	}
	dir, _, _ := strings.Cut(filepath.ToSlash(rel), "/")
	if !runtimeDir.MatchString(dir) {
		return nil
	}
	version, _, _ := strings.Cut(dir, "-")
	return w.Store.Update(func(s *schema.State) {
		if s.RuntimeVersion == nil {
			s.RuntimeVersion = ptr(version)
		}
	}, true)
}
