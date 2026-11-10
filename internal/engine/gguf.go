package engine

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"os"
)

// GGUFArchitecture 只读取 GGUF v2/v3 的家族标识，不加载权重；自转换模型仍由推理引擎校验张量。
func GGUFArchitecture(path string) (string, error) {
	identity, err := readGGUFIdentity(path, false)
	return identity.Family, err
}

// GGUFIdentity 是目录扫描所需的标识。家族相同的不同变体仍须区分。
type GGUFIdentity struct {
	Family, WeightType, IndexVersion string
}

func ReadGGUFIdentity(path string) (GGUFIdentity, error) {
	return readGGUFIdentity(path, true)
}

func readGGUFIdentity(path string, detailed bool) (GGUFIdentity, error) {
	var identity GGUFIdentity
	f, err := os.Open(path)
	if err != nil {
		return identity, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return identity, err
	}
	r := io.NewSectionReader(f, 0, info.Size())
	invalid := errors.New("invalid GGUF metadata")
	var header struct {
		Magic             [4]byte
		Version           uint32
		Tensors, Metadata uint64
	}
	if binary.Read(r, binary.LittleEndian, &header) != nil || string(header.Magic[:]) != "GGUF" || (header.Version != 2 && header.Version != 3) || header.Tensors == 0 || header.Metadata > 1<<20 {
		return identity, invalid
	}
	var architecture, family, specFamily string
	var specVersion uint32
	var bpe, tiktoken bool
	for range header.Metadata {
		key, err := ggufString(r)
		if err != nil {
			return identity, invalid
		}
		var kind uint32
		if binary.Read(r, binary.LittleEndian, &kind) != nil {
			return identity, invalid
		}
		switch key {
		case "general.architecture", "audiocpp.model_spec.family", "audiocpp.model_spec.json", "audiocpp.weight_type":
			if kind != 8 {
				return identity, invalid
			}
			value, err := ggufString(r)
			if err != nil {
				return identity, err
			}
			switch key {
			case "general.architecture":
				architecture = value
			case "audiocpp.weight_type":
				identity.WeightType = value
			case "audiocpp.model_spec.family":
				family = value
			case "audiocpp.model_spec.json":
				var spec struct {
					Family string `json:"family"`
				}
				if err := json.Unmarshal([]byte(value), &spec); err != nil {
					return identity, invalid
				}
				specFamily = spec.Family
			}
		case "audiocpp.embedded_files.names":
			if !detailed {
				if err := skipGGUFValue(r, kind, 1); err != nil {
					return identity, err
				}
				break
			}
			var element uint32
			var count uint64
			if kind != 9 || binary.Read(r, binary.LittleEndian, &element) != nil ||
				binary.Read(r, binary.LittleEndian, &count) != nil || element != 8 || count > 4096 {
				return identity, invalid
			}
			for range count {
				name, err := ggufString(r)
				if err != nil {
					return identity, err
				}
				bpe = bpe || name == "bpe.model"
				tiktoken = tiktoken || name == "multilingual_zh_ja_yue_char_del.tiktoken"
			}
		case "audiocpp.model_spec.version":
			if kind != 4 || binary.Read(r, binary.LittleEndian, &specVersion) != nil {
				return identity, invalid
			}
		default:
			if err := skipGGUFValue(r, kind, 1); err != nil {
				return identity, err
			}
		}
		if architecture != "" && architecture != "audiocpp" {
			identity.Family = architecture
		} else if specVersion == 1 && family != "" && specFamily == family {
			identity.Family = family
		}
		if identity.Family != "" && !detailed {
			return identity, nil
		}
	}
	if identity.Family == "" {
		return identity, invalid
	}
	if identity.Family == "index_tts2" && bpe != tiktoken {
		identity.IndexVersion = "2.0"
		if tiktoken {
			identity.IndexVersion = "2.5"
		}
	}
	return identity, nil
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
