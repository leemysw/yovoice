package engine

import (
	"bytes"
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
)

func TestGGUFArchitectureSkipsMetadataAndRejectsCorruption(t *testing.T) {
	var b bytes.Buffer
	write := func(v any) {
		if err := binary.Write(&b, binary.LittleEndian, v); err != nil {
			t.Fatal(err)
		}
	}
	str := func(s string) { write(uint64(len(s))); b.WriteString(s) }
	b.WriteString("GGUF")
	write(uint32(3))
	write(uint64(1))
	write(uint64(3))
	str("other")
	write(uint32(9))
	write(uint32(8))
	write(uint64(2))
	str("one")
	str("two")
	str("general.name")
	write(uint32(8))
	str("Kokoro")
	str("general.architecture")
	write(uint32(8))
	str("kokoro_tts")
	path := filepath.Join(t.TempDir(), "model.gguf")
	for _, version := range []uint32{2, 3} {
		data := bytes.Clone(b.Bytes())
		binary.LittleEndian.PutUint32(data[4:], version)
		if err := os.WriteFile(path, data, 0600); err != nil {
			t.Fatal(err)
		}
		if got, err := GGUFArchitecture(path); err != nil || got != "kokoro_tts" {
			t.Fatal(got, err)
		}
	}
	for _, content := range [][]byte{b.Bytes()[:20], b.Bytes()[:40], []byte("not gguf")} {
		if err := os.WriteFile(path, content, 0600); err != nil {
			t.Fatal(err)
		}
		if got, err := GGUFArchitecture(path); err == nil {
			t.Fatal("应拒绝损坏文件", got)
		}
	}
	// 损坏数组不能以超大长度导致溢出、超大分配或死循环。
	data := bytes.Clone(b.Bytes())
	binary.LittleEndian.PutUint64(data[49:], ^uint64(0))
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := GGUFArchitecture(path); err == nil {
		t.Fatal("应拒绝越界数组")
	}
}
