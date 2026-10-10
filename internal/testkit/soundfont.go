package testkit

import (
	"bytes"
	"encoding/binary"
	"math"
)

// SoundFont 返回一个最小的 SF2 音色库：一个循环正弦波样本，挂在 GM 0 号音色和 128 号鼓组上，
// 足以让编曲渲染跑通而无需下载真实音色库。
func SoundFont() []byte {
	le := binary.LittleEndian
	const period, cycles = 100, 40
	samples := make([]byte, (period*cycles+46)*2)
	for i := 0; i < period*cycles; i++ {
		le.PutUint16(samples[i*2:], uint16(int16(math.Sin(2*math.Pi*float64(i)/period)*12000)))
	}
	name := func(s string) []byte { b := make([]byte, 20); copy(b, s); return b }
	record := func(parts ...any) []byte {
		var b bytes.Buffer
		for _, p := range parts {
			_ = binary.Write(&b, binary.LittleEndian, p)
		}
		return b.Bytes()
	}
	chunk := func(id string, body []byte) []byte {
		b := append([]byte(id), make([]byte, 4)...)
		le.PutUint32(b[4:], uint32(len(body)))
		b = append(b, body...)
		if len(body)%2 == 1 {
			b = append(b, 0)
		}
		return b
	}
	list := func(kind string, chunks ...[]byte) []byte {
		return chunk("LIST", append([]byte(kind), bytes.Join(chunks, nil)...))
	}
	phdr := bytes.Join([][]byte{
		record(name("Sine"), uint16(0), uint16(0), uint16(0), uint32(0), uint32(0), uint32(0)),
		record(name("Drums"), uint16(0), uint16(128), uint16(1), uint32(0), uint32(0), uint32(0)),
		record(name("EOP"), uint16(0), uint16(0), uint16(2), uint32(0), uint32(0), uint32(0)),
	}, nil)
	pbag := record(uint16(0), uint16(0), uint16(1), uint16(0), uint16(2), uint16(0))
	pgen := record(uint16(41), uint16(0), uint16(41), uint16(0), uint16(0), uint16(0))
	inst := bytes.Join([][]byte{record(name("Sine"), uint16(0)), record(name("EOI"), uint16(1))}, nil)
	ibag := record(uint16(0), uint16(0), uint16(2), uint16(0))
	igen := record(uint16(54), uint16(1), uint16(53), uint16(0), uint16(0), uint16(0))
	shdr := bytes.Join([][]byte{
		record(name("Sine"), uint32(0), uint32(period*cycles), uint32(period), uint32(period*(cycles-1)), uint32(44100), uint8(69), int8(0), uint16(0), uint16(1)),
		record(name("EOS"), uint32(0), uint32(0), uint32(0), uint32(0), uint32(0), uint8(0), int8(0), uint16(0), uint16(0)),
	}, nil)
	emptyMod := make([]byte, 10)
	body := bytes.Join([][]byte{
		[]byte("sfbk"),
		list("INFO", chunk("ifil", record(uint16(2), uint16(1))), chunk("isng", []byte("EMU8000\x00")), chunk("INAM", []byte("Test\x00\x00"))),
		list("sdta", chunk("smpl", samples)),
		list("pdta", chunk("phdr", phdr), chunk("pbag", pbag), chunk("pmod", emptyMod), chunk("pgen", pgen),
			chunk("inst", inst), chunk("ibag", ibag), chunk("imod", emptyMod), chunk("igen", igen), chunk("shdr", shdr)),
	}, nil)
	return chunk("RIFF", body)
}
