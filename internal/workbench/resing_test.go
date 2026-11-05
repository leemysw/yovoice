package workbench

import (
	"bytes"
	"math"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"yovoice/internal/audio"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
	"yovoice/internal/score"
)

const resingABC = `X:1
T:
M:4/4
L:1/32
Q:1/4=90
V: Vocal clef=treble name="Vocal Melody" snm="Vocal"
V: Ins clef=treble name="Ins Melody" snm="Inst."
K:D
% verse
V: Vocal
"D"D8F8A8F8|"G"G8B8d16|"G"d16"A"c16|"D"d32|
V: Ins
Z4|
% chorus
V: Vocal
"D"D8F8A8F8|"G"G8B8d16|"G"d16"A"c16|"D"d32|
V: Ins
Z4|
`

func resingDraft(abc, lyrics string) schema.Draft {
	d := schema.DefaultDraft()
	d.Abc, d.Lyrics = abc, lyrics
	return d
}

// 改一个小节只重唱那一小节；改一段歌词重唱那段的全部小节；速度变了只能整首重来。
func TestResingSpans(t *testing.T) {
	lyrics := "[Verse]\n第一句\n[Chorus]\n副歌"
	before := resingDraft(resingABC, lyrics)
	if _, e := resingSpans(before, before, nil); !isCode(e, msg.ErrResingNoChange) {
		t.Fatalf("没改动应提示：%v", e)
	}
	melody := strings.Replace(resingABC, `"G"G8B8d16|"G"d16"A"c16|"D"d32|
V: Ins
Z4|
% chorus`, `"G"G8B8e16|"G"d16"A"c16|"D"d32|
V: Ins
Z4|
% chorus`, 1)
	spans, e := resingSpans(before, resingDraft(melody, lyrics), nil)
	if e != nil || !slices.Equal(spans, []resingSpan{{2, 2}}) {
		t.Fatalf("改第 2 小节：%v %v", spans, e)
	}
	spans, e = resingSpans(before, resingDraft(resingABC, "[Verse]\n第一句\n[Chorus]\n新的副歌"), nil)
	if e != nil || !slices.Equal(spans, []resingSpan{{5, 8}}) {
		t.Fatalf("改副歌歌词：%v %v", spans, e)
	}
	spans, e = resingSpans(before, before, []int{1, 1})
	if e != nil || !slices.Equal(spans, []resingSpan{{1, 1}}) {
		t.Fatalf("指定小节：%v %v", spans, e)
	}
	// 第 2 和第 4 小节相隔一个小节，并成一段。
	spans, e = resingSpans(before, resingDraft(melody, lyrics), []int{4, 4})
	if e != nil || !slices.Equal(spans, []resingSpan{{2, 4}}) {
		t.Fatalf("相隔一个小节应并成一段：%v %v", spans, e)
	}
	faster := strings.Replace(resingABC, "Q:1/4=90", "Q:1/4=100", 1)
	if _, e = resingSpans(before, resingDraft(faster, lyrics), nil); !isCode(e, msg.ErrResingWhole) {
		t.Fatalf("改速度应整首重来：%v", e)
	}
	if _, e = resingSpans(before, resingDraft(resingABC, "[Verse]\n第一句"), nil); !isCode(e, msg.ErrResingWhole) {
		t.Fatalf("段落数变了应整首重来：%v", e)
	}
	if _, e = resingSpans(before, before, []int{3, 99}); e == nil {
		t.Fatal("越界的小节应被拒绝")
	}
}

func TestLyricSections(t *testing.T) {
	got := lyricSections("[Verse]\n 一 \n二\n\n[Chorus]\n三\n")
	if !slices.Equal(got, []string{"[Verse]\n一\n二", "[Chorus]\n三"}) {
		t.Fatalf("%q", got)
	}
}

// 不是 YuE2 按谱生成的版本不能局部重唱。
func TestResingRejectsSource(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	id := schema.NewID()
	d := resingDraft(resingABC, "[Verse]\na")
	d.ModelID = "ace-step-1.5-turbo-q8"
	must(t, w.Store.Update(func(s *schema.State) {
		s.History = append(s.History, schema.Generation{ID: id, FileName: "a.wav", Settings: d})
	}, true))
	if err = w.ResingGeneration(id, d, nil); !isCode(err, msg.ErrResingSource) {
		t.Fatalf("%v", err)
	}
}

// 整首重唱比原版本晚 0.5 秒开始，换进来的段落仍应落在原版本对应的位置，前面的采样不变。
func TestSpliceTake(t *testing.T) {
	dir := t.TempDir()
	rate := 22050
	parsed, e := score.ParseABC(resingABC)
	must(t, e)
	song := func(lead float64, bar2 float64) []float32 {
		out := make([]float32, int(lead*float64(rate)))
		for bar := 1; bar <= parsed.Bars(); bar++ {
			from, to := parsed.BarSeconds(bar)
			freq := []float64{220, 262, 330, 392, 220, 262, 330, 392}[bar-1]
			if bar == 2 {
				freq = bar2
			}
			n := int((to - from) * float64(rate))
			for i := range n {
				// 每小节最后 0.1 秒留空，模拟换气。
				v := 0.0
				if i < n-rate/10 {
					v = 0.3 * math.Sin(2*math.Pi*freq*float64(i)/float64(rate))
				}
				out = append(out, float32(v))
			}
		}
		return append(out, make([]float32, rate)...)
	}
	original, take := filepath.Join(dir, "a.wav"), filepath.Join(dir, "b.wav")
	must(t, audio.WriteMono(original, song(0.2, 262), rate))
	must(t, audio.WriteMono(take, song(0.7, 494), rate))
	must(t, os.MkdirAll(filepath.Join(dir, "logs"), 0700))
	result, e := spliceTake(dir, dir, original, take, parsed, []resingSpan{{2, 2}})
	must(t, e)
	a, _ := os.ReadFile(original)
	b, _ := os.ReadFile(result)
	from, _ := parsed.BarSeconds(2)
	keep := 44 + int((0.2+from-0.9)*float64(rate))*2
	if !bytes.Equal(a[44:keep], b[44:keep]) {
		t.Fatal("改动段之前的采样被改了")
	}
	if d, _ := audio.Duration(result); math.Abs(d-func() float64 { d, _ := audio.Duration(original); return d }()) > 0.5 {
		t.Fatalf("时长变化过大：%v", d)
	}
}
