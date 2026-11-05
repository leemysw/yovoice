package workbench

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
	"yovoice/internal/msg"
)

func writeSafetensors(t *testing.T, path string, header string) {
	t.Helper()
	b := binary.LittleEndian.AppendUint64(nil, uint64(len(header)))
	b = append(append(b, header...), make([]byte, 16)...)
	must(t, os.WriteFile(path, b, 0600))
}

// 导入的 LoRA 复制进数据目录，按 ID 列出与删除；不是 safetensors 的文件不落盘。
func TestImportAdapter(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	dir := t.TempDir()
	good := filepath.Join(dir, "city pop.safetensors")
	writeSafetensors(t, good, `{"__metadata__":{}}`)
	a, err := w.ImportAdapter(good)
	must(t, err)
	if a.Name != "city pop" || a.Size == 0 {
		t.Fatalf("适配器信息不对：%+v", a)
	}
	list, err := w.ListAdapters()
	must(t, err)
	if len(list) != 1 || list[0].ID != a.ID {
		t.Fatalf("列表应只有刚导入的适配器：%+v", list)
	}
	bad := filepath.Join(dir, "bad.safetensors")
	must(t, os.WriteFile(bad, []byte("not a tensor file at all"), 0600))
	if _, err = w.ImportAdapter(bad); !isCode(err, msg.ErrAdapterInvalid) {
		t.Fatalf("坏文件应被拒绝：%v", err)
	}
	truncated := filepath.Join(dir, "short.safetensors")
	must(t, os.WriteFile(truncated, binary.LittleEndian.AppendUint64(nil, 1<<20), 0600))
	if _, err = w.ImportAdapter(truncated); !isCode(err, msg.ErrAdapterInvalid) {
		t.Fatalf("头长度超出文件的应被拒绝：%v", err)
	}
	if _, err = w.ImportAdapter("relative.safetensors"); !isCode(err, msg.ErrAdapterInvalid) {
		t.Fatalf("相对路径应被拒绝：%v", err)
	}
	other := filepath.Join(dir, "model.gguf")
	writeSafetensors(t, other, `{}`)
	if _, err = w.ImportAdapter(other); !isCode(err, msg.ErrAdapterInvalid) {
		t.Fatalf("扩展名不对的应被拒绝：%v", err)
	}
	must(t, w.DeleteAdapter(a.ID))
	list, err = w.ListAdapters()
	must(t, err)
	if len(list) != 0 {
		t.Fatalf("删除后列表应为空：%+v", list)
	}
	if err = w.DeleteAdapter("../x"); err == nil {
		t.Fatal("无效 ID 应被拒绝")
	}
}
