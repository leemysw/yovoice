package audio

import (
	"strings"
	"testing"
)

func TestLoudnessGene(t *testing.T) {
	// 前半段轻、后半段响：基因前半是小数字，后半是 f。
	samples := make([]float32, 9600)
	for i := range samples {
		amplitude := float32(0.1)
		if i >= len(samples)/2 {
			amplitude = 0.9
		}
		if i%2 == 0 {
			amplitude = -amplitude
		}
		samples[i] = amplitude
	}
	gene := LoudnessGene(samples)
	if len(gene) != GeneLength || gene[:48] != strings.Repeat("5", 48) || gene[48:] != strings.Repeat("f", 48) {
		t.Fatalf("基因不对: %q", gene)
	}
	if LoudnessGene(nil) != "" || LoudnessGene(make([]float32, 500)) != "" {
		t.Fatal("没有声音时应当返回空串")
	}
	// 采样比段数还少也不能越界。
	if got := LoudnessGene([]float32{0.5, -0.5, 0.5}); len(got) != GeneLength {
		t.Fatalf("短音频的基因长度不对: %q", got)
	}
}
