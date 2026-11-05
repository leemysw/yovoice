package audio

import (
	"math"
	"math/cmplx"
)

// 两版演唱的对齐：同一首歌按同一份谱唱两遍，和声与旋律大体相同，但 YuE2 的实际节奏会有出入，
// 所以不能按谱面时间直接对位。这里把两段音频都切成 0.1 秒一帧的色度（12 个音级的能量）和响度，
// 再用动态时间规整（DTW）找出两版之间逐帧的对应关系。

// AlignRate 与 AlignHop 是对齐分析用的采样率和帧移：11025 Hz 下 1102 个采样约 0.1 秒。
const (
	AlignRate = 11025
	AlignHop  = 1102
	alignWin  = 2048
)

// AlignFrame 是一帧的特征：归一化的 12 维色度与对数响度。
type AlignFrame struct {
	Chroma [12]float32
	Level  float32
}

// AlignFeatures 计算单声道采样的逐帧特征，rate 是 samples 的采样率。
func AlignFeatures(samples []float32, rate int) []AlignFrame {
	mono := Resample(samples, rate, AlignRate)
	window := make([]float64, alignWin)
	for i := range window {
		window[i] = 0.5 - 0.5*math.Cos(2*math.Pi*float64(i)/float64(alignWin-1))
	}
	// 每个频点对应的音级；65 Hz 以下与 2 kHz 以上不计，避开鼓和齿音。
	pitch := make([]int, alignWin/2)
	for k := range pitch {
		f := float64(k) * AlignRate / alignWin
		if f < 65 || f > 2000 {
			pitch[k] = -1
			continue
		}
		pitch[k] = (int(math.Round(12*math.Log2(f/440)))%12 + 12 + 9) % 12
	}
	buf := make([]complex128, alignWin)
	var out []AlignFrame
	for at := 0; at+alignWin <= len(mono) || (at == 0 && len(mono) > 0); at += AlignHop {
		var energy float64
		for i := range buf {
			v := 0.0
			if at+i < len(mono) {
				v = float64(mono[at+i])
			}
			energy += v * v
			buf[i] = complex(v*window[i], 0)
		}
		fft(buf)
		var frame AlignFrame
		var chroma [12]float64
		for k, p := range pitch {
			if p >= 0 {
				chroma[p] += cmplx.Abs(buf[k])
			}
		}
		var norm float64
		for _, v := range chroma {
			norm += v * v
		}
		if norm = math.Sqrt(norm); norm > 1e-6 {
			for i, v := range chroma {
				frame.Chroma[i] = float32(v / norm)
			}
		}
		frame.Level = float32(10 * math.Log10(energy/alignWin+1e-10))
		out = append(out, frame)
		if at+alignWin > len(mono) {
			break
		}
	}
	return out
}

// frameCost 是两帧的差异：色度余弦距离加上响度差，安静帧只比响度。
func frameCost(a, b AlignFrame) float64 {
	quiet := float32(-50)
	level := math.Min(math.Abs(float64(a.Level-b.Level))/20, 1)
	if a.Level < quiet || b.Level < quiet {
		if a.Level < quiet && b.Level < quiet {
			return 0
		}
		return 1
	}
	var dot float64
	for i := range a.Chroma {
		dot += float64(a.Chroma[i] * b.Chroma[i])
	}
	return (1 - dot) + 0.5*level
}

// Align 用带宽约束的 DTW 对齐两段特征，返回 a 的每一帧对应的 b 帧号，以及路径上的平均代价（0 最像）。
func Align(a, b []AlignFrame) ([]int, float64) {
	n, m := len(a), len(b)
	if n == 0 || m == 0 {
		return nil, math.Inf(1)
	}
	// 带宽：两版的时间偏差不会超过总长的 15%，至少留 5 秒。
	band := max(50, max(n, m)*15/100, abs(n-m)+20)
	center := func(i int) int { return i * (m - 1) / max(n-1, 1) }
	width := 2*band + 1
	inf := float32(math.Inf(1))
	acc := make([]float32, n*width)
	for i := range acc {
		acc[i] = inf
	}
	cell := func(i, j int) int {
		k := j - center(i) + band
		if k < 0 || k >= width {
			return -1
		}
		return i*width + k
	}
	get := func(i, j int) float32 {
		if i < 0 || j < 0 || j >= m {
			return inf
		}
		if c := cell(i, j); c >= 0 {
			return acc[c]
		}
		return inf
	}
	for i := range n {
		lo, hi := max(0, center(i)-band), min(m-1, center(i)+band)
		for j := lo; j <= hi; j++ {
			cost := float32(frameCost(a[i], b[j]))
			best := float32(0)
			if i > 0 || j > 0 {
				best = min(get(i-1, j-1), get(i-1, j), get(i, j-1))
			}
			acc[cell(i, j)] = best + cost
		}
	}
	if get(n-1, m-1) == inf {
		return nil, math.Inf(1)
	}
	path := make([]int, n)
	steps := 0
	for i, j := n-1, m-1; ; steps++ {
		path[i] = j
		if i == 0 && j == 0 {
			break
		}
		diag, up, left := get(i-1, j-1), get(i-1, j), get(i, j-1)
		switch {
		case diag <= up && diag <= left:
			i, j = i-1, j-1
		case up <= left:
			i--
		default:
			j--
		}
	}
	return path, float64(get(n-1, m-1)) / float64(steps+1)
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

// fft 是原地的基 2 快速傅里叶变换，len(x) 必须是 2 的幂。
func fft(x []complex128) {
	n := len(x)
	for i, j := 1, 0; i < n; i++ {
		bit := n >> 1
		for ; j&bit != 0; bit >>= 1 {
			j ^= bit
		}
		j ^= bit
		if i < j {
			x[i], x[j] = x[j], x[i]
		}
	}
	for size := 2; size <= n; size <<= 1 {
		step := cmplx.Exp(complex(0, -2*math.Pi/float64(size)))
		for start := 0; start < n; start += size {
			w := complex(1, 0)
			for k := range size / 2 {
				u, v := x[start+k], x[start+k+size/2]*w
				x[start+k], x[start+k+size/2] = u+v, u-v
				w *= step
			}
		}
	}
}

// AlignSeconds 是一帧的时长（秒）。
const AlignSeconds = float64(AlignHop) / AlignRate

// QuietestSecond 返回 [from, to] 秒内最安静的一帧的起点，接缝放在这里最不容易听出来。
func QuietestSecond(frames []AlignFrame, from, to float64) float64 {
	lo, hi := max(0, int(from/AlignSeconds)), min(len(frames)-1, int(to/AlignSeconds))
	best := lo
	for i := lo; i <= hi; i++ {
		if frames[i].Level < frames[best].Level {
			best = i
		}
	}
	return float64(best) * AlignSeconds
}

// MapSecond 按对齐路径把 a 里的时间换成 b 里对应的时间。
func MapSecond(path []int, seconds float64) float64 {
	i := max(0, min(len(path)-1, int(math.Round(seconds/AlignSeconds))))
	return float64(path[i]) * AlignSeconds
}
