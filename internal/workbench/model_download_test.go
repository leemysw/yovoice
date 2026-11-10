package workbench

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
	"yovoice/internal/catalog"
	"yovoice/internal/download"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
)

type modelTestTransport func(*http.Request) (*http.Response, error)

func (f modelTestTransport) RoundTrip(req *http.Request) (*http.Response, error) { return f(req) }

func useModelTestServer(t *testing.T, w *Workbench, server *httptest.Server) {
	t.Helper()
	base, err := url.Parse(server.URL)
	must(t, err)
	w.client.Transport = modelTestTransport(func(req *http.Request) (*http.Response, error) {
		clone := req.Clone(req.Context())
		clone.URL.Scheme, clone.URL.Host, clone.Host = base.Scheme, base.Host, base.Host
		return server.Client().Transport.RoundTrip(clone)
	})
}

func modelTestFile(path string, content []byte) catalog.ModelFile {
	return catalog.ModelFile{Path: path, Size: int64(len(content)), SHA256: fmt.Sprintf("%x", sha256.Sum256(content))}
}

func TestModelDownloadsPauseResumeAndCancelIndependently(t *testing.T) {
	root := t.TempDir()
	w, err := New(root)
	must(t, err)
	defer func() { w.Close() }()
	content := bytes.Repeat([]byte("test weights"), 32000)
	latest := []byte("different model revision")
	old := modelTestFile("voice.gguf", content)
	newer := modelTestFile("voice.gguf", latest)
	definition := catalog.ModelPackage{
		ID: "voice", RemotePath: old.Path, SHA256: newer.SHA256, Size: newer.Size, Revision: "latest",
		History: []catalog.ModelVersion{{Revision: "old", ModelScopeRevision: "old", SHA256: old.SHA256, Size: old.Size}},
	}
	other := definition
	other.ID, other.RemotePath = "other", "other.gguf"
	first := make(chan struct{})
	resumed := make(chan string, 1)
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(out http.ResponseWriter, req *http.Request) {
		if strings.HasSuffix(req.URL.Path, "/other.gguf") {
			_, _ = out.Write(latest)
			return
		}
		if !strings.Contains(req.URL.Path, "/old/") {
			t.Errorf("续传误切换版本: %s", req.URL.Path)
			http.Error(out, "wrong revision", 400)
			return
		}
		out.Header().Set("ETag", `"old"`)
		if requests.Add(1) == 1 {
			out.Header().Set("Content-Length", fmt.Sprint(len(content)))
			_, _ = out.Write(content[:64000])
			out.(http.Flusher).Flush()
			close(first)
			<-req.Context().Done()
			return
		}
		resumed <- req.Header.Get("Range")
		http.ServeContent(out, req, "voice.gguf", time.Time{}, bytes.NewReader(content))
	}))
	defer server.Close()
	useModelTestServer(t, w, server)
	must(t, w.downloadCatalogModel(definition, old.SHA256))
	select {
	case <-first:
	case <-time.After(5 * time.Second):
		t.Fatal("下载未开始")
	}
	job := w.Store.Read().ModelDownloads[definition.ID]
	partial := filepath.Join(modelTransferPath(job), "voice.gguf.part")
	deadline := time.Now().Add(5 * time.Second)
	for download.FileSize(partial) < 64000 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	must(t, w.PauseModelDownload(definition.ID))
	<-w.ModelDone()
	if saved := w.Store.Read().ModelDownloads[definition.ID]; saved.Status != "paused" || saved.Received != 64000 || saved.Version != old.SHA256 {
		t.Fatal(saved)
	}
	must(t, w.downloadCatalogModel(other, ""))
	<-w.ModelDone()
	w.Close()

	w, err = New(root)
	must(t, err)
	useModelTestServer(t, w, server)
	must(t, w.SetModelDirectory(t.TempDir()))
	must(t, w.downloadCatalogModel(definition, ""))
	<-w.ModelDone()
	select {
	case header := <-resumed:
		if header != "bytes=64000-" {
			t.Fatal(header)
		}
	default:
		t.Fatal("没有续传请求")
	}
	s := w.Store.Read()
	installed, exists := installedModel(s, definition.ID)
	if !exists || !installed.Pinned || installed.SHA256 != old.SHA256 || filepath.Dir(installed.Path) != modelTransferPath(job) {
		t.Fatal(installed, s.ModelActivity)
	}
	if _, exists := s.ModelDownloads[definition.ID]; exists {
		t.Fatal("完成后不应保留任务")
	}

	// 取消已暂停的更新，只删除更新任务目录；历史版本和其他已安装模型照常可用。
	pending := schema.ModelDownload{Token: schema.NewID(), Directory: t.TempDir(), Version: newer.SHA256, Status: "paused"}
	stage := modelTransferPath(pending)
	must(t, os.Mkdir(stage, 0700))
	must(t, os.WriteFile(filepath.Join(stage, "voice.gguf.part"), []byte("partial"), 0600))
	must(t, w.Store.Update(func(s *schema.State) {
		s.ModelDownloads = map[string]schema.ModelDownload{definition.ID: pending}
	}, true))
	must(t, w.DiscardModelDownload(context.Background(), definition.ID))
	if _, err := os.Stat(stage); !os.IsNotExist(err) {
		t.Fatal(err)
	}
	if data, err := os.ReadFile(installed.Path); err != nil || !bytes.Equal(data, content) {
		t.Fatal(err)
	}
	if otherInstalled, ok := installedModel(w.Store.Read(), other.ID); !ok || !existsPath(otherInstalled.Path) {
		t.Fatal(otherInstalled)
	}
}

func TestModelPackageFailureKeepsPreviousAndDoesNotOverwriteLocalFiles(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	path := filepath.Join(w.Store.Root, "models", "old")
	must(t, os.Mkdir(path, 0700))
	must(t, os.WriteFile(filepath.Join(path, "main.gguf"), []byte("old weights"), 0600))
	must(t, os.WriteFile(filepath.Join(path, "config.json"), []byte("old config"), 0600))
	must(t, w.register("multi", path, false, "external-digest", false))
	must(t, w.register("managed", path, true, "old-digest", false))
	main, side := []byte("new weights"), []byte("new config")
	files := []catalog.ModelFile{modelTestFile("main.gguf", main), modelTestFile("config.json", side)}
	definition := catalog.ModelPackage{ID: "multi", RemotePath: "main.gguf", Size: files[0].Size + files[1].Size, Files: files}
	var bad atomic.Bool
	bad.Store(true)
	server := httptest.NewServer(http.HandlerFunc(func(out http.ResponseWriter, req *http.Request) {
		if strings.HasSuffix(req.URL.Path, "main.gguf") {
			_, _ = out.Write(main)
		} else if bad.Load() {
			_, _ = out.Write([]byte("bad config"))
		} else {
			_, _ = out.Write(side)
		}
	}))
	defer server.Close()
	useModelTestServer(t, w, server)
	if err := w.downloadCatalogModel(definition, ""); err == nil {
		t.Fatal("本地导入模型不应被下载覆盖")
	}
	definition.ID = "managed"
	must(t, w.downloadCatalogModel(definition, ""))
	<-w.ModelDone()
	state := w.Store.Read()
	failed := state.ModelDownloads[definition.ID]
	if installed, _ := installedModel(state, definition.ID); installed.Path != path || failed.Status != "failed" {
		t.Fatal(installed, failed)
	}
	if data, _ := os.ReadFile(filepath.Join(path, "main.gguf")); string(data) != "old weights" {
		t.Fatal(string(data))
	}
	bad.Store(false)
	must(t, w.downloadCatalogModel(definition, ""))
	<-w.ModelDone()
	installed, _ := installedModel(w.Store.Read(), definition.ID)
	if installed.Path == path || installed.Path != modelTransferPath(failed) {
		t.Fatal(installed)
	}
	for name, want := range map[string][]byte{"main.gguf": main, "config.json": side} {
		data, err := os.ReadFile(filepath.Join(installed.Path, name))
		must(t, err)
		if !bytes.Equal(data, want) {
			t.Fatal(name, string(data))
		}
	}
	must(t, w.ForgetModel("multi"))
	if _, err := os.Stat(path); err != nil {
		t.Fatal("移除登记不能删除外部包", err)
	}
}

func TestModelUpdateRetiresPreviousPackages(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	oldDir := t.TempDir()
	must(t, w.SetModelDirectory(oldDir))
	content := []byte("weights")
	main := modelTestFile("voice.gguf", content)
	definition := catalog.ModelPackage{
		ID: "voice", RemotePath: main.Path, Size: main.Size, SHA256: main.SHA256,
		History: []catalog.ModelVersion{{Revision: "old", ModelScopeRevision: "old", Size: 3, SHA256: modelTestFile("voice.gguf", []byte("old")).SHA256}},
	}
	legacy := filepath.Join(oldDir, main.Path)
	must(t, os.WriteFile(legacy, []byte("old"), 0600))
	must(t, w.register(definition.ID, legacy, true, definition.History[0].SHA256, false))
	// 改过默认目录后，更新也会回收留在原目录里的旧版布局。
	must(t, w.SetModelDirectory(t.TempDir()))
	server := httptest.NewServer(http.HandlerFunc(func(out http.ResponseWriter, req *http.Request) {
		body := content
		if strings.Contains(req.URL.Path, "/old/") {
			body = []byte("old")
		}
		_, _ = out.Write(body)
	}))
	defer server.Close()
	useModelTestServer(t, w, server)

	must(t, w.downloadCatalogModel(definition, ""))
	<-w.ModelDone()
	first, _ := installedModel(w.Store.Read(), definition.ID)
	if existsPath(legacy) || !existsPath(first.Path) || first.SHA256 != main.SHA256 {
		t.Fatal("更新后应移除旧版布局的文件", legacy, first)
	}

	must(t, w.downloadCatalogModel(definition, definition.History[0].SHA256))
	<-w.ModelDone()
	rolledBack, _ := installedModel(w.Store.Read(), definition.ID)
	if existsPath(filepath.Dir(first.Path)) || !existsPath(rolledBack.Path) || !rolledBack.Pinned {
		t.Fatal("回退后应移除上一版包目录", first, rolledBack)
	}
}

func TestModelUpdateRetainsHardLinkedCompanion(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	weights, config := []byte("new weights"), []byte("unchanged config")
	files := []catalog.ModelFile{modelTestFile("voice.gguf", weights), modelTestFile("config.json", config)}
	model := catalog.ModelPackage{ID: "multi", Directory: "pack", RemotePath: "voice.gguf", Size: files[0].Size + files[1].Size, Files: files}
	previous := filepath.Join(w.Store.Root, "models", model.Directory)
	must(t, os.Mkdir(previous, 0700))
	must(t, os.WriteFile(filepath.Join(previous, "voice.gguf"), []byte("old weights"), 0600))
	oldConfig := filepath.Join(previous, "config.json")
	must(t, os.WriteFile(oldConfig, config, 0600))
	must(t, w.register(model.ID, previous, true, "old", false))
	server := httptest.NewServer(http.HandlerFunc(func(out http.ResponseWriter, req *http.Request) {
		if strings.HasSuffix(req.URL.Path, "/config.json") {
			t.Error("不应重新下载通过校验的硬链接配套文件")
			http.Error(out, "unexpected request", http.StatusBadRequest)
			return
		}
		_, _ = out.Write(weights)
	}))
	defer server.Close()
	useModelTestServer(t, w, server)
	must(t, w.downloadCatalogModel(model, ""))
	<-w.ModelDone()
	installed, _ := installedModel(w.Store.Read(), model.ID)
	data, err := os.ReadFile(filepath.Join(installed.Path, "config.json"))
	if existsPath(previous) || err != nil || !bytes.Equal(data, config) {
		t.Fatal(installed, err)
	}
}

func TestModelDirectoryRecoversVerifiedPackages(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	dir := t.TempDir()
	content := []byte("good")
	files := []catalog.ModelFile{modelTestFile("main.gguf", content), modelTestFile("config.json", content)}
	pack := catalog.ModelPackage{ID: "package", Directory: "package", RemotePath: files[0].Path, Files: files}
	modelDir := modelTransferPath(schema.ModelDownload{Directory: dir, Token: schema.NewID()})
	must(t, os.Mkdir(modelDir, 0700))
	must(t, os.WriteFile(filepath.Join(modelDir, files[0].Path), content, 0600))
	must(t, os.WriteFile(filepath.Join(modelDir, files[1].Path), []byte("fake"), 0600))
	must(t, w.setModelDirectory(context.Background(), dir, []catalog.ModelPackage{pack}))
	<-w.Done()
	if len(w.Store.Read().Models) != 0 {
		t.Fatal("同样大小的损坏文件不应登记")
	}

	current := modelTestFile("voice.gguf", []byte("latest"))
	historical := modelTestFile("voice.gguf", []byte("old"))
	single := catalog.ModelPackage{
		ID: "voice", RemotePath: current.Path, Size: current.Size, SHA256: current.SHA256,
		History: []catalog.ModelVersion{{Size: historical.Size, SHA256: historical.SHA256}},
	}
	singleRoot := modelTransferPath(schema.ModelDownload{Directory: dir, Token: schema.NewID()})
	must(t, os.Mkdir(singleRoot, 0700))
	singlePath := filepath.Join(singleRoot, single.RemotePath)
	must(t, os.WriteFile(singlePath, []byte("old"), 0600))
	must(t, os.WriteFile(filepath.Join(modelDir, files[1].Path), content, 0600))

	legacyFile := modelTestFile("legacy.gguf", content)
	legacy := catalog.ModelPackage{ID: "legacy", RemotePath: legacyFile.Path, Size: legacyFile.Size, SHA256: legacyFile.SHA256}
	legacyPath := filepath.Join(dir, legacy.RemotePath)
	must(t, os.WriteFile(legacyPath, content, 0600))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	must(t, w.setModelDirectory(ctx, dir, []catalog.ModelPackage{pack, single, legacy}))
	cancel() // RPC 返回后取消请求上下文，不应中止后台任务。
	<-w.Done()
	state := w.Store.Read()
	for _, want := range []schema.InstalledModel{
		{ID: pack.ID, Path: modelDir, SHA256: files[0].SHA256, Managed: true},
		{ID: single.ID, Path: singlePath, SHA256: historical.SHA256, Managed: true},
		{ID: legacy.ID, Path: legacyPath, SHA256: legacyFile.SHA256, Managed: true},
	} {
		got, ok := installedModel(state, want.ID)
		if !ok || got != want {
			t.Fatal(got, want, state.Activity)
		}
	}
	if got, _ := installedModel(state, single.ID); !modelUpdateAvailable(got, single) {
		t.Fatal("恢复的旧版托管包应可更新")
	}
}

func TestModelDirectoryRecoveryCancellationKeepsFiles(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	dir := t.TempDir()
	content := []byte("good")
	file := modelTestFile("voice.gguf", content)
	model := catalog.ModelPackage{ID: "voice", RemotePath: file.Path, Size: file.Size, SHA256: file.SHA256}
	path := filepath.Join(dir, file.Path)
	must(t, os.WriteFile(path, content, 0600))
	w.mu.Lock()
	done, err := w.startLocked("import", msg.ActivityVerifying, nil, nil, func(ctx context.Context) error {
		return w.recoverModels(ctx, dir, nil, []catalog.ModelPackage{model})
	}, nil)
	if err == nil {
		w.cancel()
	}
	w.mu.Unlock()
	must(t, err)
	<-done
	s := w.Store.Read()
	if len(s.Models) != 0 || s.Activity.Status != "cancelled" || !existsPath(path) {
		t.Fatal(s.Activity, s.Models)
	}
}

func TestModelDirectoryKeepsPendingPackagesAndExtraFiles(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	dir := t.TempDir()
	content := []byte("good")
	file := modelTestFile("main.gguf", content)
	pack := catalog.ModelPackage{ID: "pack", Directory: "pack", RemotePath: file.Path, Files: []catalog.ModelFile{file}}
	legacy := filepath.Join(dir, pack.Directory)
	must(t, os.Mkdir(legacy, 0700))
	must(t, os.WriteFile(filepath.Join(legacy, file.Path), content, 0600))
	extra := filepath.Join(legacy, "my-notes.txt")
	must(t, os.WriteFile(extra, []byte("keep"), 0600))

	pending := schema.ModelDownload{Token: schema.NewID(), Directory: dir, Version: file.SHA256, Status: "paused"}
	must(t, os.Mkdir(modelTransferPath(pending), 0700))
	must(t, os.WriteFile(filepath.Join(modelTransferPath(pending), file.Path), content, 0600))
	must(t, w.Store.Update(func(s *schema.State) {
		s.ModelDownloads = map[string]schema.ModelDownload{"other": pending}
	}, true))
	// 外部盘断开后，选择新下载目录也不应覆盖原来的导入登记。
	offline := catalog.ModelPackage{ID: "offline", RemotePath: "offline.gguf", Size: file.Size, SHA256: file.SHA256}
	offlinePath := filepath.Join(t.TempDir(), offline.RemotePath)
	must(t, w.register(offline.ID, offlinePath, false, file.SHA256, false))
	must(t, os.WriteFile(filepath.Join(dir, offline.RemotePath), content, 0600))
	must(t, w.setModelDirectory(context.Background(), dir, []catalog.ModelPackage{pack, offline}))
	<-w.Done()
	installed, _ := installedModel(w.Store.Read(), pack.ID)
	if installed.Path != legacy || installed.Managed {
		t.Fatal("不能接管另一个任务的包或含用户文件的旧目录", installed)
	}
	if external, _ := installedModel(w.Store.Read(), offline.ID); external.Path != offlinePath || external.Managed {
		t.Fatal("断开的外部盘登记必须保留", external)
	}
	must(t, w.ForgetModel(pack.ID))
	if !existsPath(extra) || !existsPath(modelTransferPath(pending)) {
		t.Fatal("用户文件和暂停的任务必须保留")
	}
}

func TestCleanupExternalModelDirectoryPreservesUnrelatedFiles(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	dir := t.TempDir()
	must(t, w.SetModelDirectory(dir))
	old := time.Now().Add(-72 * time.Hour)
	for _, name := range []string{"user-recording.part", "user-data.deleting"} {
		path := filepath.Join(dir, name)
		must(t, os.WriteFile(path, []byte("user"), 0600))
		must(t, os.Chtimes(path, old, old))
	}
	job := schema.ModelDownload{Token: schema.NewID(), Directory: dir}
	stage := modelTransferPath(job)
	must(t, os.Mkdir(stage, 0700))
	must(t, os.Chtimes(stage, old, old))
	_, err = w.CleanupResiduals()
	must(t, err)
	if existsPath(stage) {
		t.Fatal("无引用的下载目录应清理")
	}
	for _, name := range []string{"user-recording.part", "user-data.deleting"} {
		if !existsPath(filepath.Join(dir, name)) {
			t.Fatal("不能清理用户的其他文件", name)
		}
	}
}

func TestCancelActiveModelDownloadStopsTransferAndKeepsInstallation(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	old := filepath.Join(w.Store.Root, "models", "current.gguf")
	must(t, os.WriteFile(old, []byte("old"), 0600))
	must(t, w.register("voice", old, true, "old", false))
	newer := modelTestFile("voice.gguf", []byte("new contents"))
	model := catalog.ModelPackage{ID: "voice", RemotePath: newer.Path, Size: newer.Size, SHA256: newer.SHA256}
	connected, stopped := make(chan struct{}), make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(out http.ResponseWriter, req *http.Request) {
		out.Header().Set("Content-Length", fmt.Sprint(newer.Size))
		_, _ = out.Write([]byte("new"))
		out.(http.Flusher).Flush()
		close(connected)
		<-req.Context().Done()
		close(stopped)
	}))
	defer server.Close()
	useModelTestServer(t, w, server)
	must(t, w.downloadCatalogModel(model, ""))
	select {
	case <-connected:
	case <-time.After(5 * time.Second):
		t.Fatal("下载未开始")
	}
	stage := modelTransferPath(w.Store.Read().ModelDownloads[model.ID])
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	must(t, w.DiscardModelDownload(ctx, model.ID))
	select {
	case <-stopped:
	case <-ctx.Done():
		t.Fatal("连接未关闭")
	}
	s := w.Store.Read()
	if len(s.ModelDownloads) != 0 || s.ModelActivity != nil || existsPath(stage) || s.Models[0].Path != old {
		t.Fatal(s.ModelDownloads, s.ModelActivity, s.Models)
	}
	data, err := os.ReadFile(old)
	must(t, err)
	if string(data) != "old" {
		t.Fatal(string(data))
	}
}
