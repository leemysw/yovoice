package engine

import (
	"encoding/binary"
	"errors"
	"io"
	"os"
)

// GGUFArchitecture 只读取 GGUF v2/v3 的家族标识，不加载权重；自转换模型仍由推理引擎校验张量。
func GGUFArchitecture(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return "", err
	}
	r := io.NewSectionReader(f, 0, info.Size())
	invalid := errors.New("invalid GGUF metadata")
	var header struct {
		Magic             [4]byte
		Version           uint32
		Tensors, Metadata uint64
	}
	if binary.Read(r, binary.LittleEndian, &header) != nil || string(header.Magic[:]) != "GGUF" || (header.Version != 2 && header.Version != 3) || header.Tensors == 0 || header.Metadata > 1<<20 {
		return "", invalid
	}
	for range header.Metadata {
		key, err := ggufString(r)
		if err != nil {
			return "", invalid
		}
		var kind uint32
		if binary.Read(r, binary.LittleEndian, &kind) != nil {
			return "", invalid
		}
		if key == "general.architecture" {
			if kind != 8 {
				return "", invalid
			}
			return ggufString(r)
		}
		if err := skipGGUFValue(r, kind, 1); err != nil {
			return "", err
		}
	}
	return "", invalid
}

func ggufString(r *io.SectionReader) (string, error) {
	var n uint64
	if binary.Read(r, binary.LittleEndian, &n) != nil || n > 1<<20 {
		return "", io.ErrUnexpectedEOF
	}
	data := make([]byte, int(n))
	_, err := io.ReadFull(r, data)
	return string(data), err
}

func skipGGUFValue(r *io.SectionReader, kind uint32, count uint64) error {
	// 数组的长度来自文件，先按剩余字节约束，避免溢出、超大分配和损坏文件的空转。
	pos, err := r.Seek(0, io.SeekCurrent)
	if err != nil {
		return err
	}
	remaining := uint64(r.Size() - pos)
	sizes := map[uint32]uint64{0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8}
	if size, ok := sizes[kind]; ok {
		if count > remaining/size {
			return io.ErrUnexpectedEOF
		}
		_, err = r.Seek(int64(count*size), io.SeekCurrent)
		return err
	}
	if kind == 8 {
		if count > remaining/8 || count > 1<<20 {
			return io.ErrUnexpectedEOF
		}
		for range count {
			var n uint64
			if err := binary.Read(r, binary.LittleEndian, &n); err != nil {
				return err
			}
			if err := skipGGUFValue(r, 0, n); err != nil {
				return err
			}
		}
		return nil
	}
	if kind == 9 && count == 1 {
		var element uint32
		var n uint64
		if binary.Read(r, binary.LittleEndian, &element) != nil || binary.Read(r, binary.LittleEndian, &n) != nil || element == 9 {
			return io.ErrUnexpectedEOF
		}
		return skipGGUFValue(r, element, n)
	}
	return errors.New("invalid GGUF value type")
}
