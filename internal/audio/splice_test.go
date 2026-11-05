package audio

import (
	"bytes"
	"math"
	"os"
	"path/filepath"
	"testing"
)

func tone(seconds float64, rate int, freq float64, from float64) []float32 {
	out := make([]float32, int(seconds*float64(rate)))
	for i := range out {
		out[i] = float32(0.3 * math.Sin(2*math.Pi*freq*(from+float64(i)/float64(rate))))
	}
	return out
}

// 区间外的采样逐字节不变，区间内换成替换音频。
func TestSpliceKeepsOutsideBitExact(t *testing.T) {
	dir := t.TempDir()
	rate := 8000
	original, replacement, out := filepath.Join(dir, "a.wav"), filepath.Join(dir, "b.wav"), filepath.Join(dir, "c.wav")
	if e := WriteMono(original, tone(4, rate, 220, 0), rate); e != nil {
		t.Fatal(e)
	}
	if e := WriteMono(replacement, tone(5, rate, 330, 0), rate); e != nil {
		t.Fatal(e)
	}
	if e := Splice(original, replacement, out, SpliceRange{From: 1, To: 2, SourceFrom: 1.5, SourceTo: 3}, 0.05); e != nil {
		t.Fatal(e)
	}
	a, _ := os.ReadFile(original)
	c, _ := os.ReadFile(out)
	head, tail := 44+1*rate*2, 44+2*rate*2
	if !bytes.Equal(a[44:head], c[44:head]) {
		t.Fatal("区间前的采样被改了")
	}
	// 替换段 1.5 秒比原区间 1 秒长 0.5 秒，后面的原始采样整体后移。
	if !bytes.Equal(a[tail:], c[len(c)-len(a[tail:]):]) {
		t.Fatal("区间后的采样被改了")
	}
	if d, _ := Duration(out); math.Abs(d-4.5) > 0.01 {
		t.Fatalf("时长 %v", d)
	}
}

// 同一段旋律整体推后 0.8 秒，对齐后应找回这个偏移。
func TestAlignFindsOffset(t *testing.T) {
	rate := 11025
	var a, b []float32
	b = append(b, make([]float32, int(0.8*float64(rate)))...)
	for i, f := range []float64{220, 262, 330, 392, 440, 349, 294, 247} {
		part := tone(1, rate, f, float64(i))
		a = append(a, part...)
		b = append(b, part...)
	}
	path, cost := Align(AlignFeatures(a, rate), AlignFeatures(b, rate))
	if cost > 0.2 {
		t.Fatalf("代价过高：%v", cost)
	}
	if got := MapSecond(path, 4); math.Abs(got-4.8) > 0.25 {
		t.Fatalf("4 秒处应对到约 4.8 秒，得到 %v", got)
	}
}
