package workbench

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"yovoice/internal/domain"
	"yovoice/internal/download"
	"yovoice/internal/engine"
	"yovoice/internal/msg"
	"yovoice/internal/platform"
	"yovoice/internal/store"
	"yovoice/internal/testkit"
)

func TestRequests(t *testing.T) {
	d := domain.DefaultDraft()
	for _, mode := range []string{"speaker", "reference", "vector", "text"} {
		d.Mode = mode
		payload, e := engine.BuildRequest(d, "voice.wav", "emotion.wav")
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
			p, e := engine.BuildRequest(d, "v", "")
			must(t, e)
			if _, ok := p["request"].(map[string]any)["options"].(map[string]any)["emotion_text"]; ok {
				t.Fatal("理解正文不应传显式情绪")
			}
		case "vector":
			d.Emotions = []float64{1, 1, 1, 1, 1, 1, 1, 1}
			p, e := engine.BuildRequest(d, "v", "")
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
	for _, change := range []func(*domain.Draft){func(d *domain.Draft) { d.Speed = math.NaN() }, func(d *domain.Draft) { d.ModelID = "index-2-q8"; d.Language = "ja" }, func(d *domain.Draft) { d.Emotions = nil }, func(d *domain.Draft) { d.Mode = "bad" }} {
		d := domain.DefaultDraft()
		change(&d)
		if domain.Validate(d) == nil {
			t.Fatal("未拒绝非法参数")
		}
	}
	d = domain.DefaultDraft()
	d.Mode = "reference"
	if _, e := engine.BuildRequest(d, "v", ""); e == nil {
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
	d := domain.DefaultDraft()
	d.VoiceID = &v.ID
	d.EmotionVoiceID = &v.ID
	must(t, w.SaveDraft(d))
	must(t, w.RenameMedia("voices", v.ID, "新名称"))
	if w.Store.Read().Voices[0].Name != "新名称" {
		t.Fatal("未重命名")
	}
	path, e := w.MediaFile("voices", v.ID)
	must(t, e)
	if err := w.DeleteMedia("voices", v.ID); err == nil {
		t.Fatal("不应删除被作品引用的音频")
	}
	d.VoiceID = nil
	d.EmotionVoiceID = nil
	must(t, w.SaveDraft(d))
	// 强制状态提交失败，文件和内存状态必须一起恢复。
	must(t, os.Remove(filepath.Join(root, "state.json")))
	must(t, os.Mkdir(filepath.Join(root, "state.json"), 0700))
	if w.DeleteMedia("voices", v.ID) == nil {
		t.Fatal("应写入失败")
	}
	if _, e = os.Stat(path); e != nil {
		t.Fatal("音频未恢复", e)
	}
	if len(w.Store.Read().Voices) != 1 {
		t.Fatal("状态被错误修改")
	}
	must(t, os.Remove(filepath.Join(root, "state.json")))
	must(t, w.DeleteMedia("voices", v.ID))
	if _, e = os.Stat(path); !os.IsNotExist(e) {
		t.Fatal("音频未删除")
	}
	s, e := store.New(root)
	must(t, e)
	if len(s.Read().Voices) != 0 || s.Read().Drafts[0].VoiceID != nil || s.Read().Drafts[0].EmotionVoiceID != nil {
		t.Fatal("引用未清除")
	}
	id := domain.NewID()
	output, _ := w.Store.MediaPath("outputs", id+".wav")
	must(t, os.WriteFile(output, wav(), 0600))
	must(t, w.Store.Update(func(s *domain.State) {
		s.History = append(s.History, domain.Generation{ID: id, Title: "历史", FileName: id + ".wav", CreatedAt: time.Now(), Duration: 1, Settings: d})
	}, true))
	must(t, w.RenameMedia("outputs", id, "重命名历史"))
	must(t, w.DeleteMedia("outputs", id))
	if len(w.Store.Read().History) != 0 {
		t.Fatal("历史未删除")
	}
	must(t, w.DeleteDraft(d.ID))
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
	must(t, os.Remove(filepath.Join(root, "state.backup.json")))
	must(t, os.WriteFile(filepath.Join(root, "state.json"), []byte("broken"), 0600))
	if _, e = store.New(root); e == nil {
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
	s, e := store.New(legacy)
	must(t, e)
	external := filepath.Join(base, "external")
	must(t, s.Update(func(s *domain.State) {
		s.RuntimePath = ptr(filepath.Join(legacy, "runtime", "engine"))
		s.Preferences.ModelDirectory = &external
		s.Models = append(s.Models, domain.InstalledModel{ID: "test", Path: filepath.Join(legacy, "models", "test.gguf"), Managed: true})
	}, true))
	must(t, os.WriteFile(filepath.Join(legacy, "voices", "test.wav"), wav(), 0600))
	lock, e := platform.Lock(filepath.Join(legacy, "service.lock"))
	must(t, e)
	if e = store.Migrate(legacy, target); e == nil {
		t.Fatal("运行中的数据被移动")
	}
	lock.Close()
	must(t, store.Migrate(legacy, target))
	m, e := store.New(target)
	must(t, e)
	state := m.Read()
	if value(state.RuntimePath) != filepath.Join(target, "runtime", "engine") || state.Models[0].Path != filepath.Join(target, "models", "test.gguf") || value(state.Preferences.ModelDirectory) != external {
		t.Fatal(state)
	}
	must(t, os.Mkdir(legacy, 0700))
	must(t, store.Migrate(legacy, target))
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
			e := download.File(ctx, server.Client(), server.URL, dest, digest, int64(len(b)), func(int64, int64) {})
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
			file := filepath.Join(root, domain.NewID()+"."+kind)
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
			if e = download.Extract(context.Background(), file, filepath.Join(root, domain.NewID())); e == nil {
				t.Fatal("未拒绝压缩包路径", name)
			}
		}
	}
}
func TestOperationCancellation(t *testing.T) {
	w, e := New(t.TempDir())
	must(t, e)
	must(t, w.begin("download", msg.ActivityDownload, nil, ptr("index-2-q8"), func(ctx context.Context) error { <-ctx.Done(); return ctx.Err() }))
	if e = w.begin("runtime", msg.ActivityRuntimeDownload, nil, nil, func(context.Context) error { return nil }); e == nil {
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

// 子进程模拟真实 audio.cpp 协议，验证启动、复用和取消时的进程清理。
func TestMain(m *testing.M) {
	testkit.RunFakeEngine()
	os.Exit(m.Run())
}

func TestForgetModelDuringDownload(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	path := filepath.Join(w.Store.Root, "model.gguf")
	must(t, os.WriteFile(path, []byte("model"), 0600))
	must(t, w.Store.Update(func(s *domain.State) {
		s.Models = []domain.InstalledModel{{ID: "index-2-q8", Path: path}, {ID: "voxcpm2-q8", Path: path}}
	}, true))
	must(t, w.begin("download", msg.ActivityDownload, nil, ptr("voxcpm2-q8"), func(ctx context.Context) error { <-ctx.Done(); return ctx.Err() }))
	err = w.ForgetModel("index-2-q8")
	must(t, err)
	if len(w.Store.Read().Models) != 1 || w.Store.Read().Activity.Status != "running" {
		t.Fatal("移除其他模型不能影响下载")
	}
	if _, err = os.Stat(path); err != nil {
		t.Fatal("移除登记不能删除原文件", err)
	}
	if err = w.ForgetModel("voxcpm2-q8"); err == nil {
		t.Fatal("不能移除正在下载的模型")
	}
	w.Cancel()
	<-w.Done()
	must(t, w.begin("generate", msg.ActivityGenerate, nil, nil, func(ctx context.Context) error { <-ctx.Done(); return ctx.Err() }))
	if err = w.ForgetModel("voxcpm2-q8"); err == nil {
		t.Fatal("生成期间应保护模型")
	}
}
