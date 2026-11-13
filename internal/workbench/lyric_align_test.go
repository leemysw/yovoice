package workbench

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"yovoice/internal/audio"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
)

// alignWorkbench 准备一个带歌词和音频的生成版本；installed 决定是否装好可选的歌词对齐模型。
func alignWorkbench(t *testing.T, installed bool) (*Workbench, string) {
	wb, d := yueWorkbench(t)
	d.Lyrics = "[verse]\n晚风 轻\n[chorus]\n夏夜"
	if installed {
		model := filepath.Join(wb.Store.Root, "models", "Lyric-Align-GGUF")
		for _, file := range []string{"BS-RoFormer-ep368-GGUF/bs-roformer-ep368-q8_0.gguf", "Qwen3-ForcedAligner-0.6B-GGUF/qwen3-forced-aligner-0.6b-q8_0.gguf"} {
			must(t, os.MkdirAll(filepath.Dir(filepath.Join(model, file)), 0700))
			must(t, os.WriteFile(filepath.Join(model, file), nil, 0600))
		}
		must(t, wb.Store.Update(func(s *schema.State) {
			s.Models = append(s.Models, schema.InstalledModel{ID: "lyric-align-q8", Path: model})
		}, true))
	}
	must(t, os.MkdirAll(filepath.Join(wb.Store.Root, "outputs"), 0700))
	must(t, audio.WriteMono(filepath.Join(wb.Store.Root, "outputs", "song.wav"), make([]float32, 3*44100), 44100))
	id := "0123456789abcdef0123456789abcdef"
	must(t, wb.Store.Update(func(s *schema.State) {
		s.History = []schema.Generation{{ID: id, FileName: "song.wav", Duration: 3, Settings: d, LyricTimes: []float64{0, 1}}}
	}, true))
	return wb, id
}

// 没装对齐模型时直接提示下载，不启动任务；对齐是可选能力。
func TestAlignLyricsNeedsModel(t *testing.T) {
	wb, id := alignWorkbench(t, false)
	if e := wb.AlignLyrics(id, nil); !isCode(e, msg.ErrAlignModelRequired) {
		t.Fatalf("%v", e)
	}
}

// 先分离人声再对齐：逐字结果写进版本，并替换掉旧的手动校准。
func TestAlignLyrics(t *testing.T) {
	wb, id := alignWorkbench(t, true)
	must(t, wb.AlignLyrics(id, nil))
	<-wb.Done()
	s := wb.Store.Read()
	if s.Activity.Status != "completed" || s.Activity.Task != "align" {
		t.Fatalf("%+v %v %v", s.Activity, *s.Activity.ErrorCode, s.Activity.ErrorParams)
	}
	// 测试引擎分出的人声在 0.5–1 秒和 2.5–3 秒有声，去掉中间的空白后送去对齐，时间再换回原曲：
	// 拼接后的 0 秒是原曲 0.2 秒（留了 0.3 秒余量），字不会落在两段之间的空白里。
	g := s.History[0]
	if g.LyricTimes != nil || len(g.LyricWords) != 5 || g.LyricWords[0].Word != "晚" || g.LyricWords[0].Start != 0.2 || g.LyricWords[1].Start != 0.45 || g.LyricWords[4].Start != 1.2 || g.LyricWords[4].End != 2.288 {
		t.Fatalf("%+v %+v", g.LyricTimes, g.LyricWords)
	}
	// 分离结果缓存下来，重新对齐同一版本时不再分离；唱的部分不超过对齐模型的上限时整首一次对齐。
	if cached, _ := filepath.Glob(filepath.Join(wb.Store.Root, "runtime", "align-vocals-*.wav")); len(cached) != 1 || filepath.Base(cached[0]) != "align-vocals-"+id+".wav" {
		t.Fatalf("%v", cached)
	}
	must(t, wb.AlignLyrics(id, []LyricLine{{Text: "晚风 轻", Start: 0, End: 0.5}, {Text: "夏夜", Start: 0.5, End: 1}}))
	<-wb.Done()
	if w := wb.Store.Read().History[0].LyricWords; len(w) != 5 || w[3].Word != "夏" || w[3].Start != 0.95 {
		t.Fatalf("%+v", w)
	}
	// 手动校准反过来清掉对齐结果。
	must(t, wb.SetLyricTimes(id, []float64{0, 2}))
	if g := wb.Store.Read().History[0]; g.LyricWords != nil {
		t.Fatalf("%+v", g.LyricWords)
	}
	if e := wb.AlignLyrics(id, []LyricLine{{Text: "夏夜", Start: 2, End: 1}}); !isCode(e, msg.ErrRequestInvalid) {
		t.Fatalf("%v", e)
	}
}

func isCode(e error, code msg.Code) bool {
	c, ok := e.(*msg.CallError)
	return ok && c.Code == code
}

func TestAlignLanguage(t *testing.T) {
	for text, want := range map[string]string{"夏夜晚风": "Chinese", "さくら 桜": "Japanese", "사랑해": "Korean", "summer night": "English", "белая ночь": "Russian"} {
		if got := alignLanguage(text); got != want {
			t.Fatalf("%s: %s", text, got)
		}
	}
}

// 人声区间：短停顿并入演唱，长空白去掉；拼接后的时间能换回原曲。日文逐字加空格，其余语言原样。
func TestVoicedSpans(t *testing.T) {
	const rate = 16000
	samples := make([]float32, 10*rate)
	for _, burst := range [][2]float64{{1, 2}, {2.5, 3}, {6, 7}} {
		for i := int(burst[0] * rate); i < int(burst[1]*rate); i++ {
			samples[i] = .3
		}
	}
	spans := voicedSpans(samples, rate)
	want := [][2]int{{int(.7 * rate), int(3.3 * rate)}, {int(5.7 * rate), int(7.3 * rate)}}
	if len(spans) != 2 || spans[0] != want[0] || spans[1] != want[1] {
		t.Fatalf("%v", spans)
	}
	if spanLength(spans, 0, 6*rate) != int(2.6*rate)+int(.3*rate) {
		t.Fatal(spanLength(spans, 0, 6*rate))
	}
	if got := sourceTime(spans, 2.6, false); got != 5.7 {
		t.Fatal(got)
	}
	if got := sourceTime(spans, 2.6, true); got != 3.3 {
		t.Fatal(got)
	}
	if voicedSpans(make([]float32, rate), rate) != nil {
		t.Fatal("静音没有人声")
	}
	if got := alignText("さくら 咲く", "Japanese"); strings.Join(strings.Fields(got), "|") != "さ|く|ら|咲|く" {
		t.Fatal(got)
	}
	if alignText("summer night", "English") != "summer night" {
		t.Fatal("英文不变")
	}
}

// 长歌按句分组：每组人声不超过上限，切点挪到两行之间的人声空隙里。
func TestGroupLines(t *testing.T) {
	const rate = alignRate
	sec := func(v float64) int { return int(v * rate) }
	// 四段 30 秒的演唱，中间各隔 2 秒；每段唱两行。
	spans := [][2]int{{0, sec(30)}, {sec(32), sec(62)}, {sec(64), sec(94)}, {sec(96), sec(126)}}
	var lines []LyricLine
	for k := 0; k < 8; k++ {
		start := float64(k/2)*32 + float64(k%2)*15
		lines = append(lines, LyricLine{Text: fmt.Sprintf("第%d行", k), Start: start + .5, End: start + 14})
	}
	groups := groupLines(lines, spans, sec(130))
	if len(groups) != 2 || groups[0].from != 0 || groups[0].to != sec(95) || groups[1].from != sec(95) || groups[1].to != sec(130) {
		t.Fatalf("%+v", groups)
	}
	if strings.Count(groups[0].text, "\n") != 5 || !strings.HasPrefix(groups[1].text, "第6行") {
		t.Fatalf("%q %q", groups[0].text, groups[1].text)
	}
	for _, g := range groups {
		if spanLength(spans, g.from, g.to) > sec(alignChunkSeconds) {
			t.Fatalf("%+v", g)
		}
	}
	// 唱的部分不超过上限时整首一组。
	if g := groupLines(lines[:2], spans[:1], sec(40)); len(g) != 1 || g[0].to != sec(40) {
		t.Fatalf("%+v", g)
	}
	if got := trimSpans([][2]int{{0, 10}, {20, 30}}, 15); len(got) != 2 || got[1] != [2]int{20, 25} {
		t.Fatalf("%v", got)
	}
}

// 封面用的响度起伏第一次要时从音频算出来并随版本保存，之后直接用保存的；静音的歌算不出来，留空。
func TestGenerationGene(t *testing.T) {
	wb, id := alignWorkbench(t, false)
	if gene, e := wb.GenerationGene(id); e != nil || gene != "" {
		t.Fatalf("静音不应有起伏: %q %v", gene, e)
	}
	tone := make([]float32, 3*44100)
	for i := range tone {
		tone[i] = float32(i) / float32(len(tone))
	}
	must(t, audio.WriteMono(filepath.Join(wb.Store.Root, "outputs", "song.wav"), tone, 44100))
	gene, e := wb.GenerationGene(id)
	if e != nil || len(gene) != audio.GeneLength || gene[len(gene)-1] != 'f' || wb.Store.Read().History[0].Gene != gene {
		t.Fatalf("%q %v", gene, e)
	}
	must(t, os.Remove(filepath.Join(wb.Store.Root, "outputs", "song.wav")))
	// 保存过的起伏直接返回，不再读音频。
	if again, e := wb.GenerationGene(id); e != nil || again != gene {
		t.Fatalf("%q %v", again, e)
	}
	if _, e := wb.GenerationGene("ffffffffffffffffffffffffffffffff"); !isCode(e, msg.ErrAudioMissing) {
		t.Fatalf("%v", e)
	}
}
