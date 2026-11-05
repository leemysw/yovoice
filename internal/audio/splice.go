package audio

import (
	"bufio"
	"encoding/binary"
	"io"
	"math"
	"os"
	"yovoice/internal/msg"
)

// SpliceRange 是一次局部替换：原音频的 [From, To) 秒换成替换音频的 [SourceFrom, SourceTo) 秒。
type SpliceRange struct {
	From, To, SourceFrom, SourceTo float64
}

// Splice 把 replacement 的一段换进 original，写到 output。
// 区间外的原始采样按字节原样复制，一位都不变；交叉淡化只发生在区间内部，开头和结尾各 fade 秒。
// 替换段按两段音频的整体响度比调整音量，避免接缝处忽大忽小。两段的采样率和声道数必须相同。
func Splice(original, replacement, output string, r SpliceRange, fade float64) error {
	of, p, e := openPCM(original, os.O_RDONLY)
	if e != nil {
		return e
	}
	defer of.Close()
	rf, q, e := openPCM(replacement, os.O_RDONLY)
	if e != nil {
		return e
	}
	defer rf.Close()
	if p.rate != q.rate || p.channels != q.channels {
		return msg.Err(msg.ErrAudioFormat, nil)
	}
	frames := func(pc pcm) int64 { return pc.size / int64(pc.frame()) }
	at := func(seconds float64, pc pcm) int64 {
		return max(0, min(frames(pc), int64(math.Round(seconds*float64(pc.rate)))))
	}
	s0, s1 := at(r.From, p), at(r.To, p)
	r0, r1 := at(r.SourceFrom, q), at(r.SourceTo, q)
	if s1 <= s0 || r1 <= r0 {
		return msg.Err(msg.ErrRequestInvalid, nil)
	}
	gain, e := levelRatio(of, p, rf, q)
	if e != nil {
		return e
	}
	channels := int(p.channels)
	middle, e := readFrames(rf, q, r0, r1)
	if e != nil {
		return e
	}
	length := int64(len(middle) / channels)
	fadeFrames := min(int64(fade*float64(p.rate)), length/2, (s1-s0)/2)
	head, e := readFrames(of, p, s0, s0+fadeFrames)
	if e != nil {
		return e
	}
	tail, e := readFrames(of, p, s1-fadeFrames, s1)
	if e != nil {
		return e
	}
	for i := range middle {
		middle[i] *= gain
	}
	for k := range fadeFrames {
		// 等功率淡化：两段不相关时整体响度保持不变。
		g := math.Sin(float64(k) / float64(fadeFrames) * math.Pi / 2)
		for c := range channels {
			in := int(k)*channels + c
			middle[in] = float32(float64(middle[in])*g + float64(head[in])*math.Sqrt(1-g*g))
			out := int(length-fadeFrames+k)*channels + c
			middle[out] = float32(float64(middle[out])*math.Sqrt(1-g*g) + float64(tail[in])*g)
		}
	}
	encoded := make([]byte, len(middle)*int(p.bits/8))
	p.encode(middle, encoded)
	size := s0*int64(p.frame()) + int64(len(encoded)) + (frames(p)-s1)*int64(p.frame())
	f, e := os.OpenFile(output, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if e != nil {
		return e
	}
	w := bufio.NewWriterSize(f, 1<<20)
	e = writeHeader(w, p, size)
	if e == nil {
		_, e = io.Copy(w, io.NewSectionReader(of, p.offset, s0*int64(p.frame())))
	}
	if e == nil {
		_, e = w.Write(encoded)
	}
	if e == nil {
		_, e = io.Copy(w, io.NewSectionReader(of, p.offset+s1*int64(p.frame()), (frames(p)-s1)*int64(p.frame())))
	}
	if e == nil {
		e = w.Flush()
	}
	if c := f.Close(); e == nil {
		e = c
	}
	if e != nil {
		_ = os.Remove(output)
	}
	return e
}

// readFrames 读出 [from, to) 帧的交错采样。
func readFrames(f *os.File, p pcm, from, to int64) ([]float32, error) {
	raw := make([]byte, (to-from)*int64(p.frame()))
	if _, e := f.ReadAt(raw, p.offset+from*int64(p.frame())); e != nil && e != io.EOF {
		return nil, e
	}
	out := make([]float32, len(raw)/int(p.bits/8))
	p.decode(raw, out)
	return out, nil
}

// levelRatio 是两段音频整体均方根之比（原/替换），限制在 0.5–2 之间。
func levelRatio(of *os.File, p pcm, rf *os.File, q pcm) (float32, error) {
	rms := func(f *os.File, pc pcm) (float64, error) {
		var sum float64
		var n int64
		e := pc.scan(f, func(samples []float32) {
			for _, v := range samples {
				sum += float64(v) * float64(v)
			}
			n += int64(len(samples))
		})
		return math.Sqrt(sum / float64(max(n, 1))), e
	}
	a, e := rms(of, p)
	if e != nil {
		return 1, e
	}
	b, e := rms(rf, q)
	if e != nil || b < 1e-6 {
		return 1, e
	}
	return float32(max(0.5, min(2, a/b))), nil
}

// writeHeader 写出只含 fmt 与 data 的标准 WAV 头，采样格式与原文件相同。
func writeHeader(w io.Writer, p pcm, size int64) error {
	b := make([]byte, 44)
	copy(b, "RIFF")
	binary.LittleEndian.PutUint32(b[4:], uint32(36+size))
	copy(b[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(b[16:], 16)
	binary.LittleEndian.PutUint16(b[20:], p.format)
	binary.LittleEndian.PutUint16(b[22:], p.channels)
	binary.LittleEndian.PutUint32(b[24:], uint32(p.rate))
	binary.LittleEndian.PutUint32(b[28:], uint32(p.rate*p.frame()))
	binary.LittleEndian.PutUint16(b[32:], uint16(p.frame()))
	binary.LittleEndian.PutUint16(b[34:], p.bits)
	copy(b[36:], "data")
	binary.LittleEndian.PutUint32(b[40:], uint32(size))
	_, e := w.Write(b)
	return e
}
