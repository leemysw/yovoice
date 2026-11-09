package schema

import (
	"reflect"
	"strings"
	"testing"
)

func timedWords(words []string, step, gap float64) []LyricWord {
	out := make([]LyricWord, len(words))
	for i, w := range words {
		out[i] = LyricWord{Word: w, Start: float64(i) * step, End: float64(i)*step + gap}
	}
	return out
}

func runes(text string) []string { return strings.Split(text, "") }

// 逐词时间按句末、分句、宽度和停顿分行，保留问号、去掉句号；原文找不到词时拼接识别结果。
func TestWordCaptions(t *testing.T) {
	got := WordCaptions("你好，世界。今天很好！", timedWords(runes("你好世界今天很好"), .5, .4), DefaultCaptionRules)
	want := []Caption{{Start: 0, End: 1.9, Text: "你好，世界"}, {Start: 2, End: 3.9, Text: "今天很好！"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("%+v", got)
	}
	// 英文按单词定位原文，保留大小写和标点；停顿超过 0.8 秒另起一行。
	words := append(timedWords([]string{"hello", "world"}, .5, .4), LyricWord{Word: "are", Start: 3, End: 3.2}, LyricWord{Word: "you", Start: 3.3, End: 3.5}, LyricWord{Word: "there", Start: 3.6, End: 4})
	got = WordCaptions("Hello, World... are you there?", words, DefaultCaptionRules)
	want = []Caption{{Start: 0, End: .9, Text: "Hello, World..."}, {Start: 3, End: 4, Text: "are you there?"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("%+v", got)
	}
	// 超过宽度就换行，相邻两行不重叠。
	long := WordCaptions("一二三四五六七八九十一二三四五六七八九十一二三", timedWords(runes("一二三四五六七八九十一二三四五六七八九十一二三"), .2, .5), DefaultCaptionRules)
	if len(long) != 2 || long[0].Text != "一二三四五六七八九十一二三四五六七八九十" || long[1].Text != "一二三" || long[0].End != long[1].Start {
		t.Fatalf("%+v", long)
	}
	if got = WordCaptions("", timedWords([]string{"good", "morning"}, .5, .4), DefaultCaptionRules); len(got) != 1 || got[0].Text != "good morning" {
		t.Fatalf("%+v", got)
	}
	// 设置里的断句规则生效：每行 6 个字时更早换行。
	narrow := (&TranscribeSettings{LineChars: 6}).CaptionRules()
	if got = WordCaptions("一二三四五六七八九十", timedWords(runes("一二三四五六七八九十"), .2, .1), narrow); len(got) != 2 {
		t.Fatalf("%+v", got)
	}
	if SpokenText("[laugh]你好 [breath]世界") != "你好 世界" {
		t.Fatal(SpokenText("[laugh]你好 [breath]世界"))
	}
}

// SRT / WebVTT：毫秒取整进位、空行合并、说话人与 VTT 转义。
func TestFormatCaptions(t *testing.T) {
	for in, want := range map[float64]string{0: "00:00:00,000", 3661.2345: "01:01:01,235", 59.9996: "00:01:00,000", -1: "00:00:00,000"} {
		if got := captionClock(in, ","); got != want {
			t.Fatalf("%v → %s", in, got)
		}
	}
	all := []Caption{{Start: .5, End: 3, Text: "第一句", Speaker: "旁白"}, {Start: 4, End: 7, Text: "第二句\n\n换行", Speaker: "小明"}}
	if got, _ := FormatCaptions(all, "srt", false); got != "1\n00:00:00,500 --> 00:00:03,000\n第一句\n\n2\n00:00:04,000 --> 00:00:07,000\n第二句\n换行\n" {
		t.Fatalf("%q", got)
	}
	if got, _ := FormatCaptions(all, "srt", true); !strings.Contains(got, "\n旁白: 第一句\n") {
		t.Fatalf("%q", got)
	}
	if got, _ := FormatCaptions(all, "vtt", true); got != "WEBVTT\n\n00:00:00.500 --> 00:00:03.000\n<v 旁白>第一句\n\n00:00:04.000 --> 00:00:07.000\n<v 小明>第二句\n换行\n" {
		t.Fatalf("%q", got)
	}
	if got, _ := FormatCaptions([]Caption{{Start: 1, End: 4, Text: "<静音>"}}, "vtt", false); got != "WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n&lt;静音&gt;\n" {
		t.Fatalf("%q", got)
	}
	if got, _ := FormatCaptions(all, "txt", false); got != "第一句\n第二句\n换行\n" {
		t.Fatalf("%q", got)
	}
	if _, e := FormatCaptions(all, "doc", false); e == nil {
		t.Fatal("未知格式应拒绝")
	}
}
