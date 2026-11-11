package workbench

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"yovoice/internal/catalog"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
)

func localGGUF(family string) []byte {
	var b bytes.Buffer
	b.WriteString("GGUF")
	_ = binary.Write(&b, binary.LittleEndian, uint32(3))
	_ = binary.Write(&b, binary.LittleEndian, uint64(1))
	_ = binary.Write(&b, binary.LittleEndian, uint64(1))
	_ = binary.Write(&b, binary.LittleEndian, uint64(len("general.architecture")))
	b.WriteString("general.architecture")
	_ = binary.Write(&b, binary.LittleEndian, uint32(8))
	_ = binary.Write(&b, binary.LittleEndian, uint64(len(family)))
	b.WriteString(family)
	b.Write(make([]byte, 64))
	return b.Bytes()
}

func TestImportLocalModelPreservesExternalFile(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	path := filepath.Join(t.TempDir(), "my-converted-model.gguf")
	content := localGGUF("kokoro_tts")
	must(t, os.WriteFile(path, content, 0600))
	must(t, w.ImportModel("kokoro-82m-q8", path))
	<-w.Done()
	s := w.Store.Read()
	if s.Activity.Status != "completed" || len(s.Models) != 1 {
		t.Fatalf("%+v", s.Activity)
	}
	m := s.Models[0]
	if m.ID != "kokoro-82m-q8" || m.Path != path || m.Managed || m.SHA256 != fmt.Sprintf("%x", sha256.Sum256(content)) || s.Preferences.ModelDirectory != nil {
		t.Fatal(m)
	}
	must(t, w.ForgetModel(m.ID))
	got, err := os.ReadFile(path)
	must(t, err)
	if !bytes.Equal(got, content) || len(w.Store.Read().Models) != 0 {
		t.Fatal("移除只能解除登记")
	}
}

func TestImportLocalModelRejectsWrongFamilyAndRawWeights(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	for _, content := range [][]byte{localGGUF("llama"), []byte("PyTorch weights"), []byte("GGUF")} {
		path := filepath.Join(t.TempDir(), "renamed.gguf")
		must(t, os.WriteFile(path, content, 0600))
		must(t, w.ImportModel("kokoro-82m-q8", path))
		<-w.Done()
		s := w.Store.Read()
		if s.Activity.Status != "failed" || (s.Activity.ErrorCode == nil || *s.Activity.ErrorCode != msg.ErrLocalModelInvalid) || len(s.Models) != 0 {
			t.Fatalf("%+v", s.Activity)
		}
	}
	if err := w.ImportModel("kokoro-82m-q8", "relative.gguf"); err == nil {
		t.Fatal("不接受相对路径")
	}
}

func TestImportLocalPackageVerifiesCompanionsAndStrippedPrefix(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	original := catalog.Models
	defer func() { catalog.Models = original }()
	main, companion := []byte("main"), []byte("side")
	model := catalog.ModelPackage{ID: "test-package", Family: "xtts_v2", RemotePath: "q8/main.gguf", StripPrefix: "q8", Files: []catalog.ModelFile{
		{Path: "q8/main.gguf", Size: 4, SHA256: fmt.Sprintf("%x", sha256.Sum256(main))},
		{Path: "q8/side.gguf", Size: 4, SHA256: fmt.Sprintf("%x", sha256.Sum256(companion))},
	}}
	catalog.Models = []catalog.ModelPackage{model}
	dir := t.TempDir()
	path := filepath.Join(dir, "main.gguf")
	must(t, os.WriteFile(path, main, 0600))
	for _, data := range [][]byte{nil, []byte("bad!"), companion} {
		if data != nil {
			must(t, os.WriteFile(filepath.Join(dir, "side.gguf"), data, 0600))
		}
		must(t, w.ImportModel(model.ID, path))
		<-w.Done()
		s := w.Store.Read()
		if bytes.Equal(data, companion) {
			if s.Activity.Status != "completed" || len(s.Models) != 1 || s.Models[0].Path != dir || s.Models[0].Managed {
				t.Fatalf("%+v %+v", s.Activity, s.Models)
			}
		} else if s.Activity.Status != "failed" || (s.Activity.ErrorCode == nil || *s.Activity.ErrorCode != msg.ErrLocalModelIncomplete) || len(s.Models) != 0 {
			t.Fatalf("%+v", s.Activity)
		}
	}
}

func TestModelImportAndDownloadAreMutuallyExclusive(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	for _, kind := range []string{"download", "import"} {
		must(t, w.begin(kind, msg.ActivityVerifying, nil, nil, func(ctx context.Context) error { <-ctx.Done(); return ctx.Err() }))
		other := "import"
		if kind == "import" {
			other = "download"
		}
		if err := w.begin(other, msg.ActivityVerifying, nil, nil, func(context.Context) error { return nil }); err == nil {
			t.Fatal("导入与下载不应同时修改登记")
		}
		done := w.Done()
		if kind == "download" {
			done = w.ModelDone()
		}
		if kind == "download" {
			w.CancelModel()
		} else {
			w.Cancel()
		}
		<-done
	}
}

func indexFixture(weight, tokenizer string) []byte {
	data := bytes.Clone(localGGUF("index_tts2"))
	binary.LittleEndian.PutUint64(data[16:24], 3)
	b := bytes.NewBuffer(data[:len(data)-64])
	number := func(n any) { _ = binary.Write(b, binary.LittleEndian, n) }
	text := func(s string) { number(uint64(len(s))); b.WriteString(s) }
	text("audiocpp.weight_type")
	number(uint32(8))
	text(weight)
	text("audiocpp.embedded_files.names")
	number(uint32(9))
	number(uint32(8))
	number(uint64(1))
	text(tokenizer)
	b.Write(make([]byte, 64))
	return b.Bytes()
}

func TestScanAndImportLocalIndexModels(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	dir := t.TempDir()
	old := filepath.Join(dir, "copy A.gguf")
	current := filepath.Join(dir, "copy B.gguf")
	must(t, os.WriteFile(old, indexFixture("q8_0", "bpe.model"), 0600))
	must(t, os.WriteFile(current, indexFixture("q8_0", "multilingual_zh_ja_yue_char_del.tiktoken"), 0600))
	must(t, os.WriteFile(filepath.Join(dir, "broken.gguf"), []byte("GGUF"), 0600))
	if err := w.ImportModel("index-2.5-q8", old); !isCode(err, msg.ErrLocalModelVersion) {
		t.Fatalf("导入错误版本应立即报告：%v", err)
	}
	result, err := w.ScanLocalModels(context.Background(), dir)
	must(t, err)
	if len(result.Sources) != 2 || result.Sources[0].Models[0] != "index-2-q8" || result.Sources[1].Models[0] != "index-2.5-q8" {
		t.Fatalf("扫描结果不正确：%+v", result)
	}
	must(t, w.ImportLocalModels([]LocalModelMapping{{ID: "index-2-q8", Path: old}, {ID: "index-2.5-q8", Path: current}}))
	<-w.Done()
	state := w.Store.Read()
	if state.Activity.Status != "completed" || len(state.Models) != 2 || state.Models[0].Managed || state.Models[1].Managed ||
		state.Activity.Total == 0 || state.Activity.Received != state.Activity.Total {
		t.Fatalf("导入状态不正确：%+v %+v", state.Activity, state.Models)
	}
	if err := w.ImportLocalModels([]LocalModelMapping{{ID: "index-2-q8", Path: old}}); !isCode(err, msg.ErrLocalModelProtected) {
		t.Fatal(err)
	}
}

func TestLocalModelCommitRechecksAllSlots(t *testing.T) {
	for _, occupied := range []string{"installed", "downloading"} {
		t.Run(occupied, func(t *testing.T) {
			w, err := New(t.TempDir())
			must(t, err)
			defer w.Close()
			incoming := []schema.InstalledModel{{ID: "index-2-q8", Path: "/first.gguf"}, {ID: "index-2.5-q8", Path: "/second.gguf"}}
			for _, model := range incoming {
				must(t, localModelSlot(w.Store.Read(), model.ID))
			}
			// 模拟校验期间另一个入口提交了模型或建立了下载任务。
			existing := schema.InstalledModel{ID: incoming[1].ID, Path: "/existing.gguf"}
			must(t, w.Store.Update(func(s *schema.State) {
				if occupied == "installed" {
					putInstalledModel(s, existing)
				} else {
					s.ModelDownloads = map[string]schema.ModelDownload{existing.ID: {Status: "paused", Version: "original"}}
				}
			}, true))
			w.mu.Lock()
			err = w.commitLocalModels(incoming)
			w.mu.Unlock()
			if err == nil {
				t.Fatal("校验后的型号冲突应阻止整批登记")
			}
			s := w.Store.Read()
			if _, ok := installedModel(s, incoming[0].ID); ok {
				t.Fatal("批量登记冲突时不能部分提交")
			}
			if occupied == "installed" {
				if got, _ := installedModel(s, existing.ID); got != existing {
					t.Fatalf("已有登记被覆盖：%+v", got)
				}
			} else if s.ModelDownloads[existing.ID].Version != "original" {
				t.Fatal("已有下载任务被改动")
			}
		})
	}
}

func TestConvertedModelIsManagedWithoutCatalogUpdates(t *testing.T) {
	root, source := t.TempDir(), t.TempDir()
	w, err := New(root)
	must(t, err)
	model, err := catalog.Lookup("index-2-q8")
	must(t, err)
	output := filepath.Join(source, "converted.gguf")
	content := indexFixture("q8_0", "bpe.model")
	must(t, os.WriteFile(output, content, 0600))
	original := filepath.Join(source, "gpt.pth")
	must(t, os.WriteFile(original, []byte("original checkpoint"), 0600))
	result, err := w.verifyLocalModel(context.Background(), model, output)
	must(t, err)
	must(t, w.publishConvertedModel(context.Background(), model, result, filepath.Join(root, "models"), output))
	record, ok := installedModel(w.Store.Read(), model.ID)
	if !ok || !record.Managed || !record.Converted || modelPackageDirectory(record.Path) == "" {
		t.Fatalf("转换成品应登记为独占的托管包：%+v", record)
	}
	scanner, err := New(t.TempDir())
	must(t, err)
	scan, err := scanner.ScanLocalModels(context.Background(), filepath.Join(root, "models"))
	scanner.Close()
	must(t, err)
	canonical, err := filepath.EvalSymlinks(record.Path)
	must(t, err)
	if len(scan.Sources) != 1 || scan.Sources[0].Path != canonical || scan.Sources[0].Models[0] != model.ID {
		t.Fatalf("独占包目录内的转换成品应能被重新扫描识别：%+v", scan)
	}
	w.Close()
	w, err = New(root)
	must(t, err)
	defer w.Close()
	if got, _ := installedModel(w.Store.Read(), model.ID); got != record {
		t.Fatal("重启后转换来源标记丢失")
	}
	if modelUpdateAvailable(record, model) {
		t.Fatal("本机转换成品不应提示目录更新")
	}
	if err := w.DownloadModel(model.ID, ""); !isCode(err, msg.ErrLocalModelProtected) {
		t.Fatalf("目录下载不能替换本机转换成品：%v", err)
	}
	must(t, w.ForgetModel(model.ID))
	if _, err := os.Stat(filepath.Dir(record.Path)); !os.IsNotExist(err) {
		t.Fatalf("移除转换成品应回收整个包目录：%v", err)
	}
	got, err := os.ReadFile(original)
	must(t, err)
	if string(got) != "original checkpoint" {
		t.Fatal("原始检查点被改动")
	}
}

func TestConvertedModelPublicationRejectsNewDownload(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	model, err := catalog.Lookup("index-2-q8")
	must(t, err)
	output := filepath.Join(t.TempDir(), "converted.gguf")
	must(t, os.WriteFile(output, indexFixture("q8_0", "bpe.model"), 0600))
	result, err := w.verifyLocalModel(context.Background(), model, output)
	must(t, err)
	must(t, w.Store.Update(func(s *schema.State) {
		s.ModelDownloads = map[string]schema.ModelDownload{model.ID: {Status: "paused"}}
	}, true))
	target := t.TempDir()
	if err := w.publishConvertedModel(context.Background(), model, result, target, output); !isCode(err, msg.ErrBusy) {
		t.Fatalf("转换完成后应重新检查下载冲突：%v", err)
	}
	entries, err := os.ReadDir(target)
	must(t, err)
	if len(entries) != 0 || len(w.Store.Read().Models) != 0 {
		t.Fatal("发布失败不能留下成品目录或登记")
	}
	_, err = os.Stat(output)
	must(t, err)
}

func TestConversionToolsSurviveServiceRestart(t *testing.T) {
	root, source := t.TempDir(), t.TempDir()
	for _, name := range []string{"gpt.pth", "s2mel.pth", "config.yaml", "bpe.model"} {
		must(t, os.WriteFile(filepath.Join(source, name), []byte("fixture"), 0600))
	}
	w, err := New(root)
	must(t, err)
	tools, err := w.ConversionTools()
	must(t, err)
	if tools.Python != "" || tools.Converter != "" {
		t.Fatal("首次打开不应伪造工具路径")
	}
	executable, err := os.Executable()
	must(t, err)
	// 测试程序不是转换器，任务会失败；曾选用的工具仍应保存供用户修正。
	must(t, w.ConvertLocalModel(LocalModelConversion{ID: "index-2-q8", Path: source, Python: executable, Converter: executable}))
	<-w.Done()
	w.Close()
	w, err = New(root)
	must(t, err)
	defer w.Close()
	tools, err = w.ConversionTools()
	must(t, err)
	if tools.Python != executable || tools.Converter != executable {
		t.Fatalf("重启后未恢复上次使用的转换工具：%+v", tools)
	}
}
