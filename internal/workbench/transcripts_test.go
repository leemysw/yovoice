package workbench

import (
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
	"yovoice/internal/store"
)

// transcriptWorkbench 准备一份 10 秒的转写记录，带字幕文件与原音频。
func transcriptWorkbench(t *testing.T) (*Workbench, schema.Transcript) {
	wb, _ := yueWorkbench(t)
	upload := filepath.Join(wb.Store.Root, "downloads", "upload-1")
	must(t, os.WriteFile(upload, []byte("audio"), 0600))
	record := schema.Transcript{ID: schema.NewID(), Name: "访谈", Duration: 10, CreatedAt: time.Now().UTC()}
	words := []schema.LyricWord{{Word: "你", Start: 0, End: .4}, {Word: "好", Start: .5, End: .9}}
	must(t, wb.saveTranscript(record, schema.TranscriptContent{Text: "你好", Words: words}, upload, ".m4a"))
	return wb, wb.Store.Read().Transcripts[0]
}

// 编辑后的字幕写进字幕文件，原文与逐词时间不变，记录更新修改时间；重开状态库后仍在。
func TestSaveTranscript(t *testing.T) {
	wb, r := transcriptWorkbench(t)
	if r.AudioFile != r.ID+".m4a" {
		t.Fatalf("%+v", r)
	}
	captions := []schema.TranscriptCaption{{Start: 0, End: .4, Text: "你"}, {Start: .5, End: .9, Text: "好呀"}}
	must(t, wb.SaveTranscript(r.ID, captions))
	c, e := wb.ReadTranscript(r.ID)
	must(t, e)
	if c.Text != "你好" || len(c.Words) != 2 || len(c.Captions) != 2 || c.Captions[1].Text != "好呀" {
		t.Fatalf("%+v", c)
	}
	if got := wb.Store.Read().Transcripts[0]; got.UpdatedAt == nil || r.Excerpt != "你好" || got.Excerpt != "你好呀" {
		t.Fatalf("修改时间或摘录没有更新：%+v", got)
	}
	// 全部删掉也保存为空列表，不会退回到按逐词时间重新分行。
	must(t, wb.SaveTranscript(r.ID, nil))
	if c, _ = wb.ReadTranscript(r.ID); c.Captions == nil || len(c.Captions) != 0 {
		t.Fatalf("%+v", c.Captions)
	}
	root := wb.Store.Root
	must(t, wb.Store.Close())
	reopened, e := store.New(root)
	must(t, e)
	defer reopened.Close()
	if got := reopened.Read().Transcripts; len(got) != 1 || got[0].ID != r.ID || got[0].Name != "访谈" {
		t.Fatalf("%+v", got)
	}
}

// 时间倒序、结束早于开始、超出音频时长或不是数字的字幕都拒绝保存；不存在的记录提示已删除。
func TestSaveTranscriptRejectsInvalid(t *testing.T) {
	wb, r := transcriptWorkbench(t)
	for _, captions := range [][]schema.TranscriptCaption{
		{{Start: 2, End: 3, Text: "a"}, {Start: 1, End: 4, Text: "b"}},
		{{Start: 2, End: 1, Text: "a"}},
		{{Start: 0, End: 12, Text: "a"}},
		{{Start: math.NaN(), End: 1, Text: "a"}},
		{{Start: -1, End: 1, Text: "a"}},
	} {
		if e := wb.SaveTranscript(r.ID, captions); !isCode(e, msg.ErrRequestInvalid) {
			t.Fatalf("%v %+v", e, captions)
		}
	}
	if e := wb.SaveTranscript(schema.NewID(), nil); !isCode(e, msg.ErrTranscriptMissing) {
		t.Fatalf("%v", e)
	}
	if _, e := wb.ReadTranscript("../x"); !isCode(e, msg.ErrRequestInvalid) {
		t.Fatalf("%v", e)
	}
}

// 改名限制长度；删除记录时一并删掉字幕文件与原音频。
func TestRenameAndDeleteTranscript(t *testing.T) {
	wb, r := transcriptWorkbench(t)
	if e := wb.RenameTranscript(r.ID, "  "); !isCode(e, msg.ErrNameLength) {
		t.Fatalf("%v", e)
	}
	must(t, wb.RenameTranscript(r.ID, " 周会 "))
	if wb.Store.Read().Transcripts[0].Name != "周会" {
		t.Fatalf("%+v", wb.Store.Read().Transcripts[0])
	}
	outputs := filepath.Join(wb.Store.Root, "outputs")
	must(t, wb.DeleteTranscript(r.ID))
	if len(wb.Store.Read().Transcripts) != 0 {
		t.Fatal("记录没有删除")
	}
	for _, name := range []string{r.FileName, r.AudioFile} {
		if _, e := os.Stat(filepath.Join(outputs, name)); !os.IsNotExist(e) {
			t.Fatalf("%s 没有删除：%v", name, e)
		}
	}
	if _, e := wb.ReadTranscript(r.ID); !isCode(e, msg.ErrTranscriptMissing) {
		t.Fatalf("%v", e)
	}
}

// 摘录各行相连，中文之间不加空格，英文之间加空格，过长时截断。
func TestTranscriptExcerpt(t *testing.T) {
	cases := map[string][]string{
		"你好，世界":          {"你好，", " 世界 "},
		"Hello world 你好": {"Hello", "", "world", "你好"},
	}
	for want, texts := range cases {
		if got := transcriptExcerpt(texts); got != want {
			t.Errorf("%q: %q", texts, got)
		}
	}
	if got := transcriptExcerpt([]string{strings.Repeat("长", 100)}); utf8.RuneCountInString(got) != excerptRunes+1 {
		t.Errorf("%q", got)
	}
}
