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
