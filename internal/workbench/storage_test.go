package workbench

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"
	"yovoice/internal/msg"
	"yovoice/internal/platform"
	"yovoice/internal/schema"
	"yovoice/internal/store"
	"yovoice/internal/testkit"
)

func TestDeleteDraftCascadesHistoryAndFiles(t *testing.T) {
	root := t.TempDir()
	w, err := New(root)
	must(t, err)
	defer w.Close()

	d1 := schema.DefaultDraft()
	d1.ID = schema.NewID()
	d1.Title = "作品一"
	must(t, w.SaveDraft(d1))

	d2 := schema.DefaultDraft()
	d2.ID = schema.NewID()
	d2.Title = "作品二"

	// 为作品一生成历史版本 g1（私有）和 g2（被作品二时间线引用）
	g1 := schema.Generation{ID: schema.NewID(), Title: "版本一", FileName: "gen1.wav", Duration: 2, Settings: d1}
	g2 := schema.Generation{ID: schema.NewID(), Title: "版本二", FileName: "gen2.wav", Duration: 2, Settings: d1}

	// 在磁盘上创建对应的 outputs wav 文件
	path1 := filepath.Join(root, "outputs", g1.FileName)
	path2 := filepath.Join(root, "outputs", g2.FileName)
	must(t, os.WriteFile(path1, []byte("wav-1"), 0600))
	must(t, os.WriteFile(path2, []byte("wav-2"), 0600))

	must(t, w.Store.Update(func(s *schema.State) {
		s.History = append(s.History, g1, g2)
	}, true))

	// 作品二的时间线引用 g2
	d2.Timeline = &schema.AudioTimeline{
		Tracks: []schema.AudioLane{
			{ID: "track-1", Name: "人声", Clips: []schema.AudioClip{{ID: "clip-1", GenerationID: g2.ID, Start: 0, Offset: 0, Duration: 1}}},
		},
	}
	must(t, w.SaveDraft(d2))

	// 正在生成作品一时拒绝删除
	must(t, w.begin("generate", msg.ActivityGenerate, nil, nil, func(ctx context.Context) error {
		<-ctx.Done()
		return ctx.Err()
	}, "", d1.ID))

	if err := w.DeleteDraft(d1.ID); err == nil {
		t.Fatal("正在生成时应拒绝删除作品")
	}

	w.Cancel()
	<-w.Done()

	// 成功删除作品一
	must(t, w.DeleteDraft(d1.ID))

	s := w.Store.Read()
	for _, d := range s.Drafts {
		if d.ID == d1.ID {
			t.Fatal("作品一未从草稿列表删除")
		}
	}

	// g1 应被删除，文件被物理删除
	for _, g := range s.History {
		if g.ID == g1.ID {
			t.Fatal("未引用的历史版本未被级联删除")
		}
	}
	if _, err := os.Stat(path1); !os.IsNotExist(err) {
		t.Fatal("未引用的历史音频文件未从磁盘删除")
	}

	// g2 被作品二时间线引用，应保留，文件也应保留
	foundG2 := false
	for _, g := range s.History {
		if g.ID == g2.ID {
			foundG2 = true
		}
	}
	if !foundG2 {
		t.Fatal("被其他作品引用的历史版本被误删")
	}
	if _, err := os.Stat(path2); err != nil {
		t.Fatal("被其他作品引用的历史音频文件应保留", err)
	}
}

func TestCleanupResiduals(t *testing.T) {
	root := t.TempDir()
	w, err := New(root)
	must(t, err)
	defer w.Close()

	// 1. 创建一个 48 小时前的孤儿 output 文件
	oldOrphanPath := filepath.Join(root, "outputs", "old-orphan.wav")
	must(t, os.WriteFile(oldOrphanPath, []byte("old-orphan-data"), 0600))
	oldTime := time.Now().Add(-48 * time.Hour)
	must(t, os.Chtimes(oldOrphanPath, oldTime, oldTime))

	// 2. 创建一个刚刚生成的临时文件（不应被清理）
	freshPath := filepath.Join(root, "outputs", "fresh.wav")
	must(t, os.WriteFile(freshPath, []byte("fresh-data"), 0600))

	// 3. 执行清理
	report, err := w.CleanupResiduals()
	must(t, err)

	if report.CleanedCount < 1 {
		t.Fatalf("应至少清理 1 个旧文件，实际清理了 %d", report.CleanedCount)
	}

	if _, err := os.Stat(oldOrphanPath); !os.IsNotExist(err) {
		t.Fatal("超过 24 小时的孤儿文件未被清理")
	}

	if _, err := os.Stat(freshPath); err != nil {
		t.Fatal("24 小时内的新文件不应被误删", err)
	}
}

// isolateConfig 让存储重定向配置写入临时目录，避免测试改动开发者本机的配置。
func isolateConfig(t *testing.T) {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("APPDATA", filepath.Join(home, "AppData", "Roaming"))
}

func TestStorageInfoAndRelocate(t *testing.T) {
	isolateConfig(t)
	root := t.TempDir()
	w, err := New(root)
	must(t, err)
	defer w.Close()

	info, err := w.StorageInfo()
	must(t, err)
	if info.Root != root {
		t.Fatalf("StorageInfo Root 不匹配: %s != %s", info.Root, root)
	}

	// 不能迁移到相同目录
	if err := w.RelocateStorage(root); err == nil {
		t.Fatal("应拒绝迁移到相同目录")
	}

	// 正常迁移到新目录
	target := filepath.Join(t.TempDir(), "new-data")
	must(t, w.RelocateStorage(target))

	infoAfter, err := w.StorageInfo()
	must(t, err)
	if infoAfter.PendingPath != target {
		t.Fatalf("PendingPath 应更新为 %s，实际为 %s", target, infoAfter.PendingPath)
	}

	if _, err := os.Stat(filepath.Join(target, "yovoice.db")); err != nil {
		t.Fatal("新目录缺少状态库", err)
	}
}

func TestRelocateCopiesWithoutTouchingSourceAndFreezes(t *testing.T) {
	isolateConfig(t)
	root := t.TempDir()
	w, err := New(root)
	must(t, err)
	defer w.Close()

	voice := filepath.Join(root, "voices", "keep.wav")
	must(t, os.WriteFile(voice, []byte("voice"), 0600))
	model := filepath.Join(root, "models", "m", "weights.gguf")
	must(t, os.MkdirAll(filepath.Dir(model), 0700))
	must(t, os.WriteFile(model, []byte("weights"), 0600))
	webCache := filepath.Join(root, store.WebCacheDir, "EBWebView", "Default", "Cache", "data_0")
	must(t, os.MkdirAll(filepath.Dir(webCache), 0700))
	must(t, os.WriteFile(webCache, []byte("cache"), 0600))
	runtimePath := filepath.Join(root, "runtime", "cpu", "engine")
	must(t, w.Store.Update(func(s *schema.State) {
		s.Models = append(s.Models, schema.InstalledModel{ID: "m", Path: model, Managed: true})
		s.RuntimePath = &runtimePath
		s.Runtimes = map[string]schema.InstalledRuntime{"cpu": {Path: runtimePath, Version: "1"}}
	}, true))

	if err, ok := w.RelocateStorage(filepath.Join(root, "inside")).(*msg.CallError); !ok || err.Code != msg.ErrStorageInsideData {
		t.Fatalf("应拒绝迁移到当前数据目录内部，实际: %v", err)
	}

	target := filepath.Join(t.TempDir(), "moved")
	must(t, w.RelocateStorage(target))

	// 旧目录保持完整，重启前仍可回退使用。
	for _, p := range []string{voice, model, filepath.Join(root, "yovoice.db")} {
		if _, err := os.Stat(p); err != nil {
			t.Fatalf("迁移后旧目录文件被改动: %s %v", p, err)
		}
	}
	for _, rel := range []string{"voices/keep.wav", "models/m/weights.gguf", "yovoice.db"} {
		if _, err := os.Stat(filepath.Join(target, filepath.FromSlash(rel))); err != nil {
			t.Fatalf("新目录缺少 %s: %v", rel, err)
		}
	}
	if _, err := os.Stat(filepath.Join(target, "service.lock")); !os.IsNotExist(err) {
		t.Fatal("不应复制服务锁文件")
	}
	// WebView2 缓存被宿主占用，迁移时跳过，由新目录重建。
	if _, err := os.Stat(filepath.Join(target, store.WebCacheDir)); !os.IsNotExist(err) {
		t.Fatal("不应复制 WebView2 缓存")
	}

	moved, err := store.New(target)
	must(t, err)
	s := moved.Read()
	if s.Models[0].Path != filepath.Join(target, "models", "m", "weights.gguf") {
		t.Fatalf("模型路径未改写: %s", s.Models[0].Path)
	}
	if *s.RuntimePath != filepath.Join(target, "runtime", "cpu", "engine") || s.Runtimes["cpu"].Path != *s.RuntimePath {
		t.Fatalf("内核路径未改写: %v %v", *s.RuntimePath, s.Runtimes)
	}

	cfg, err := store.ReadConfig()
	must(t, err)
	if cfg.DataPath != target || len(cfg.PreviousPaths) != 1 || cfg.PreviousPaths[0] != root {
		t.Fatalf("存储配置不正确: %+v", cfg)
	}

	// 重启前拒绝持久化写入与再次迁移，避免修改写进旧目录后丢失。
	if err := w.Store.Update(func(*schema.State) {}, true); err == nil {
		t.Fatal("迁移后应拒绝持久化写入")
	}
	if err := w.RelocateStorage(filepath.Join(t.TempDir(), "again")); err == nil {
		t.Fatal("重启前应拒绝再次迁移")
	}
}

func TestRelocateRejectsWhileBusy(t *testing.T) {
	isolateConfig(t)
	root := t.TempDir()
	w, err := New(root)
	must(t, err)
	defer w.Close()
	must(t, w.begin("download", msg.ActivityGenerate, nil, nil, func(ctx context.Context) error {
		<-ctx.Done()
		return ctx.Err()
	}))
	defer func() { w.Cancel(); <-w.Done() }()
	if err := w.RelocateStorage(filepath.Join(t.TempDir(), "moved")); err == nil {
		t.Fatal("后台任务进行中应拒绝迁移")
	}
}

func TestCleanupPreviousRemovesOldRootOnlyAfterSwitch(t *testing.T) {
	isolateConfig(t)
	previous := t.TempDir()
	must(t, os.WriteFile(filepath.Join(previous, "state.json"), []byte("{}"), 0600))
	must(t, os.MkdirAll(filepath.Join(previous, "models"), 0700))
	must(t, os.MkdirAll(filepath.Join(previous, store.WebCacheDir, "EBWebView"), 0700))
	target := t.TempDir()
	// 旧版配置只有 previousPath 字段，读取时并入列表。
	must(t, store.WriteConfig(store.StorageConfig{DataPath: target, PreviousPath: previous}))

	// 宿主仍在旧目录启动时绝不删除。
	removed, err := store.CleanupPrevious(previous)
	must(t, err)
	if len(removed) != 0 {
		t.Fatal("当前目录不是迁移目标时不应删除旧目录")
	}
	if _, err := os.Stat(previous); err != nil {
		t.Fatal("旧目录被误删", err)
	}

	removed, err = store.CleanupPrevious(target)
	must(t, err)
	if len(removed) != 1 || removed[0] != previous {
		t.Fatalf("应删除旧目录，实际: %q", removed)
	}
	if _, err := os.Stat(previous); !os.IsNotExist(err) {
		t.Fatal("旧目录未删除")
	}
	cfg, err := store.ReadConfig()
	must(t, err)
	if len(cfg.PreviousPaths) != 0 || cfg.PreviousPath != "" || cfg.DataPath != target {
		t.Fatalf("清理后配置不正确: %+v", cfg)
	}
}

// 连续两次迁移时，第一次未清理的旧目录仍在待清理列表中；清理只删除应用创建的内容。
func TestCleanupPreviousKeepsEveryOldRootAndUserFiles(t *testing.T) {
	isolateConfig(t)
	first, second, target := t.TempDir(), t.TempDir(), t.TempDir()
	for _, dir := range []string{first, second} {
		s, err := store.New(dir)
		must(t, err)
		must(t, s.Close())
	}
	must(t, os.WriteFile(filepath.Join(first, "我的笔记.txt"), []byte("keep"), 0600))
	must(t, store.RecordRelocation(first, second))
	// 第一次迁移后旧目录仍被占用，清理推迟。
	lock, err := platform.Lock(filepath.Join(first, "service.lock"))
	must(t, err)
	removed, err := store.CleanupPrevious(second)
	if err == nil || len(removed) != 0 {
		t.Fatal("旧目录被占用时应推迟清理", removed, err)
	}
	must(t, lock.Close())
	must(t, store.RecordRelocation(second, target))
	cfg, err := store.ReadConfig()
	must(t, err)
	if cfg.DataPath != target || len(cfg.PreviousPaths) != 2 {
		t.Fatalf("再次迁移不应覆盖待清理的旧目录: %+v", cfg)
	}
	removed, err = store.CleanupPrevious(target)
	must(t, err)
	if len(removed) != 2 {
		t.Fatal("两个旧目录都应清理", removed)
	}
	if _, err := os.Stat(filepath.Join(first, "我的笔记.txt")); err != nil {
		t.Fatal("旧目录中用户自己的文件被删除", err)
	}
	for _, name := range []string{"yovoice.db", "voices", "logs"} {
		if _, err := os.Stat(filepath.Join(first, name)); !os.IsNotExist(err) {
			t.Fatal("应用创建的内容未清理", name)
		}
	}
	if _, err := os.Stat(second); !os.IsNotExist(err) {
		t.Fatal("清空的旧目录应删除")
	}
	if cfg, _ = store.ReadConfig(); len(cfg.PreviousPaths) != 0 {
		t.Fatal("清理后应移出待清理列表", cfg)
	}
}

func TestOrphanHistoryKeepsTimelineClipsAndFreshResults(t *testing.T) {
	root := t.TempDir()
	w, err := New(root)
	must(t, err)
	defer w.Close()

	gone := schema.DefaultDraft()
	gone.ID = schema.NewID()
	used := schema.Generation{ID: schema.NewID(), FileName: "used.wav", Duration: 2, CreatedAt: time.Now().Add(-72 * time.Hour), Settings: gone}
	old := schema.Generation{ID: schema.NewID(), FileName: "old.wav", CreatedAt: time.Now().Add(-48 * time.Hour), Settings: gone}
	fresh := schema.Generation{ID: schema.NewID(), FileName: "fresh.wav", CreatedAt: time.Now(), Settings: gone}
	for _, g := range []schema.Generation{used, old, fresh} {
		must(t, os.WriteFile(filepath.Join(root, "outputs", g.FileName), []byte("wav"), 0600))
	}
	must(t, w.Store.Update(func(s *schema.State) { s.History = append([]schema.Generation{fresh, old, used}, s.History...) }, true))
	other := schema.DefaultDraft()
	other.ID = schema.NewID()
	other.Timeline = &schema.AudioTimeline{Tracks: []schema.AudioLane{{ID: "track", Name: "人声", Clips: []schema.AudioClip{{ID: "clip", GenerationID: used.ID, Duration: 1}}}}}
	must(t, w.SaveDraft(other))

	// 接口历史修剪：时间线使用的版本不计入限额，也不被删除。
	w.pruneOrphanHistory(1)
	has := func(id string) bool {
		for _, g := range w.Store.Read().History {
			if g.ID == id {
				return true
			}
		}
		return false
	}
	if !has(used.ID) || !has(fresh.ID) || has(old.ID) {
		t.Fatal("修剪结果不正确：应保留时间线版本与最新版本，删除更旧的孤儿版本")
	}
	if _, err := os.Stat(filepath.Join(root, "outputs", "used.wav")); err != nil {
		t.Fatal("时间线使用的音频被删除", err)
	}

	_, err = w.CleanupResiduals()
	must(t, err)
	if !has(used.ID) || !has(fresh.ID) {
		t.Fatal("清理残留不应删除时间线使用的版本或 24 小时内的接口结果")
	}
}

func TestDeleteDraftRemovesImportedAssets(t *testing.T) {
	root := t.TempDir()
	w, err := New(root)
	must(t, err)
	defer w.Close()
	assetID := schema.NewID()
	asset := schema.AudioAsset{ID: assetID, Name: "配乐", FileName: "import-" + assetID + ".wav", Duration: 1}
	path := filepath.Join(root, "outputs", asset.FileName)
	must(t, os.WriteFile(path, testkit.WAV(), 0600))
	d := schema.DefaultDraft()
	d.ID = schema.NewID()
	d.Timeline = &schema.AudioTimeline{Assets: []schema.AudioAsset{asset}, Tracks: []schema.AudioLane{{ID: "track", Name: "配乐", Clips: []schema.AudioClip{{ID: "clip", AssetID: assetID, Duration: 1}}}}}
	must(t, w.SaveDraft(d))
	must(t, w.DeleteDraft(d.ID))
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("删除作品后导入的时间线素材未删除")
	}
}

func TestReconcileRepairsDanglingTimelineReferences(t *testing.T) {
	root := t.TempDir()
	w, err := New(root)
	must(t, err)
	defer w.Close()

	d := schema.DefaultDraft()
	d.ID = schema.NewID()
	g := schema.Generation{ID: schema.NewID(), FileName: "gone.wav", Duration: 2, CreatedAt: time.Now(), Settings: d}
	must(t, os.WriteFile(filepath.Join(root, "outputs", g.FileName), testkit.WAV(), 0600))
	assetID := schema.NewID()
	asset := schema.AudioAsset{ID: assetID, Name: "配乐", FileName: "import-" + assetID + ".wav", Duration: 1}
	must(t, os.WriteFile(filepath.Join(root, "outputs", asset.FileName), testkit.WAV(), 0600))
	must(t, w.Store.Update(func(s *schema.State) { s.History = append([]schema.Generation{g}, s.History...) }, true))
	d.Timeline = &schema.AudioTimeline{
		Assets:              []schema.AudioAsset{asset},
		AcceptedGenerations: []string{g.ID},
		Tracks: []schema.AudioLane{{ID: "track", Name: "人声", Clips: []schema.AudioClip{
			{ID: "voice", GenerationID: g.ID, Duration: 1},
			{ID: "music", AssetID: assetID, Duration: 1},
		}}},
	}
	must(t, w.SaveDraft(d))

	// 模拟旧版本或外部操作造成的数据缺失：版本记录与素材文件都不见了。
	must(t, w.Store.Update(func(s *schema.State) { s.History = nil }, true))
	must(t, os.Remove(filepath.Join(root, "outputs", asset.FileName)))
	stuck := w.Store.Read().Drafts[0]
	if err := w.SaveDraft(stuck); err == nil {
		t.Fatal("前置条件：悬空引用应导致作品无法保存")
	}

	report, err := w.Reconcile()
	must(t, err)
	if report.Clips != 2 || report.Assets != 1 || report.Accepted != 1 {
		t.Fatalf("修复统计不正确: %+v", report)
	}
	healed := w.Store.Read().Drafts[0]
	if err := w.SaveDraft(healed); err != nil {
		t.Fatal("修复后作品应可以正常保存", err)
	}
	if again, err := w.Reconcile(); err != nil || again.changed() {
		t.Fatalf("没有悬空引用时不应再改动: %+v %v", again, err)
	}
}

func TestCleanupRemovesSupersededStoryTakes(t *testing.T) {
	root := t.TempDir()
	w, err := New(root)
	must(t, err)
	defer w.Close()

	old := time.Now().Add(-48 * time.Hour)
	d := schema.DefaultDraft()
	d.ID = schema.NewID()
	take := func(name string) schema.Generation {
		g := schema.Generation{ID: schema.NewID(), FileName: name, Duration: 2, CreatedAt: old, Settings: d, Segment: &schema.GenerationSegment{CueID: "cue"}}
		must(t, os.WriteFile(filepath.Join(root, "outputs", name), testkit.WAV(), 0600))
		return g
	}
	replaced, current, pending := take("replaced.wav"), take("current.wav"), take("pending.wav")
	must(t, w.Store.Update(func(s *schema.State) {
		s.History = append([]schema.Generation{pending, current, replaced}, s.History...)
	}, true))
	d.Timeline = &schema.AudioTimeline{
		AcceptedGenerations: []string{replaced.ID, current.ID},
		Tracks:              []schema.AudioLane{{ID: "track", Name: "人声", Clips: []schema.AudioClip{{ID: "clip", GenerationID: current.ID, Duration: 1}}}},
	}
	must(t, w.SaveDraft(d))

	// 刚编辑过的作品不清理，撤销仍可能找回被替换的版本。
	_, err = w.CleanupResiduals()
	must(t, err)
	if len(w.Store.Read().History) != 3 {
		t.Fatal("24 小时内编辑过的作品不应清理逐句版本")
	}

	must(t, w.Store.Update(func(s *schema.State) { s.Drafts[0].UpdatedAt = &old }, true))
	_, err = w.CleanupResiduals()
	must(t, err)
	s := w.Store.Read()
	ids := map[string]bool{}
	for _, g := range s.History {
		ids[g.ID] = true
	}
	if ids[replaced.ID] || !ids[current.ID] || !ids[pending.ID] {
		t.Fatal("应只删除已被替换的版本，保留时间线上的版本与待放置的新版本")
	}
	if _, err := os.Stat(filepath.Join(root, "outputs", "replaced.wav")); !os.IsNotExist(err) {
		t.Fatal("被替换版本的音频未删除")
	}
	if slices.Contains(s.Drafts[0].Timeline.AcceptedGenerations, replaced.ID) {
		t.Fatal("已采纳记录中残留已删除的版本")
	}
	if err := w.SaveDraft(s.Drafts[0]); err != nil {
		t.Fatal("清理后作品应仍可保存", err)
	}
}

func TestForgetModelDeletesOnlyDownloadedFiles(t *testing.T) {
	root := t.TempDir()
	w, err := New(root)
	must(t, err)
	defer w.Close()

	downloaded := filepath.Join(root, "models", "pack")
	must(t, os.MkdirAll(downloaded, 0700))
	must(t, os.WriteFile(filepath.Join(downloaded, "weights.gguf"), []byte("w"), 0600))
	imported := filepath.Join(t.TempDir(), "mine.gguf")
	must(t, os.WriteFile(imported, []byte("w"), 0600))
	must(t, w.Store.Update(func(s *schema.State) {
		s.Models = append(s.Models,
			schema.InstalledModel{ID: "downloaded", Path: downloaded, Managed: true},
			schema.InstalledModel{ID: "imported", Path: imported, Managed: false},
			schema.InstalledModel{ID: "root", Path: filepath.Join(root, "models"), Managed: true})
	}, true))

	// 与其他已登记模型位置重叠时只解除登记。
	must(t, w.ForgetModel("root"))
	if _, err := os.Stat(filepath.Join(root, "models")); err != nil {
		t.Fatal("模型目录本身绝不能被删除", err)
	}
	must(t, w.ForgetModel("downloaded"))
	if _, err := os.Stat(downloaded); !os.IsNotExist(err) {
		t.Fatal("应用下载的模型文件应随移除一起删除")
	}
	must(t, w.ForgetModel("imported"))
	if _, err := os.Stat(imported); err != nil {
		t.Fatal("用户导入的模型文件必须保留", err)
	}
}

func TestVoiceDeletionIgnoresHiddenSubtitleDefaults(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	v := schema.Voice{ID: schema.NewID(), Name: "旧音色", FileName: "old.wav", Duration: 1}
	keep := schema.Voice{ID: schema.NewID(), Name: "说话人音色", FileName: "keep.wav", Duration: 1}
	for _, f := range []string{v.FileName, keep.FileName} {
		must(t, os.WriteFile(filepath.Join(w.Store.Root, "voices", f), wav(), 0600))
	}
	d := schema.DefaultDraft()
	d.VoiceID = ptr(v.ID)
	speaker := d.SynthesisSettings
	speaker.VoiceID = ptr(keep.ID)
	d.Kind = "subtitle"
	d.Subtitles = &schema.SubtitleDocument{Speakers: []schema.SubtitleSpeaker{{ID: "s", Settings: &speaker}}, Cues: []schema.SubtitleCue{{ID: "one", Start: 0, End: 1000, Text: "你好", SpeakerID: "s"}}}
	must(t, w.Store.Update(func(s *schema.State) {
		s.Voices = []schema.Voice{v, keep}
		s.Drafts = []schema.Draft{d}
	}, true))
	// 作品级设置被说话人覆盖后界面不可见，不能阻止删除；删除后清理悬空引用。
	must(t, w.DeleteMedia("voices", v.ID))
	if got := w.Store.Read().Drafts[0]; got.VoiceID != nil || schema.Deref(got.Subtitles.Speakers[0].Settings.VoiceID) != keep.ID {
		t.Fatal("隐藏引用未清理或误清可见设置")
	}
	if err = w.DeleteMedia("voices", keep.ID); err == nil {
		t.Fatal("允许删除说话人正在使用的音色")
	}
}

func TestCharacterDeletionAndReconcileDetachLinks(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	c := schema.Character{ID: schema.NewID(), Name: "旁白"}
	d := schema.DefaultDraft()
	d.CharacterID = c.ID
	speaker := d.SynthesisSettings
	d.Subtitles = &schema.SubtitleDocument{Speakers: []schema.SubtitleSpeaker{{ID: "s", CharacterID: c.ID, Settings: &speaker}}}
	must(t, w.Store.Update(func(s *schema.State) {
		s.Characters = []schema.Character{c}
		s.Drafts = []schema.Draft{d}
	}, true))
	must(t, w.DeleteCharacter(c.ID))
	got := w.Store.Read().Drafts[0]
	if got.CharacterID != "" || got.Subtitles.Speakers[0].CharacterID != "" || got.Subtitles.Speakers[0].Settings == nil {
		t.Fatal("删除角色后作品仍指向角色或丢失设置")
	}
	// 历史数据里遗留的悬空角色和音色引用在启动自检时清理。
	ghost := schema.NewID()
	must(t, w.Store.Update(func(s *schema.State) {
		s.Drafts[0].CharacterID = schema.NewID()
		s.Drafts[0].Subtitles.Speakers[0].Settings.VoiceID = ptr(ghost)
		s.Characters = []schema.Character{{ID: schema.NewID(), Name: "残留", Settings: schema.SynthesisSettings{EmotionVoiceID: ptr(ghost)}}}
	}, true))
	report, err := w.Reconcile()
	must(t, err)
	state := w.Store.Read()
	if report.Links != 3 || state.Drafts[0].CharacterID != "" || state.Drafts[0].Subtitles.Speakers[0].Settings.VoiceID != nil || state.Characters[0].Settings.EmotionVoiceID != nil {
		t.Fatal("悬空引用未清理", report)
	}
}

func TestUnchangedDraftSaveDoesNotWrite(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	d := schema.DefaultDraft()
	must(t, w.SaveDraft(d))
	saved := w.Store.Read().Drafts[0]
	// 冻结后任何写盘都会失败；内容未变的保存（打开作品、退出补存）必须直接成功。
	w.Store.Freeze()
	must(t, w.SaveDraft(saved))
	saved.Title = "改过"
	if err = w.SaveDraft(saved); err == nil {
		t.Fatal("冻结后有改动的保存应失败")
	}
}
