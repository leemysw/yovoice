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

func TestAdoptModelsVerifiesEveryFileAndKeepsOwnershipExternal(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	dir := t.TempDir()
	content := []byte("good")
	files := []catalog.ModelFile{modelTestFile("main.gguf", content), modelTestFile("config.json", content)}
	model := catalog.ModelPackage{ID: "package", Directory: "package", RemotePath: files[0].Path, Files: files}
	modelDir := filepath.Join(dir, model.Directory)
	must(t, os.Mkdir(modelDir, 0700))
	must(t, os.WriteFile(filepath.Join(modelDir, files[0].Path), content, 0600))
	must(t, os.WriteFile(filepath.Join(modelDir, files[1].Path), []byte("fake"), 0600))
	must(t, w.adoptModels(context.Background(), dir, []catalog.ModelPackage{model}))
	if len(w.Store.Read().Models) != 0 {
		t.Fatal("同样大小的损坏文件不应登记")
	}
	must(t, os.WriteFile(filepath.Join(modelDir, files[1].Path), content, 0600))
	must(t, w.adoptModels(context.Background(), dir, []catalog.ModelPackage{model}))
	installed, ok := installedModel(w.Store.Read(), model.ID)
	if !ok || installed.Managed || installed.SHA256 != files[0].SHA256 {
		t.Fatal(installed)
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
