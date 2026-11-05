package workbench

import (
	"encoding/binary"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
	"yovoice/internal/diag"
	"yovoice/internal/engine"
	"yovoice/internal/msg"
	"yovoice/internal/platform"
	"yovoice/internal/schema"
)

// Adapter 是导入的一个 YuE2 LoRA（或 LoKr）适配器。文件复制进数据目录，作品按 ID 引用，
// 换电脑或移走原文件都不影响已有作品。
type Adapter struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Size      int64     `json:"size"`
	CreatedAt time.Time `json:"createdAt"`
}

// adapterLimit 是单个适配器文件的上限；YuE2 的 LoRA 通常几十到几百 MB。
const adapterLimit = 4 << 30

// ListAdapters 列出已导入的适配器，新导入的在前。
func (w *Workbench) ListAdapters() ([]Adapter, error) {
	dir := engine.AdapterDir(w.Store.Root)
	entries, e := os.ReadDir(dir)
	if os.IsNotExist(e) {
		return []Adapter{}, nil
	}
	if e != nil {
		return nil, e
	}
	list := []Adapter{}
	for _, entry := range entries {
		id, ok := strings.CutSuffix(entry.Name(), ".json")
		if !ok || !schema.ValidID(id) {
			continue
		}
		b, e := os.ReadFile(filepath.Join(dir, entry.Name()))
		var a Adapter
		if e != nil || json.Unmarshal(b, &a) != nil || a.ID != id {
			continue
		}
		if _, e := os.Stat(filepath.Join(dir, id+".safetensors")); e != nil {
			continue
		}
		list = append(list, a)
	}
	slices.SortFunc(list, func(a, b Adapter) int { return b.CreatedAt.Compare(a.CreatedAt) })
	return list, nil
}

// ImportAdapter 校验 safetensors 文件头后把适配器复制进数据目录，名称取原文件名。
func (w *Workbench) ImportAdapter(path string) (Adapter, error) {
	if !filepath.IsAbs(path) || !strings.EqualFold(filepath.Ext(path), ".safetensors") {
		return Adapter{}, msg.Err(msg.ErrAdapterInvalid, nil)
	}
	f, e := os.Open(path)
	if e != nil {
		return Adapter{}, msg.Err(msg.ErrAudioPathInvalid, nil)
	}
	defer f.Close()
	info, e := f.Stat()
	if e != nil || !info.Mode().IsRegular() || info.Size() > adapterLimit {
		return Adapter{}, msg.Err(msg.ErrAdapterInvalid, nil)
	}
	if e = checkSafetensors(f, info.Size()); e != nil {
		return Adapter{}, e
	}
	if _, e = f.Seek(0, io.SeekStart); e != nil {
		return Adapter{}, e
	}
	dir := engine.AdapterDir(w.Store.Root)
	if e = os.MkdirAll(dir, 0700); e != nil {
		return Adapter{}, e
	}
	a := Adapter{ID: schema.NewID(), Name: strings.TrimSuffix(filepath.Base(path), filepath.Ext(path)), Size: info.Size(), CreatedAt: time.Now().UTC()}
	if schema.TextLen(a.Name) > 120 {
		a.Name = string([]rune(a.Name)[:120])
	}
	dest := filepath.Join(dir, a.ID+".safetensors")
	out, e := os.OpenFile(dest+".part", os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if e != nil {
		return Adapter{}, e
	}
	_, e = io.Copy(out, f)
	if c := out.Close(); e == nil {
		e = c
	}
	if e == nil {
		e = os.Rename(dest+".part", dest)
	}
	if e != nil {
		_ = os.Remove(dest + ".part")
		return Adapter{}, e
	}
	b, _ := json.Marshal(a)
	if e = platform.WriteFileAtomic(filepath.Join(dir, a.ID+".json"), b, 0600); e != nil {
		_ = os.Remove(dest)
		return Adapter{}, e
	}
	diag.Log(w.Store.Root, "adapter.imported", "adapter_id", a.ID, "size", a.Size)
	return a, nil
}

// DeleteAdapter 删除一个适配器；仍在用它的作品生成时会提示适配器已删除。
func (w *Workbench) DeleteAdapter(id string) error {
	if !schema.ValidID(id) {
		return msg.Err(msg.ErrRequestInvalid, nil)
	}
	dir := engine.AdapterDir(w.Store.Root)
	if e := os.Remove(filepath.Join(dir, id+".safetensors")); e != nil && !os.IsNotExist(e) {
		return e
	}
	if e := os.Remove(filepath.Join(dir, id+".json")); e != nil && !os.IsNotExist(e) {
		return e
	}
	return nil
}

// checkSafetensors 检查 safetensors 文件头：8 字节小端头长度，后接一个 JSON 对象。
func checkSafetensors(r io.Reader, size int64) error {
	var head [9]byte
	if _, e := io.ReadFull(r, head[:]); e != nil {
		return msg.Err(msg.ErrAdapterInvalid, nil)
	}
	n := binary.LittleEndian.Uint64(head[:8])
	if n < 2 || n > 100<<20 || int64(n)+8 > size || head[8] != '{' {
		return msg.Err(msg.ErrAdapterInvalid, nil)
	}
	return nil
}
