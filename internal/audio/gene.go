package audio

import "math"

// GeneLength 是响度基因的段数。
const GeneLength = 96

// LoudnessGene 把一首歌从头到尾分成 96 段，每段的响度（相对最响的一段）写成一个十六进制字符。
// 社区页用它画这首歌的唱片封面，所以算法要和落地页的 geneFromSound 保持一致。全静音或没有采样时返回空串。
func LoudnessGene(mono []float32) string {
	if len(mono) == 0 {
		return ""
	}
	levels, peak := make([]float64, GeneLength), 0.0
	for i := range levels {
		from := i * len(mono) / GeneLength
		to := max(from+1, (i+1)*len(mono)/GeneLength)
		sum := 0.0
		for _, v := range mono[from:min(to, len(mono))] {
			sum += float64(v) * float64(v)
		}
		levels[i] = math.Sqrt(sum / float64(to-from))
		peak = max(peak, levels[i])
	}
	if peak == 0 {
		return ""
	}
	gene := make([]byte, GeneLength)
	for i, level := range levels {
		gene[i] = "0123456789abcdef"[min(15, int(math.Round(math.Sqrt(level/peak)*15)))]
	}
	return string(gene)
}
