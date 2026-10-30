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
	"slices"
	"strings"
	"testing"
	"time"
	"yovoice/internal/assistant/fakeocho"
	"yovoice/internal/catalog"
	"yovoice/internal/download"
	"yovoice/internal/engine"
	"yovoice/internal/msg"
	"yovoice/internal/platform"
	"yovoice/internal/schema"
	"yovoice/internal/store"
	"yovoice/internal/testkit"
)

func TestRequests(t *testing.T) {
	d := schema.DefaultDraft()
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
	for _, change := range []func(*schema.Draft){func(d *schema.Draft) { d.Speed = math.NaN() }, func(d *schema.Draft) { d.ModelID = "index-2-q8"; d.Language = "ja" }, func(d *schema.Draft) { d.Emotions = nil }, func(d *schema.Draft) { d.Mode = "bad" }} {
		d := schema.DefaultDraft()
		change(&d)
		if schema.Validate(d) == nil {
			t.Fatal("未拒绝非法参数")
		}
	}
	d = schema.DefaultDraft()
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
	d := schema.DefaultDraft()
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
	// 强制状态提交失败（回滚日志无法创建），文件和内存状态必须一起恢复。
	journal := filepath.Join(root, store.DatabaseFile+"-journal")
	must(t, os.Mkdir(journal, 0700))
	if w.DeleteMedia("voices", v.ID) == nil {
		t.Fatal("应写入失败")
	}
	if _, e = os.Stat(path); e != nil {
		t.Fatal("音频未恢复", e)
	}
	if len(w.Store.Read().Voices) != 1 {
		t.Fatal("状态被错误修改")
	}
	must(t, os.Remove(journal))
	must(t, w.DeleteMedia("voices", v.ID))
	if _, e = os.Stat(path); !os.IsNotExist(e) {
		t.Fatal("音频未删除")
	}
	s, e := store.New(root)
	must(t, e)
	if len(s.Read().Voices) != 0 || s.Read().Drafts[0].VoiceID != nil || s.Read().Drafts[0].EmotionVoiceID != nil {
		t.Fatal("引用未清除")
	}
	id := schema.NewID()
	output, _ := w.Store.MediaPath("outputs", id+".wav")
	must(t, os.WriteFile(output, wav(), 0600))
	must(t, w.Store.Update(func(s *schema.State) {
		s.History = append(s.History, schema.Generation{ID: id, Title: "历史", FileName: id + ".wav", CreatedAt: time.Now(), Duration: 1, Settings: d})
	}, true))
	must(t, w.RenameMedia("outputs", id, "重命名历史"))
	// 歌词校准时间：按顺序保存，乱序、负数或超过时长时拒绝，空列表清除。
	must(t, w.SetLyricTimes(id, []float64{0.5, 0.5, 0.9}))
	if got := w.Store.Read().History[len(w.Store.Read().History)-1].LyricTimes; !slices.Equal(got, []float64{0.5, 0.5, 0.9}) {
		t.Fatal("歌词时间未保存", got)
	}
	for _, times := range [][]float64{{0.6, 0.2}, {-1}, {3}} {
		if w.SetLyricTimes(id, times) == nil {
			t.Fatal("未拒绝歌词时间", times)
		}
	}
	if w.SetLyricTimes(schema.NewID(), nil) == nil {
		t.Fatal("未拒绝不存在的版本")
	}
	must(t, w.SetLyricTimes(id, nil))
	if w.Store.Read().History[len(w.Store.Read().History)-1].LyricTimes != nil {
		t.Fatal("歌词时间未清除")
	}
	// 逐字编辑：保存后替换逐行校准；空列表、乱序、结束早于开始或超过时长时拒绝。
	must(t, w.SetLyricTimes(id, []float64{0.1}))
	words := []schema.LyricWord{{Word: "晚", Start: 0.1, End: 0.3}, {Word: "风", Start: 0.3, End: 0.8}}
	must(t, w.SetLyricWords(id, words))
	if g := w.Store.Read().History[len(w.Store.Read().History)-1]; g.LyricTimes != nil || !slices.Equal(g.LyricWords, words) {
		t.Fatal("逐字时间未保存", g.LyricTimes, g.LyricWords)
	}
	for _, bad := range [][]schema.LyricWord{nil, {{Word: "a", Start: 0.5, End: 0.6}, {Word: "b", Start: 0.2, End: 0.3}}, {{Word: "a", Start: 0.5, End: 0.4}}, {{Word: "a", Start: 0, End: 3}}, {{Word: "", Start: 0, End: 0.1}}} {
		if w.SetLyricWords(id, bad) == nil {
			t.Fatal("未拒绝逐字时间", bad)
		}
	}
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
	// 没有备份时拒绝打开损坏的状态库，也不改动原文件。
	must(t, os.Remove(filepath.Join(root, "yovoice.backup.db")))
	must(t, os.WriteFile(filepath.Join(root, store.DatabaseFile), []byte("broken"), 0600))
	if _, e = store.New(root); e == nil {
		t.Fatal("损坏状态被接受")
	}
	b, e := os.ReadFile(filepath.Join(root, store.DatabaseFile))
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
	must(t, s.Update(func(s *schema.State) {
		s.RuntimePath = ptr(filepath.Join(legacy, "runtime", "engine"))
		s.Preferences.ModelDirectory = &external
		s.Models = append(s.Models, schema.InstalledModel{ID: "test", Path: filepath.Join(legacy, "models", "test.gguf"), Managed: true})
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
	if schema.Deref(state.RuntimePath) != filepath.Join(target, "runtime", "engine") || state.Models[0].Path != filepath.Join(target, "models", "test.gguf") || schema.Deref(state.Preferences.ModelDirectory) != external {
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
			file := filepath.Join(root, schema.NewID()+"."+kind)
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
			if e = download.Extract(context.Background(), file, filepath.Join(root, schema.NewID())); e == nil {
				t.Fatal("未拒绝压缩包路径", name)
			}
		}
	}
}
func TestOperationCancellation(t *testing.T) {
	w, e := New(t.TempDir())
	must(t, e)
	must(t, w.begin("runtime", msg.ActivityRuntimeDownload, nil, nil, func(ctx context.Context) error { <-ctx.Done(); return ctx.Err() }))
	if e = w.begin("generate", msg.ActivityGenerate, nil, nil, func(context.Context) error { return nil }); e == nil {
		t.Fatal("允许并发主操作")
	}
	// 模型下载使用独立槽位，可与主操作同时进行，且取消互不影响。
	must(t, w.begin("download", msg.ActivityDownload, nil, ptr("index-2-q8"), func(ctx context.Context) error { <-ctx.Done(); return ctx.Err() }))
	if e = w.begin("download", msg.ActivityDownload, nil, ptr("voxcpm2-q8"), func(context.Context) error { return nil }); e == nil {
		t.Fatal("允许并发模型安装")
	}
	w.CancelModel()
	<-w.ModelDone()
	s := w.Store.Read()
	if s.ModelActivity.Status != "cancelled" || s.ModelActivity.Code != msg.ActivityPaused || schema.Deref(s.ModelActivity.ModelID) != "index-2-q8" || s.Activity.Status != "running" {
		t.Fatal(s.Activity, s.ModelActivity)
	}
	w.Cancel()
	<-w.Done()
	if s = w.Store.Read(); s.Activity.Status != "cancelled" {
		t.Fatal(s.Activity)
	}
	w.Close()
}

// 下载未安装的模型时仍可用已安装的模型生成；正在重新下载的模型不能同时生成。
func TestGenerateDuringModelDownload(t *testing.T) {
	w, e := New(t.TempDir())
	must(t, e)
	defer w.Close()
	must(t, w.begin("download", msg.ActivityDownload, nil, ptr("voxcpm2-q8"), func(ctx context.Context) error { <-ctx.Done(); return ctx.Err() }))
	s := w.Store.Read()
	if installing(s, "index-2-q8") || !installing(s, "voxcpm2-q8") {
		t.Fatal("安装中的模型判断错误")
	}
	must(t, w.begin("generate", msg.ActivityGenerate, nil, nil, func(context.Context) error { return nil }))
	<-w.Done()
	if s = w.Store.Read(); s.Activity.Status != "completed" || s.ModelActivity.Status != "running" {
		t.Fatal(s.Activity, s.ModelActivity)
	}
	// 迁移数据目录需要所有操作都结束。
	if e = w.RelocateStorage(context.Background(), t.TempDir()); e == nil {
		t.Fatal("下载中不应允许迁移数据目录")
	}
}

// 子进程模拟真实 audio.cpp 协议，验证启动、复用和取消时的进程清理。
// 整个包的用户目录指向临时目录：存储迁移会写全局 storage.json，
// 绝不能改动开发者本机配置，否则真实应用会把数据目录指向测试临时目录。
func TestMain(m *testing.M) {
	fakeocho.Run()
	testkit.RunFakeEngine()
	home, err := os.MkdirTemp("", "yovoice-home-*")
	if err != nil {
		panic(err)
	}
	os.Setenv("HOME", home)
	os.Setenv("USERPROFILE", home)
	os.Setenv("APPDATA", filepath.Join(home, "AppData", "Roaming"))
	code := m.Run()
	os.RemoveAll(home)
	os.Exit(code)
}

func TestForgetModelDuringDownload(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	path := filepath.Join(w.Store.Root, "model.gguf")
	must(t, os.WriteFile(path, []byte("model"), 0600))
	must(t, w.Store.Update(func(s *schema.State) {
		s.Models = []schema.InstalledModel{{ID: "index-2-q8", Path: path}, {ID: "voxcpm2-q8", Path: path}}
	}, true))
	must(t, w.begin("download", msg.ActivityDownload, nil, ptr("voxcpm2-q8"), func(ctx context.Context) error { <-ctx.Done(); return ctx.Err() }))
	err = w.ForgetModel("index-2-q8")
	must(t, err)
	if len(w.Store.Read().Models) != 1 || w.Store.Read().ModelActivity.Status != "running" {
		t.Fatal("移除其他模型不能影响下载")
	}
	if _, err = os.Stat(path); err != nil {
		t.Fatal("移除登记不能删除原文件", err)
	}
	if err = w.ForgetModel("voxcpm2-q8"); err == nil {
		t.Fatal("不能移除正在下载的模型")
	}
	w.CancelModel()
	<-w.ModelDone()
	must(t, w.begin("generate", msg.ActivityGenerate, nil, nil, func(ctx context.Context) error { <-ctx.Done(); return ctx.Err() }))
	if err = w.ForgetModel("voxcpm2-q8"); err == nil {
		t.Fatal("生成期间应保护模型")
	}
}

// 多文件模型（如 YuE2）导入时只认完整的模型目录。
func TestPackageRoot(t *testing.T) {
	root := t.TempDir()
	m := catalog.ModelPackage{RemotePath: "main.gguf", Files: []catalog.ModelFile{{Path: "main.gguf", Size: 4}, {Path: "sidecars/config.json", Size: 2}}}
	main := filepath.Join(root, "main.gguf")
	must(t, os.WriteFile(main, []byte("gguf"), 0600))
	if packageRoot(m, main) != "" {
		t.Fatal("缺少附属文件时不应登记")
	}
	must(t, os.MkdirAll(filepath.Join(root, "sidecars"), 0700))
	must(t, os.WriteFile(filepath.Join(root, "sidecars", "config.json"), []byte("{}"), 0600))
	if packageRoot(m, main) != root {
		t.Fatal("文件齐全时应返回模型目录")
	}
}

// 更换到已有模型的目录时，按下载布局自动登记完整的模型，不完整的忽略。
func TestSetModelDirectoryAdoptsModels(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	dir := t.TempDir()
	var single, multi *catalog.ModelPackage
	for i := range catalog.Models {
		m := &catalog.Models[i]
		if len(m.Files) == 0 && single == nil {
			single = m
		} else if len(m.Files) > 0 && multi == nil {
			multi = m
		}
	}
	if single == nil || multi == nil {
		t.Skip("目录清单缺少单文件或多文件模型")
	}
	sparse := func(path string, size int64) {
		must(t, os.MkdirAll(filepath.Dir(path), 0700))
		f, err := os.Create(path)
		must(t, err)
		must(t, f.Truncate(size))
		must(t, f.Close())
	}
	sparse(filepath.Join(dir, filepath.Base(single.RemotePath)), single.Size)
	// 多文件模型缺一个文件，不应登记。
	for _, f := range multi.Files[1:] {
		sparse(filepath.Join(dir, multi.Directory, filepath.FromSlash(multi.LocalPath(f.Path))), f.Size)
	}
	must(t, w.SetModelDirectory(dir))
	models := w.Store.Read().Models
	if len(models) != 1 || models[0].ID != single.ID || !models[0].Managed || models[0].SHA256 != single.MainFile().SHA256 {
		t.Fatalf("应只登记完整的单文件模型并记录主文件摘要: %+v", models)
	}
	sparse(filepath.Join(dir, multi.Directory, filepath.FromSlash(multi.LocalPath(multi.Files[0].Path))), multi.Files[0].Size)
	must(t, w.SetModelDirectory(dir))
	if len(w.Store.Read().Models) != 2 {
		t.Fatalf("文件齐全的多文件模型应登记: %+v", w.Store.Read().Models)
	}
}

// 单文件模型匹配更新前的大小时按旧版本登记；文件缺失时的大小 0 不能触发收养。
func TestSetModelDirectoryAdoptsLegacyModel(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	dir := t.TempDir()
	var model *catalog.ModelPackage
	var legacy catalog.ModelFile
	for i := range catalog.Models {
		candidate := &catalog.Models[i]
		file, ok := catalog.LegacyModelFiles[candidate.ID]
		if len(candidate.Files) == 0 && ok && file.Size > 0 && file.Size != candidate.Size {
			model, legacy = candidate, file
			break
		}
	}
	if model == nil {
		t.Skip("目录清单缺少大小已变化的单文件模型")
	}
	must(t, w.SetModelDirectory(dir))
	if models := w.Store.Read().Models; len(models) != 0 {
		t.Fatalf("文件不存在时不应登记模型: %+v", models)
	}
	path := filepath.Join(dir, filepath.Base(model.RemotePath))
	must(t, os.MkdirAll(filepath.Dir(path), 0700))
	file, err := os.Create(path)
	must(t, err)
	must(t, file.Truncate(legacy.Size))
	must(t, file.Close())
	must(t, w.SetModelDirectory(dir))
	models := w.Store.Read().Models
	if len(models) != 1 || models[0].ID != model.ID || models[0].SHA256 != legacy.SHA256 {
		t.Fatalf("旧版单文件模型应登记旧主文件摘要: %+v", models)
	}
}

// 接口生成被取消时只取消自己那次操作，界面随后开始的生成不受影响。
func TestCancelOperationOnlyCancelsOwnRun(t *testing.T) {
	w, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	cancelled := false
	ours, other := make(chan struct{}), make(chan struct{})
	w.mu.Lock()
	w.cancel, w.done = func() { cancelled = true }, other
	w.mu.Unlock()
	w.cancelOperation(ours)
	if cancelled {
		t.Fatal("不应取消其他操作")
	}
	w.cancelOperation(other)
	if !cancelled {
		t.Fatal("应取消本次操作")
	}
	w.mu.Lock()
	w.cancel, w.done = nil, nil
	w.mu.Unlock()
}

// 更新模型时新文件先落在 .new，生成进行中不替换并保留新文件，空闲后再替换旧文件。
func TestSwapModelFilesWaitsForGeneration(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	path := filepath.Join(w.Store.Root, "model.gguf")
	must(t, os.WriteFile(path, []byte("old"), 0600))
	must(t, os.WriteFile(path+".new", []byte("new"), 0600))
	must(t, w.begin("generate", msg.ActivityGenerate, nil, nil, func(ctx context.Context) error { <-ctx.Done(); return ctx.Err() }))
	if err = w.swapModelFiles([]string{path}); err == nil {
		t.Fatal("生成期间不能替换模型文件")
	}
	if data, _ := os.ReadFile(path + ".new"); string(data) != "new" {
		t.Fatal("忙碌时应保留已下载的新文件")
	}
	w.Cancel()
	<-w.Done()
	must(t, w.swapModelFiles([]string{path}))
	if data, _ := os.ReadFile(path); string(data) != "new" {
		t.Fatal("空闲时应替换为新文件")
	}
	if _, err = os.Stat(path + ".new"); !os.IsNotExist(err) {
		t.Fatal("替换后不应残留 .new 文件")
	}
}

// 性能优先只在开关打开且内核不低于 v0.9.3 时生效，旧内核不认识 cuda_perf。
func TestPerformanceFirstNeedsEngine093(t *testing.T) {
	old, current := "v0.9.2", "v0.9.3"
	cases := []struct {
		on      bool
		version *string
		want    bool
	}{{false, &current, false}, {true, nil, false}, {true, &old, false}, {true, &current, true}}
	for _, c := range cases {
		s := schema.State{RuntimeVersion: c.version}
		s.Preferences.PerformanceFirst = c.on
		if performanceFirst(s) != c.want {
			t.Fatalf("开关 %v 内核 %v：应为 %v", c.on, c.version, c.want)
		}
	}
}

// ModelDone 返回当前模型下载或导入的完成信号；没有进行中的安装时返回已关闭的通道。只有测试在用。
func (w *Workbench) ModelDone() <-chan struct{} {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.installDone == nil {
		closed := make(chan struct{})
		close(closed)
		return closed
	}
	return w.installDone
}
