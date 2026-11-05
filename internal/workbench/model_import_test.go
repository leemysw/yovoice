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
