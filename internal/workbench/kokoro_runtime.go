package workbench

import (
	"context"
	"encoding/json"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strings"
	"yovoice/internal/catalog"
	"yovoice/internal/download"
	"yovoice/internal/engine"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
)

// kokoroStamp 记录已安装发音库对应的 wheel 摘要，清单更新后据此重新下载。
const kokoroStamp = "kokoro-runtime.json"

// kokoroMissing 返回尚需下载的发音库 wheel；已安装且与清单一致时为空。
func kokoroMissing(root string) ([]catalog.KokoroWheel, error) {
	wheels, err := catalog.KokoroWheels()
	if err != nil {
		return nil, err
	}
	want, err := json.Marshal(wheels)
	if err != nil {
		return nil, err
	}
	if got, err := os.ReadFile(filepath.Join(engine.KokoroDir(root), kokoroStamp)); err == nil && string(got) == string(want) && engine.KokoroReady(root) {
		return nil, nil
	}
	return wheels, nil
}

// installKokoro 下载 wheel 并只解出原生库与 eSpeak 数据，整体替换发音库目录。
// progress 报告本次下载的累计字节数与总字节数。
func (w *Workbench) installKokoro(ctx context.Context, source string, progress func(received, total int64)) error {
	// 模型下载与生成都可能触发安装，串行执行并在拿到锁后重新判断。
	w.kokoro.Lock()
	defer w.kokoro.Unlock()
	wheels, err := kokoroMissing(w.Store.Root)
	if err != nil || len(wheels) == 0 {
		return err
	}
	var total int64
	for _, wheel := range wheels {
		total += wheel.Size
	}
	dir := engine.KokoroDir(w.Store.Root)
	if err = os.MkdirAll(filepath.Dir(dir), 0700); err != nil {
		return err
	}
	staging, err := os.MkdirTemp(filepath.Dir(dir), "kokoro-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(staging)
	libraries := engine.KokoroLibraries()
	var done int64
	for _, wheel := range wheels {
		url, err := wheel.URL(source)
		if err != nil {
			return err
		}
		archive := filepath.Join(w.Store.Root, "downloads", path.Base(wheel.Path))
		if err = download.File(ctx, w.client, url, archive, wheel.SHA256, wheel.Size, func(received, _ int64) { progress(done+received, total) }); err != nil {
			return err
		}
		if err = download.ExtractFiles(ctx, archive, staging, func(name string) string { return kokoroFile(wheel.Project, name, libraries) }); err != nil {
			return err
		}
		_ = os.Remove(archive)
		done += wheel.Size
	}
	stamp, err := json.Marshal(wheels)
	if err != nil {
		return err
	}
	if err = os.WriteFile(filepath.Join(staging, kokoroStamp), stamp, 0600); err != nil {
		return err
	}
	// 旧目录先改名留作后备，新目录就位后再删；中途失败改回原名，不会出现两边都没有的情况。
	// 后备目录同样以 kokoro- 开头，进程意外退出时由启动清理回收。
	previous := ""
	if _, err = os.Stat(dir); err == nil {
		previous, err = os.MkdirTemp(filepath.Dir(dir), "kokoro-previous-")
		if err != nil {
			return err
		}
		_ = os.Remove(previous)
		if err = os.Rename(dir, previous); err != nil {
			return err
		}
	}
	if err = os.Rename(staging, dir); err != nil {
		if previous != "" {
			_ = os.Rename(previous, dir)
		}
		return err
	}
	if previous != "" {
		_ = os.RemoveAll(previous)
	}
	if !engine.KokoroReady(w.Store.Root) {
		return msg.Err(msg.ErrRuntimeMissing, nil)
	}
	return nil
}

// kokoroFile 把 wheel 中需要的条目映射到发音库目录内的相对路径，其他条目返回空串。
// espeakng-loader 提供 eSpeak 动态库与数据；fugashi 只取 MeCab 动态库并统一改名。
func kokoroFile(project, name string, libraries [2]string) string {
	base := path.Base(name)
	switch project {
	case "espeakng-loader":
		if name == "espeakng_loader/"+libraries[0] {
			return libraries[0]
		}
		if data, ok := strings.CutPrefix(name, "espeakng_loader/espeak-ng-data/"); ok && data != "" {
			return "espeak-ng-data/" + data
		}
	case "fugashi":
		if strings.HasPrefix(base, "libmecab") && (strings.HasSuffix(base, ".dylib") || strings.HasSuffix(base, ".dll") || strings.Contains(base, ".so.")) {
			return libraries[1]
		}
	}
	return ""
}

// ensureKokoro 在生成前补齐发音库：从内置发音库的旧版本升级后，已安装的 Kokoro 模型仍可直接生成。
func (w *Workbench) ensureKokoro(ctx context.Context, s schema.State, parts []synthesisPart) error {
	if !slices.ContainsFunc(parts, func(p synthesisPart) bool {
		m, err := catalog.Lookup(p.model.ID)
		return err == nil && m.Family == "kokoro_tts"
	}) {
		return nil
	}
	return w.installKokoro(ctx, s.Preferences.DownloadSource, func(received, total int64) {
		w.progress(msg.ActivityDownloading, msg.Params{"name": "Kokoro"}, received, total)
	})
}
