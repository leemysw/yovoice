package audio

import (
	"encoding/binary"
	"io"
	"math"
	"os"
	"path/filepath"
	"yovoice/internal/msg"
)

// pcm 描述 WAV 里的采样格式与 data 块位置，供整段读取和分块处理共用。
type pcm struct {
	format, channels, bits uint16
	rate                   int
	offset, size           int64
}

func (p pcm) frame() int { return int(p.bits/8) * int(p.channels) }

// openPCM 打开 PCM（16/24/32 位整数或 32 位浮点）WAV 并定位 data 块；调用方负责关闭文件。
func openPCM(path string, flag int) (*os.File, pcm, error) {
	f, e := os.OpenFile(path, flag, 0)
	if e != nil {
		return nil, pcm{}, e
	}
	p, e := readPCM(f)
	if e != nil {
		_ = f.Close()
		return nil, pcm{}, e
	}
	return f, p, nil
}

func readPCM(f *os.File) (pcm, error) {
	info, e := f.Stat()
	if e != nil {
		return pcm{}, e
	}
	bad := msg.Err(msg.ErrAudioFormat, nil)
	head := make([]byte, 12)
	if _, e = io.ReadFull(f, head); e != nil || string(head[:4]) != "RIFF" || string(head[8:]) != "WAVE" {
		return pcm{}, bad
	}
	var p pcm
	found := false
	for pos := int64(12); pos+8 <= info.Size(); {
		h := make([]byte, 8)
		if _, e = f.ReadAt(h, pos); e != nil {
			return pcm{}, bad
		}
		size := int64(binary.LittleEndian.Uint32(h[4:]))
		body := pos + 8
		if body+size > info.Size() {
			// 流式写出的 WAV 可能把 data 长度写成 0 或超出文件，按到文件末尾处理。
			if string(h[:4]) != "data" {
				return pcm{}, bad
			}
			size = info.Size() - body
		}
		switch string(h[:4]) {
		case "fmt ":
			if size < 16 {
				return pcm{}, bad
			}
			b := make([]byte, min(size, 26))
			if _, e = f.ReadAt(b, body); e != nil {
				return pcm{}, bad
			}
			p.format, p.channels = binary.LittleEndian.Uint16(b), binary.LittleEndian.Uint16(b[2:])
			p.rate, p.bits = int(binary.LittleEndian.Uint32(b[4:])), binary.LittleEndian.Uint16(b[14:])
			// WAVE_FORMAT_EXTENSIBLE 的真实格式在子格式 GUID 的前两个字节。
			if p.format == 0xFFFE && size >= 26 {
				p.format = binary.LittleEndian.Uint16(b[24:])
			}
		case "data":
			if size == 0 && body < info.Size() {
				size = info.Size() - body
			}
			p.offset, p.size, found = body, size, true
		}
		pos = body + size + size%2
	}
	if p.channels == 0 || p.rate <= 0 || !found || !(p.format == 1 && (p.bits == 16 || p.bits == 24 || p.bits == 32) || p.format == 3 && p.bits == 32) {
		return pcm{}, bad
	}
	p.size -= p.size % int64(p.frame())
	return p, nil
}

// decode 把交错排列的原始字节转成 -1~1 的交错采样。
func (p pcm) decode(b []byte, out []float32) {
	width := int(p.bits / 8)
	for i := range out {
		at := b[i*width:]
		switch {
		case p.format == 3:
			out[i] = math.Float32frombits(binary.LittleEndian.Uint32(at))
		case p.bits == 16:
			out[i] = float32(int16(binary.LittleEndian.Uint16(at))) / 32768
		case p.bits == 24:
			out[i] = float32(int32(uint32(at[0])<<8|uint32(at[1])<<16|uint32(at[2])<<24)>>8) / 8388608
		default:
			out[i] = float32(float64(int32(binary.LittleEndian.Uint32(at))) / 2147483648)
		}
	}
}

// encode 是 decode 的反向：整数格式按位深量化并限幅，浮点原样写回。
func (p pcm) encode(in []float32, b []byte) {
	width := int(p.bits / 8)
	for i, v := range in {
		at := b[i*width:]
		if p.format == 3 {
			binary.LittleEndian.PutUint32(at, math.Float32bits(v))
			continue
		}
		// 负半轴能到满幅 -1，正半轴最大为满幅减一个量化级，与 decode 的除数对应。
		x := max(-1, min(1, float64(v)))
		scale := func(full float64) float64 {
			if x < 0 {
				return math.Round(x * full)
			}
			return math.Min(math.Round(x*full), full-1)
		}
		switch p.bits {
		case 16:
			binary.LittleEndian.PutUint16(at, uint16(int16(scale(32768))))
		case 24:
			n := int32(scale(8388608))
			at[0], at[1], at[2] = byte(n), byte(n>>8), byte(n>>16)
		default:
			binary.LittleEndian.PutUint32(at, uint32(int32(scale(2147483648))))
		}
	}
}

// scan 按块读出交错采样交给 fn，不把整段音频放进内存；长导出也只占固定内存。
func (p pcm) scan(f *os.File, fn func(samples []float32)) error {
	frames := 1 << 15
	raw := make([]byte, frames*p.frame())
	samples := make([]float32, frames*int(p.channels))
	for at := int64(0); at < p.size; {
		n := min(int64(len(raw)), p.size-at)
		if _, e := f.ReadAt(raw[:n], p.offset+at); e != nil {
			return e
		}
		count := int(n) / int(p.bits/8)
		p.decode(raw[:n], samples[:count])
		fn(samples[:count])
		at += n
	}
	return nil
}

// Read 读取整段 PCM WAV，按声道返回 -1~1 的采样与采样率。
func Read(path string) ([][]float32, int, error) {
	f, p, e := openPCM(path, os.O_RDONLY)
	if e != nil {
		return nil, 0, e
	}
	defer f.Close()
	channels := make([][]float32, p.channels)
	for c := range channels {
		channels[c] = make([]float32, 0, p.size/int64(p.frame()))
	}
	e = p.scan(f, func(samples []float32) {
		for i, v := range samples {
			c := i % int(p.channels)
			channels[c] = append(channels[c], v)
		}
	})
	if e != nil {
		return nil, 0, e
	}
	return channels, p.rate, nil
}

// mix 把多声道平均成单声道，单声道直接返回原切片。
func mix(channels [][]float32) []float32 {
	if len(channels) == 1 {
		return channels[0]
	}
	out := make([]float32, len(channels[0]))
	for i := range out {
		var sum float64
		for _, c := range channels {
			sum += float64(c[i])
		}
		out[i] = float32(sum / float64(len(channels)))
	}
	return out
}

// Remainder 逐块计算 mix 减去各 parts 之和，写成与 mix 同采样率、同声道数的 32 位浮点 WAV（不限幅，
// 叠回去与原混音逐采样相同）。用于分轨：把其余各轨没分走的部分都归到最后一轨，保证各轨相加还原原曲。
// parts 的长度不足时按静音处理，声道少于 mix 时重复最后一个声道。只占固定内存。
func Remainder(mix string, parts []string, output string) error {
	mf, mp, e := openPCM(mix, os.O_RDONLY)
	if e != nil {
		return e
	}
	defer mf.Close()
	type source struct {
		f *os.File
		p pcm
	}
	sources := make([]source, 0, len(parts))
	defer func() {
		for _, s := range sources {
			_ = s.f.Close()
		}
	}()
	for _, path := range parts {
		f, p, e := openPCM(path, os.O_RDONLY)
		if e != nil {
			return e
		}
		sources = append(sources, source{f, p})
		if p.rate != mp.rate {
			return msg.Err(msg.ErrAudioFormat, nil)
		}
	}
	out, e := os.CreateTemp(filepath.Dir(output), ".remainder-*.wav")
	if e != nil {
		return e
	}
	temp := out.Name()
	defer func() { _ = os.Remove(temp) }()
	channels := int(mp.channels)
	frames := mp.size / int64(mp.frame())
	header := make([]byte, 44)
	copy(header, "RIFF")
	binary.LittleEndian.PutUint32(header[4:], uint32(36+frames*int64(channels)*4))
	copy(header[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(header[16:], 16)
	binary.LittleEndian.PutUint16(header[20:], 3)
	binary.LittleEndian.PutUint16(header[22:], uint16(channels))
	binary.LittleEndian.PutUint32(header[24:], uint32(mp.rate))
	binary.LittleEndian.PutUint32(header[28:], uint32(mp.rate*channels*4))
	binary.LittleEndian.PutUint16(header[32:], uint16(channels*4))
	binary.LittleEndian.PutUint16(header[34:], 32)
	copy(header[36:], "data")
	binary.LittleEndian.PutUint32(header[40:], uint32(frames*int64(channels)*4))
	if _, e = out.Write(header); e != nil {
		_ = out.Close()
		return e
	}
	const block = 1 << 15
	rest := make([]float32, block*channels)
	other := make([]float32, block*4)
	raw := make([]byte, block*max(mp.frame(), 8*4))
	result := pcm{format: 3, channels: mp.channels, bits: 32}
	encoded := make([]byte, block*channels*4)
	for at := int64(0); at < frames; at += block {
		n := int(min(block, frames-at))
		if _, e = mf.ReadAt(raw[:n*mp.frame()], mp.offset+at*int64(mp.frame())); e != nil {
			_ = out.Close()
			return e
		}
		mp.decode(raw[:n*mp.frame()], rest[:n*channels])
		for _, s := range sources {
			available := int(max(0, min(int64(n), s.p.size/int64(s.p.frame())-at)))
			if available == 0 {
				continue
			}
			width, count := s.p.frame(), int(s.p.channels)
			if len(raw) < available*width {
				raw = make([]byte, available*width)
			}
			if len(other) < available*count {
				other = make([]float32, available*count)
			}
			if _, e = s.f.ReadAt(raw[:available*width], s.p.offset+at*int64(width)); e != nil {
				_ = out.Close()
				return e
			}
			s.p.decode(raw[:available*width], other[:available*count])
			for i := 0; i < available; i++ {
				for c := 0; c < channels; c++ {
					rest[i*channels+c] -= other[i*count+min(c, count-1)]
				}
			}
		}
		result.encode(rest[:n*channels], encoded[:n*channels*4])
		if _, e = out.Write(encoded[:n*channels*4]); e != nil {
			_ = out.Close()
			return e
		}
	}
	if e = out.Close(); e != nil {
		return e
	}
	return os.Rename(temp, output)
}
