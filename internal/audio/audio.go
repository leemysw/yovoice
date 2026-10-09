// Package audio 解析 WAV 并通过随包转换器转码常见音频格式。
package audio

import (
	"encoding/binary"
	"io"
	"os"
	"yovoice/internal/msg"
)

func Duration(path string) (float64, error) {
	f, e := os.Open(path)
	if e != nil {
		return 0, e
	}
	defer f.Close()
	info, e := f.Stat()
	if e != nil {
		return 0, e
	}
	bad := msg.Err(msg.ErrAudioFormat, nil)
	header := make([]byte, 12)
	if _, e = io.ReadFull(f, header); e != nil || string(header[:4]) != "RIFF" || string(header[8:]) != "WAVE" {
		return 0, bad
	}
	var byteRate, dataLength uint32
	for pos := int64(12); pos+8 <= info.Size(); {
		h := make([]byte, 8)
		if _, e = io.ReadFull(f, h); e != nil {
			return 0, e
		}
		size := binary.LittleEndian.Uint32(h[4:])
		pos += 8
		if pos+int64(size) > info.Size() {
			return 0, bad
		}
		switch string(h[:4]) {
		case "fmt ":
			if size < 16 {
				return 0, bad
			}
			b := make([]byte, 16)
			if _, e = io.ReadFull(f, b); e != nil {
				return 0, e
			}
			u16 := binary.LittleEndian.Uint16
			u32 := binary.LittleEndian.Uint32
			format, channels, rate, align, bits := u16(b), u16(b[2:]), u32(b[4:]), u16(b[12:]), u16(b[14:])
			byteRate = u32(b[8:])
			if (format != 1 && format != 3) || channels < 1 || channels > 2 || rate < 8000 || rate > 192000 || (bits != 16 && bits != 24 && bits != 32) || (format == 3 && bits != 32) || align != channels*bits/8 || byteRate != rate*uint32(align) {
				return 0, bad
			}
		case "data":
			dataLength = size
		}
		pos += int64(size) + int64(size%2)
		if _, e = f.Seek(pos, io.SeekStart); e != nil {
			return 0, e
		}
	}
	if byteRate == 0 || dataLength == 0 {
		return 0, bad
	}
	return float64(dataLength) / float64(byteRate), nil
}
