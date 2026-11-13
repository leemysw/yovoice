package audio

import (
	"encoding/binary"
	"math"
	"yovoice/internal/platform"
)

// ReadMono 读取 PCM（16/24/32 位整数或 32 位浮点）WAV，多声道取平均，返回 -1~1 的采样与采样率。
func ReadMono(path string) ([]float32, int, error) {
	channels, rate, e := Read(path)
	if e != nil {
		return nil, 0, e
	}
	return mix(channels), rate, nil
}

// Resample 线性插值改变采样率；降采样时先按比例做滑动平均，压住混叠。只用于分析（分离人声、对齐歌词），不用于输出。
func Resample(samples []float32, from, to int) []float32 {
	if from == to || len(samples) == 0 {
		return samples
	}
	source := samples
	if from > to {
		width := from / to
		if width > 1 {
			source = make([]float32, len(samples))
			var sum float64
			for i, v := range samples {
				sum += float64(v)
				if i >= width {
					sum -= float64(samples[i-width])
				}
				source[i] = float32(sum / float64(min(i+1, width)))
			}
		}
	}
	out := make([]float32, int(int64(len(samples))*int64(to)/int64(from)))
	step := float64(from) / float64(to)
	for i := range out {
		at := float64(i) * step
		j := int(at)
		if j+1 >= len(source) {
			out[i] = source[len(source)-1]
			continue
		}
		f := float32(at - float64(j))
		out[i] = source[j]*(1-f) + source[j+1]*f
	}
	return out
}

// WriteMono 把采样写成 16 位单声道 WAV。
func WriteMono(path string, samples []float32, rate int) error {
	return Write(path, [][]float32{samples}, rate)
}

// Write 把各声道（等长）交错写成 16 位 WAV；整体原子写入，读取方不会看到只写了一半的文件（缓存会被当成截断的音频读走）。
func Write(path string, channels [][]float32, rate int) error {
	count, frames := len(channels), len(channels[0])
	b := make([]byte, 44+frames*count*2)
	copy(b, "RIFF")
	binary.LittleEndian.PutUint32(b[4:], uint32(len(b)-8))
	copy(b[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(b[16:], 16)
	binary.LittleEndian.PutUint16(b[20:], 1)
	binary.LittleEndian.PutUint16(b[22:], uint16(count))
	binary.LittleEndian.PutUint32(b[24:], uint32(rate))
	binary.LittleEndian.PutUint32(b[28:], uint32(rate*count*2))
	binary.LittleEndian.PutUint16(b[32:], uint16(count*2))
	binary.LittleEndian.PutUint16(b[34:], 16)
	copy(b[36:], "data")
	binary.LittleEndian.PutUint32(b[40:], uint32(frames*count*2))
	for i := range frames {
		for c, samples := range channels {
			binary.LittleEndian.PutUint16(b[44+(i*count+c)*2:], uint16(int16(math.Round(float64(max(-1, min(1, samples[i])))*32767))))
		}
	}
	return platform.WriteFileAtomic(path, b, 0600)
}
