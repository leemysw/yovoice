package workbench

import (
	"path/filepath"
	"slices"
	"testing"
	"yovoice/internal/audio"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
)

// textWorkbench 在 recognizeWorkbench 上加一条 3 秒的语音版本和一首歌曲版本。
func textWorkbench(t *testing.T, installed bool) *Workbench {
	wb := recognizeWorkbench(t, installed)
	must(t, audio.WriteMono(filepath.Join(wb.Store.Root, "outputs", "speech.wav"), tone(3, 24000), 24000))
	must(t, wb.Store.Update(func(s *schema.State) {
		speech, song := schema.DefaultDraft(), schema.DefaultDraft()
		speech.Text, song.Kind, song.Text = "[breath]你好，世界。\n再见！", "music", "你好"
		s.History = []schema.Generation{
			{ID: "0123456789abcdef0123456789abcdef", FileName: "speech.wav", Duration: 3, Settings: speech},
			{ID: "fedcba9876543210fedcba9876543210", FileName: "speech.wav", Duration: 3, Settings: song},
		}
	}, true))
	return wb
}

// 语音版本的正文对齐到音频上：方括号标记不参与，结果写进 TextWords；歌曲没有正文可对齐，没装模型时提示下载。
func TestAlignText(t *testing.T) {
	if e := textWorkbench(t, false).AlignText("0123456789abcdef0123456789abcdef"); !isCode(e, msg.ErrRecognizeModelRequired) {
		t.Fatalf("%v", e)
	}
	wb := textWorkbench(t, true)
	if e := wb.AlignText("fedcba9876543210fedcba9876543210"); !isCode(e, msg.ErrAlignText) {
		t.Fatalf("%v", e)
	}
	must(t, wb.AlignText("0123456789abcdef0123456789abcdef"))
	<-wb.Done()
	s := wb.Store.Read()
	if s.Activity.Status != "completed" || s.Activity.Task != "caption" {
		t.Fatalf("%+v", s.Activity)
	}
	// 测试引擎把每个非空白字符记作一个字、每字 0.25 秒；整段都有声音，从 0 秒开始。
	words := s.History[0].TextWords
	if len(words) != 9 || words[0].Word != "你" || words[0].Start != 0 || words[8].Word != "！" || words[8].Start != 2 || s.History[1].TextWords != nil {
		t.Fatalf("%+v", words)
	}
	if left, _ := filepath.Glob(filepath.Join(wb.Store.Root, "runtime", "caption-*")); len(left) != 0 {
		t.Fatalf("%v", left)
	}
}

// 句子按换行和句末标点切开，句末的引号跟着前一句；英文句点后要有空格才算句末。
func TestSentences(t *testing.T) {
	got := sentences("他说：“走吧。”我们出发！\nHello Mr. Smith. It is 3.5 now")
	want := []string{"他说：“走吧。”", "我们出发！", "Hello Mr.", "Smith.", "It is 3.5 now"}
	if !slices.Equal(got, want) {
		t.Fatalf("%q", got)
	}
	lines := estimateLines([]string{"一二", "三四五六"}, [][2]int{{16000, 16000 * 4}}, 16000*5)
	if lines[0].Start != 1 || lines[0].End != 2 || lines[1].End != 4 {
		t.Fatalf("%+v", lines)
	}
}
