package workbench

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func must(t *testing.T, e error) {
	t.Helper()
	if e != nil {
		t.Fatal(e)
	}
}
func wav() []byte {
	b := make([]byte, 44+32000)
	copy(b, "RIFF")
	binary.LittleEndian.PutUint32(b[4:], uint32(len(b)-8))
	copy(b[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(b[16:], 16)
	binary.LittleEndian.PutUint16(b[20:], 1)
	binary.LittleEndian.PutUint16(b[22:], 1)
	binary.LittleEndian.PutUint32(b[24:], 16000)
	binary.LittleEndian.PutUint32(b[28:], 32000)
	binary.LittleEndian.PutUint16(b[32:], 2)
	binary.LittleEndian.PutUint16(b[34:], 16)
	copy(b[36:], "data")
	binary.LittleEndian.PutUint32(b[40:], 32000)
	return b
}
func invoke(t *testing.T, w *Workbench, method string, data any) any {
	t.Helper()
	b, e := json.Marshal(data)
	must(t, e)
	result, e := w.Call(method, b)
	must(t, e)
	return result
}
func TestRequests(t *testing.T) {
	d := DefaultDraft()
	for _, mode := range []string{"speaker", "reference", "vector", "text"} {
		d.Mode = mode
		payload, e := BuildRequest(d, "voice.wav", "emotion.wav")
		must(t, e)
		r := payload["request"].(map[string]any)
		o := r["options"].(map[string]any)
		switch mode {
		case "speaker":
			if _, ok := o["emotion_text"]; ok {
				t.Fatal("跟随音色不应传情绪文本")
			}
		case "reference":
			if r["audio"] != "emotion.wav" {
				t.Fatal(r)
			}
		case "text":
			if o["use_emotion_text"] != true {
				t.Fatal(o)
			}
			d.InferEmotion = true
			p, e := BuildRequest(d, "v", "")
			must(t, e)
			if _, ok := p["request"].(map[string]any)["options"].(map[string]any)["emotion_text"]; ok {
				t.Fatal("理解正文不应传显式情绪")
			}
		case "vector":
			d.Emotions = []float64{1, 1, 1, 1, 1, 1, 1, 1}
			p, e := BuildRequest(d, "v", "")
			must(t, e)
			vector := p["request"].(map[string]any)["options"].(map[string]any)["emotion_vector"].(string)
			sum := 0.
			for _, part := range strings.Split(vector, ",") {
				var n float64
				_, e = fmt.Sscan(part, &n)
				must(t, e)
				sum += n
			}
			if sum > .800001 {
				t.Fatal(sum)
			}
		}
	}
	for _, change := range []func(*Draft){func(d *Draft) { d.Speed = math.NaN() }, func(d *Draft) { d.ModelID = "index-2-q8"; d.Language = "ja" }, func(d *Draft) { d.Emotions = nil }, func(d *Draft) { d.Mode = "bad" }} {
		d := DefaultDraft()
		change(&d)
		if Validate(d) == nil {
			t.Fatal("未拒绝非法参数")
		}
	}
	d = DefaultDraft()
	d.Mode = "reference"
	if _, e := BuildRequest(d, "v", ""); e == nil {
		t.Fatal("缺少情绪音频")
	}
}
func TestMediaPersistenceAndRollback(t *testing.T) {
	root := t.TempDir()
	w, e := New(root)
	must(t, e)
	defer w.Close()
	file := filepath.Join(root, "input.wav")
	must(t, os.WriteFile(file, wav(), 0600))
	v, e := w.ImportVoice(context.Background(), file, "参考音色")
	must(t, e)
	d := DefaultDraft()
	d.VoiceID = &v.ID
	d.EmotionVoiceID = &v.ID
	must(t, w.SaveDraft(d))
	invoke(t, w, "media.rename", map[string]any{"kind": "voices", "id": v.ID, "name": "新名称"})
	if w.Store.Read().Voices[0].Name != "新名称" {
		t.Fatal("未重命名")
	}
	path, e := w.MediaFile("voices", v.ID)
	must(t, e)
	// 强制状态提交失败，文件和内存状态必须一起恢复。
	must(t, os.Remove(filepath.Join(root, "state.json")))
	must(t, os.Mkdir(filepath.Join(root, "state.json"), 0700))
	if w.deleteMedia("voices", v.ID) == nil {
		t.Fatal("应写入失败")
	}
	if _, e = os.Stat(path); e != nil {
		t.Fatal("音频未恢复", e)
	}
	if len(w.Store.Read().Voices) != 1 {
		t.Fatal("状态被错误修改")
	}
	must(t, os.Remove(filepath.Join(root, "state.json")))
	must(t, w.deleteMedia("voices", v.ID))
	if _, e = os.Stat(path); !os.IsNotExist(e) {
		t.Fatal("音频未删除")
	}
	s, e := NewStore(root)
	must(t, e)
	if len(s.Read().Voices) != 0 || s.Read().Drafts[0].VoiceID != nil || s.Read().Drafts[0].EmotionVoiceID != nil {
		t.Fatal("引用未清除")
	}
	id := newID()
	output, _ := w.Store.MediaPath("outputs", id+".wav")
	must(t, os.WriteFile(output, wav(), 0600))
	must(t, w.Store.Update(func(s *State) { s.History = append(s.History, Generation{id, "历史", id + ".wav", time.Now(), 1, d}) }, true))
	invoke(t, w, "media.rename", map[string]string{"kind": "outputs", "id": id, "name": "重命名历史"})
	must(t, w.deleteMedia("outputs", id))
	if len(w.Store.Read().History) != 0 {
		t.Fatal("历史未删除")
	}
	invoke(t, w, "draft.delete", map[string]string{"id": d.ID})
	for _, d2 := range w.Store.Read().Drafts {
		if d2.ID == d.ID {
			t.Fatal("草稿未删除")
		}
	}
	for _, name := range []string{"../state.json", "..", "a\\b", "x:y"} {
		if _, e = w.Store.MediaPath("voices", name); e == nil {
			t.Fatal("未拒绝路径", name)
		}
	}
	if _, e = w.MediaFile("voices", "../invalid"); e == nil {
		t.Fatal("非法 ID")
	}
	must(t, os.WriteFile(filepath.Join(root, "state.json"), []byte("broken"), 0600))
	if _, e = NewStore(root); e == nil {
		t.Fatal("损坏状态被接受")
	}
	b, e := os.ReadFile(filepath.Join(root, "state.json"))
	must(t, e)
	if string(b) != "broken" {
		t.Fatal("损坏状态被覆盖")
	}
}
func TestMigrationAndLock(t *testing.T) {
	base := t.TempDir()
	legacy, target := filepath.Join(base, "legacy"), filepath.Join(base, ".yovoice")
	s, e := NewStore(legacy)
	must(t, e)
	external := filepath.Join(base, "external")
	must(t, s.Update(func(s *State) {
		s.RuntimePath = ptr(filepath.Join(legacy, "runtime", "engine"))
		s.Preferences.ModelDirectory = &external
		s.Models = append(s.Models, InstalledModel{"test", filepath.Join(legacy, "models", "test.gguf"), true})
	}, true))
	must(t, os.WriteFile(filepath.Join(legacy, "voices", "test.wav"), wav(), 0600))
	lock, e := Lock(filepath.Join(legacy, "service.lock"))
	must(t, e)
	if e = Migrate(legacy, target); e == nil {
		t.Fatal("运行中的数据被移动")
	}
	lock.Close()
	must(t, Migrate(legacy, target))
	m, e := NewStore(target)
	must(t, e)
	state := m.Read()
	if value(state.RuntimePath) != filepath.Join(target, "runtime", "engine") || state.Models[0].Path != filepath.Join(target, "models", "test.gguf") || value(state.Preferences.ModelDirectory) != external {
		t.Fatal(state)
	}
	must(t, os.Mkdir(legacy, 0700))
	must(t, Migrate(legacy, target))
	if _, e = os.Stat(legacy); e != nil {
		t.Fatal("不应覆盖已有新目录")
	}
}
func TestDownloadAndArchives(t *testing.T) {
	b := []byte("download payload")
	sum := sha256.Sum256(b)
	hash := hex.EncodeToString(sum[:])
	root := t.TempDir()
	for _, mode := range []string{"resume", "restart", "bad-range", "bad-hash", "cancel"} {
		t.Run(mode, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Range") != "bytes=2-" {
					t.Error("断点未传递")
				}
				switch mode {
				case "bad-range":
					w.Header().Set("Content-Range", fmt.Sprintf("bytes 3-%d/%d", len(b)-1, len(b)))
					w.WriteHeader(206)
					_, _ = w.Write(b[3:])
				case "restart":
					_, _ = w.Write(b)
				case "cancel":
					cancel()
					<-r.Context().Done()
				default:
					w.Header().Set("Content-Range", fmt.Sprintf("bytes 2-%d/%d", len(b)-1, len(b)))
					w.WriteHeader(206)
					_, _ = w.Write(b[2:])
				}
			}))
			defer server.Close()
			dest := filepath.Join(root, mode)
			must(t, os.WriteFile(dest+".part", b[:2], 0600))
			digest := hash
			if mode == "bad-hash" {
				digest = strings.Repeat("0", 64)
			}
			e := Download(ctx, server.Client(), server.URL, dest, digest, int64(len(b)), func(int64, int64) {})
			if mode == "resume" || mode == "restart" {
				must(t, e)
				got, e := os.ReadFile(dest)
				must(t, e)
				if !bytes.Equal(got, b) {
					t.Fatal(got)
				}
			} else if e == nil {
				t.Fatal("非法下载应失败")
			}
		})
	}
	for _, name := range []string{"../escape", "/escape", "..\\escape"} {
		for _, kind := range []string{"zip", "tar.gz"} {
			file := filepath.Join(root, newID()+"."+kind)
			f, e := os.Create(file)
			must(t, e)
			if kind == "zip" {
				z := zip.NewWriter(f)
				v, e := z.Create(name)
				must(t, e)
				_, e = v.Write([]byte("x"))
				must(t, e)
				must(t, z.Close())
			} else {
				gz := gzip.NewWriter(f)
				tr := tar.NewWriter(gz)
				must(t, tr.WriteHeader(&tar.Header{Name: name, Size: 1, Mode: 0600}))
				_, e = tr.Write([]byte("x"))
				must(t, e)
				must(t, tr.Close())
				must(t, gz.Close())
			}
			f.Close()
			if e = Extract(context.Background(), file, filepath.Join(root, newID())); e == nil {
				t.Fatal("未拒绝压缩包路径", name)
			}
		}
	}
}
func TestOperationCancellation(t *testing.T) {
	w, e := New(t.TempDir())
	must(t, e)
	must(t, w.begin("download", "模型", ptr("index-2-q8"), func(ctx context.Context) error { <-ctx.Done(); return ctx.Err() }))
	if e = w.begin("runtime", "内核", nil, func(context.Context) error { return nil }); e == nil {
		t.Fatal("允许并发操作")
	}
	w.Cancel()
	w.Close()
	s := w.Store.Read()
	if s.Activity.Status != "cancelled" || value(s.Activity.ModelID) != "index-2-q8" {
		t.Fatal(s.Activity)
	}
	w.Close()
}
func TestHTTPBoundaryAndEvents(t *testing.T) {
	w, e := New(t.TempDir())
	must(t, e)
	defer w.Close()
	secret := strings.Repeat("a", 64)
	handler := &Server{Workbench: w, Assets: t.TempDir(), Secret: secret}
	server := httptest.NewServer(handler)
	defer server.Close()
	request := func(path, origin string, auth bool) *http.Request {
		r, e := http.NewRequest("GET", server.URL+path, nil)
		must(t, e)
		if auth {
			r.AddCookie(&http.Cookie{Name: "vw-" + secret[:12], Value: secret})
		}
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		return r
	}
	for _, r := range []*http.Request{request("/", "", false), request("/", "https://untrusted.invalid", true)} {
		res, e := server.Client().Do(r)
		must(t, e)
		res.Body.Close()
		if res.StatusCode != 403 {
			t.Fatal(res.StatusCode)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	r := request("/api/state-events", "", true).WithContext(ctx)
	res, e := server.Client().Do(r)
	must(t, e)
	defer res.Body.Close()
	buffer := make([]byte, 8192)
	n, e := res.Body.Read(buffer)
	must(t, e)
	if !bytes.Contains(buffer[:n], []byte(`"event":"state"`)) {
		t.Fatal(string(buffer[:n]))
	}
	d := DefaultDraft()
	d.Title = "事件更新"
	must(t, w.SaveDraft(d))
	n, e = res.Body.Read(buffer)
	must(t, e)
	if !bytes.Contains(buffer[:n], []byte("事件更新")) {
		t.Fatal(string(buffer[:n]))
	}
	file := filepath.Join(w.Store.Root, "input.wav")
	must(t, os.WriteFile(file, wav(), 0600))
	v, e := w.ImportVoice(context.Background(), file, "")
	must(t, e)
	r = request("/media/voices/"+v.FileName, "", true)
	r.Header.Set("Range", "bytes=0-43")
	audio, e := server.Client().Do(r)
	must(t, e)
	b, e := io.ReadAll(audio.Body)
	audio.Body.Close()
	must(t, e)
	if audio.StatusCode != 206 || len(b) != 44 {
		t.Fatal(audio.StatusCode, len(b))
	}
}

// 子进程模拟真实 audio.cpp 协议，验证启动、复用和取消时的进程清理。
func TestMain(m *testing.M) {
	if len(os.Args) > 2 && os.Args[1] == "--config" {
		b, e := os.ReadFile(os.Args[2])
		if e != nil {
			os.Exit(2)
		}
		var config struct {
			Port int `json:"port"`
		}
		if json.Unmarshal(b, &config) != nil {
			os.Exit(2)
		}
		http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("{}")) })
		http.HandleFunc("/v1/tasks/run", func(w http.ResponseWriter, r *http.Request) {
			var p struct {
				Request struct {
					Text string `json:"text"`
				} `json:"request"`
			}
			_ = json.NewDecoder(r.Body).Decode(&p)
			if p.Request.Text == "等待取消" {
				<-r.Context().Done()
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"audio": base64.StdEncoding.EncodeToString(wav())})
		})
		_ = http.ListenAndServe(fmt.Sprintf("127.0.0.1:%d", config.Port), nil)
		os.Exit(0)
	}
	os.Exit(m.Run())
}
func TestEngineLifecycle(t *testing.T) {
	root := t.TempDir()
	_, e := NewStore(root)
	must(t, e)
	engine := NewEngine(root)
	defer engine.Stop()
	executable, e := os.Executable()
	must(t, e)
	model := filepath.Join(root, "model.gguf")
	must(t, os.WriteFile(model, []byte("test"), 0600))
	d := DefaultDraft()
	out := filepath.Join(root, "outputs", "test.wav")
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	must(t, engine.Generate(ctx, executable, InstalledModel{ID: d.ModelID, Path: model}, "cpu", d, "voice.wav", "", out, func(string) {}))
	pid := engine.process.Process.Pid
	if seconds, e := Duration(out); e != nil || seconds != 1 {
		t.Fatal(seconds, e)
	}
	must(t, os.Remove(out))
	must(t, engine.Generate(ctx, executable, InstalledModel{ID: d.ModelID, Path: model}, "cpu", d, "voice.wav", "", out, func(string) {}))
	if engine.process.Process.Pid != pid {
		t.Fatal("引擎未复用")
	}

	// 旧草稿中的流式标记应被忽略，始终使用完整生成。
	must(t, json.Unmarshal([]byte(`{"modelId":"voxcpm2-q8","streaming":true}`), &d))
	must(t, engine.Generate(ctx, executable, InstalledModel{ID: d.ModelID, Path: model}, "cpu", d, "", "", out, func(string) {}))
	if engine.process.Process.Pid == pid {
		t.Fatal("切换模型类型后必须重新启动引擎")
	}
	config, err := os.ReadFile(filepath.Join(root, "runtime", "server.json"))
	must(t, err)
	if !bytes.Contains(config, []byte(`"family":"voxcpm2"`)) || !bytes.Contains(config, []byte(`"mode":"offline"`)) {
		t.Fatal(string(config))
	}
	d.Text = "等待取消"
	cancelled, stop := context.WithCancel(ctx)
	timer := time.AfterFunc(200*time.Millisecond, stop)
	defer timer.Stop()
	if e = engine.Generate(cancelled, executable, InstalledModel{ID: d.ModelID, Path: model}, "cpu", d, "voice.wav", "", out, func(string) {}); e == nil {
		t.Fatal("未取消")
	}
	if engine.process != nil {
		t.Fatal("取消后引擎仍存活")
	}
	if runtime.GOOS == "darwin" {
		a, e := runtimeArchives("metal")
		must(t, e)
		if len(a) != 1 || !strings.Contains(a[0].Name, "macos") {
			t.Fatal(a)
		}
	}
	if runtime.GOOS == "linux" && runtime.GOARCH == "amd64" {
		for _, backend := range []string{"cpu", "vulkan"} {
			a, err := runtimeArchives(backend)
			must(t, err)
			if len(a) != 1 || a[0].Name != "audio-v0.7.4-bin-ubuntu-x64-"+backend+"-portable.tar.gz" || len(a[0].Hash) != 64 {
				t.Fatal(a)
			}
		}
		if _, err := runtimeArchives("metal"); err == nil {
			t.Fatal("Linux 不应接受 Metal 后端")
		}
	}
}

func TestForgetModelDuringDownload(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	path := filepath.Join(w.Store.Root, "model.gguf")
	must(t, os.WriteFile(path, []byte("model"), 0600))
	must(t, w.Store.Update(func(s *State) {
		s.Models = []InstalledModel{{ID: "index-2-q8", Path: path}, {ID: "voxcpm2-q8", Path: path}}
	}, true))
	must(t, w.begin("download", "测试下载", ptr("voxcpm2-q8"), func(ctx context.Context) error { <-ctx.Done(); return ctx.Err() }))
	_, err = w.Call("model.forget", json.RawMessage(`{"id":"index-2-q8"}`))
	must(t, err)
	if len(w.Store.Read().Models) != 1 || w.Store.Read().Activity.Status != "running" {
		t.Fatal("移除其他模型不能影响下载")
	}
	if _, err = os.Stat(path); err != nil {
		t.Fatal("移除登记不能删除原文件", err)
	}
	if _, err = w.Call("model.forget", json.RawMessage(`{"id":"voxcpm2-q8"}`)); err == nil {
		t.Fatal("不能移除正在下载的模型")
	}
	w.Cancel()
	<-w.done
	must(t, w.begin("generate", "测试生成", nil, func(ctx context.Context) error { <-ctx.Done(); return ctx.Err() }))
	if _, err = w.Call("model.forget", json.RawMessage(`{"id":"voxcpm2-q8"}`)); err == nil {
		t.Fatal("生成期间应保护模型")
	}
}
