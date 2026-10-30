package audio

import (
	"math"
)

// 响度按 ITU-R BS.1770-4 测量：K 加权后 400 ms 块、75% 重叠，-70 LUFS 绝对门限加 -10 LU 相对门限；
// 真峰值按 4 倍过采样求。都是纯测量，不用模型，长音频分块送入，内存只随时长线性增长（每 100 ms 一个数）。

// Silence 是静音或测不出响度时报告的下限（LUFS / dBTP），避免把负无穷写进 JSON。
const Silence = -70.0

type biquad struct{ b0, b1, b2, a1, a2, z1, z2 float64 }

func (f *biquad) step(x float64) float64 {
	y := f.b0*x + f.z1
	f.z1 = f.b1*x - f.a1*y + f.z2
	f.z2 = f.b2*x - f.a2*y
	return y
}

// kWeighting 按采样率算出 K 加权两级滤波（高架 + 高通），公式与 libebur128 相同，48 kHz 时即标准系数。
func kWeighting(rate int) [2]biquad {
	fs := float64(rate)
	f0, gain, q := 1681.974450955533, 3.999843853973347, 0.7071752369554196
	k := math.Tan(math.Pi * f0 / fs)
	vh := math.Pow(10, gain/20)
	vb := math.Pow(vh, 0.4996667741545416)
	a0 := 1 + k/q + k*k
	shelf := biquad{b0: (vh + vb*k/q + k*k) / a0, b1: 2 * (k*k - vh) / a0, b2: (vh - vb*k/q + k*k) / a0, a1: 2 * (k*k - 1) / a0, a2: (1 - k/q + k*k) / a0}
	f0, q = 38.13547087602444, 0.5003270373238773
	k = math.Tan(math.Pi * f0 / fs)
	a0 = 1 + k/q + k*k
	pass := biquad{b0: 1, b1: -2, b2: 1, a1: 2 * (k*k - 1) / a0, a2: (1 - k/q + k*k) / a0}
	return [2]biquad{shelf, pass}
}

// oversample 是 4 倍过采样插值滤波器：12 抽头 × 4 相的加窗 sinc。
var oversample = func() [4][12]float64 {
	var h [4][12]float64
	const taps = 48
	for n := 0; n < taps; n++ {
		x := (float64(n) - (taps-1)/2.0) / 4
		sinc := 1.0
		if x != 0 {
			sinc = math.Sin(math.Pi*x) / (math.Pi * x)
		}
		window := 0.42 - 0.5*math.Cos(2*math.Pi*float64(n)/(taps-1)) + 0.08*math.Cos(4*math.Pi*float64(n)/(taps-1))
		h[n%4][n/4] = sinc * window
	}
	// 每一相的系数和归一为 1，直流增益不随相位变化。
	for p := range h {
		sum := 0.0
		for _, v := range h[p] {
			sum += v
		}
		for k := range h[p] {
			h[p][k] /= sum
		}
	}
	return h
}()

// Meter 逐块累计多声道的响度与真峰值。
type Meter struct {
	rate, channels int
	filters        [][2]biquad
	history        [][12]float64
	quarter        int       // 100 ms 的采样数
	filled         int       // 当前 100 ms 已累计的帧数
	energy         []float64 // 当前 100 ms 各声道 K 加权能量和
	quarters       [][]float64
	peak           float64 // 真峰值（线性）
	sample         float64 // 采样峰值（线性）
	frames         int
}

func NewMeter(rate, channels int) *Meter {
	m := &Meter{rate: rate, channels: channels, quarter: max(1, rate/10), energy: make([]float64, channels), history: make([][12]float64, channels)}
	for range channels {
		m.filters = append(m.filters, kWeighting(rate))
	}
	return m
}

// Write 送入交错排列的采样，长度须为声道数的整数倍。
func (m *Meter) Write(samples []float32) {
	for i := 0; i+m.channels <= len(samples); i += m.channels {
		for c := 0; c < m.channels; c++ {
			x := float64(samples[i+c])
			m.sample = max(m.sample, math.Abs(x))
			h := &m.history[c]
			copy(h[1:], h[:11])
			h[0] = x
			for p := range oversample {
				y := 0.0
				for k, v := range oversample[p] {
					y += v * h[k]
				}
				m.peak = max(m.peak, math.Abs(y))
			}
			f := &m.filters[c]
			y := f[1].step(f[0].step(x))
			m.energy[c] += y * y
		}
		m.frames++
		if m.filled++; m.filled == m.quarter {
			m.quarters = append(m.quarters, m.energy)
			m.energy, m.filled = make([]float64, m.channels), 0
		}
	}
}

// Loudness 返回整体响度（LUFS）；全程低于绝对门限时返回 Silence。不足 400 ms 的音频按整段算一个块。
func (m *Meter) Loudness() float64 {
	var blocks []float64
	if len(m.quarters) < 4 {
		total, n := 0.0, float64(m.frames)
		for _, q := range append(m.quarters, m.energy) {
			for _, v := range q {
				total += v
			}
		}
		if n > 0 {
			blocks = append(blocks, total/n)
		}
	}
	for i := 0; i+4 <= len(m.quarters); i++ {
		total := 0.0
		for _, q := range m.quarters[i : i+4] {
			for _, v := range q {
				total += v
			}
		}
		blocks = append(blocks, total/float64(4*m.quarter))
	}
	gate := func(threshold float64) (float64, int) {
		sum, n := 0.0, 0
		for _, z := range blocks {
			if z > 0 && -0.691+10*math.Log10(z) > threshold {
				sum += z
				n++
			}
		}
		return sum, n
	}
	sum, n := gate(-70)
	if n == 0 {
		return Silence
	}
	sum, n = gate(-0.691 + 10*math.Log10(sum/float64(n)) - 10)
	if n == 0 {
		return Silence
	}
	return max(Silence, -0.691+10*math.Log10(sum/float64(n)))
}

// TruePeak 返回真峰值（dBTP），至少不低于采样峰值。
func (m *Meter) TruePeak() float64 { return decibels(max(m.peak, m.sample)) }

func decibels(linear float64) float64 {
	if linear <= 0 {
		return Silence
	}
	return max(Silence, 20*math.Log10(linear))
}
