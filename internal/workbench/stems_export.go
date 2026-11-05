package workbench

import (
	"io"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"unicode"
	"yovoice/internal/diag"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
)

// stemExportOrder 是导出时的轨道顺序与文件名，按 DAW 里常见的从上到下排列；00 是原混音。
var stemExportOrder = []struct{ stem, label string }{
	{"vocals", "Vocals"}, {"drums", "Drums"}, {"bass", "Bass"}, {"guitar", "Guitar"}, {"piano", "Piano"}, {"other", "Other"},
}

// ExportStems 把一个版本的原混音和全部分轨复制到 dir 下新建的“<歌名> Stems”文件夹，
// 文件名形如“<歌名> - 01 Vocals.wav”，各轨同采样率、同长度、都从 0 秒开始，直接拖进 DAW 就是对齐的。
// id 可以是原版本，也可以是其中一轨。返回新建的文件夹路径。
func (w *Workbench) ExportStems(id, dir string) (string, error) {
	if !schema.ValidID(id) {
		return "", msg.Err(msg.ErrAudioIDInvalid, nil)
	}
	if info, e := os.Stat(dir); !filepath.IsAbs(dir) || e != nil || !info.IsDir() {
		return "", msg.Err(msg.ErrRequestInvalid, nil)
	}
	s := w.Store.Read()
	i := slices.IndexFunc(s.History, func(g schema.Generation) bool { return g.ID == id })
	if i < 0 {
		return "", msg.Err(msg.ErrAudioMissing, nil)
	}
	parent := s.History[i]
	if parent.StemOf != "" {
		j := slices.IndexFunc(s.History, func(g schema.Generation) bool { return g.ID == parent.StemOf })
		if j < 0 {
			return "", msg.Err(msg.ErrAudioMissing, nil)
		}
		parent = s.History[j]
	}
	type file struct{ id, name string }
	title := stemFileTitle(parent.Title)
	files := []file{{parent.ID, title + " - 00 Mix.wav"}}
	for n, item := range stemExportOrder {
		k := slices.IndexFunc(s.History, func(g schema.Generation) bool { return g.StemOf == parent.ID && g.Stem == item.stem })
		if k >= 0 {
			files = append(files, file{s.History[k].ID, title + " - " + twoDigits(n+1) + " " + item.label + ".wav"})
		}
	}
	if len(files) == 1 {
		return "", msg.Err(msg.ErrStemsMissing, nil)
	}
	folder := filepath.Join(dir, title+" Stems")
	for n := 2; ; n++ {
		if e := os.Mkdir(folder, 0755); e == nil {
			break
		} else if !os.IsExist(e) || n > 99 {
			return "", e
		}
		folder = filepath.Join(dir, title+" Stems ("+strconv.Itoa(n)+")")
	}
	for _, f := range files {
		source, e := w.MediaFile("outputs", f.id)
		if e == nil {
			e = copyFile(source, filepath.Join(folder, f.name))
		}
		if e != nil {
			_ = os.RemoveAll(folder)
			return "", e
		}
	}
	diag.Log(w.Store.Root, "stems.exported", "generation_id", parent.ID, "files", len(files))
	return folder, nil
}

func twoDigits(n int) string {
	if n < 10 {
		return "0" + strconv.Itoa(n)
	}
	return strconv.Itoa(n)
}

// stemFileTitle 把歌名变成各系统都能用的文件名：只留字母、数字、空格、连字符和下划线，最长 60 个字符。
func stemFileTitle(title string) string {
	var b strings.Builder
	n := 0
	for _, r := range strings.TrimSpace(title) {
		if n >= 60 {
			break
		}
		if !unicode.IsLetter(r) && !unicode.IsNumber(r) && r != '-' && r != '_' {
			r = ' '
		}
		b.WriteRune(r)
		n++
	}
	out := strings.Join(strings.Fields(b.String()), " ")
	if out == "" {
		return "Song"
	}
	return out
}

func copyFile(source, dest string) error {
	in, e := os.Open(source)
	if e != nil {
		return msg.Err(msg.ErrAudioMissing, nil)
	}
	defer in.Close()
	out, e := os.OpenFile(dest, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
	if e != nil {
		return e
	}
	_, e = io.Copy(out, in)
	if c := out.Close(); e == nil {
		e = c
	}
	return e
}
