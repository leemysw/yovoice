package audio

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"yovoice/internal/msg"
	"yovoice/internal/platform"
)

// Tags 是写进导出文件的元数据：FLAC 写成 Vorbis 注释，M4A 写成 iTunes 标签。空字段不写。
type Tags struct {
	Title  string
	Album  string
	Artist string
	Lyrics string
}

// EncodeFormats 是 Encode 支持的有损/无损格式；WAV 不需要转码。
var EncodeFormats = []string{"flac", "m4a"}

// Encode 把 PCM WAV 转成 FLAC（无损）或 M4A（AAC 256 kbps），一并写入标签和封面。
// cover 是 JPEG 字节，空时不带封面；标签经 ffmetadata 文件传入，长歌词不受命令行长度限制。
// 16 位来源保持 16 位，24/32 位整数和浮点来源写成 24 位 FLAC。
func Encode(ctx context.Context, executable, input, output, format string, tags Tags, cover []byte) error {
	f, p, e := openPCM(input, os.O_RDONLY)
	if e != nil {
		return e
	}
	_ = f.Close()
	if len(cover) > 0 && !bytes.HasPrefix(cover, []byte{0xFF, 0xD8, 0xFF}) {
		return msg.Err(msg.ErrRequestInvalid, nil)
	}
	input, e = filepath.Abs(input)
	if e != nil {
		return e
	}
	work, e := os.MkdirTemp(filepath.Dir(output), "encode-")
	if e != nil {
		return e
	}
	defer os.RemoveAll(work)
	meta := filepath.Join(work, "tags.txt")
	if e = os.WriteFile(meta, []byte(ffmetadata(tags)), 0600); e != nil {
		return e
	}
	args := []string{"-nostdin", "-v", "error", "-xerror", "-protocol_whitelist", "file",
		"-f", "wav", "-i", input, "-f", "ffmetadata", "-i", meta}
	if len(cover) > 0 {
		image := filepath.Join(work, "cover.jpg")
		if e = os.WriteFile(image, cover, 0600); e != nil {
			return e
		}
		args = append(args, "-f", "jpeg_pipe", "-i", image)
	}
	args = append(args, "-map", "0:a:0", "-map_metadata", "1", "-map_chapters", "-1")
	if len(cover) > 0 {
		args = append(args, "-map", "2:v:0", "-c:v", "copy", "-disposition:v", "attached_pic")
	}
	switch format {
	case "flac":
		args = append(args, "-c:a", "flac", "-compression_level", "8")
		if p.bits > 16 || p.format == 3 {
			args = append(args, "-sample_fmt", "s32", "-bits_per_raw_sample", "24")
		}
		args = append(args, "-f", "flac")
	case "m4a":
		args = append(args, "-c:a", "aac", "-b:a", "256k", "-f", "ipod")
	default:
		return msg.Err(msg.ErrAudioFormat, nil)
	}
	temporary := filepath.Join(work, "out."+format)
	cmd := exec.CommandContext(ctx, executable, append(args, "-y", temporary)...)
	platform.ConfigureProcess(cmd)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if e = cmd.Run(); e != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return msg.Err(msg.ErrAudioEncode, msg.Params{"detail": strings.TrimSpace(stderr.String())})
	}
	return os.Rename(temporary, output)
}

// ffmetadata 按 FFmpeg 元数据文件格式写出标签：= ; # \ 与换行前加反斜杠转义。
func ffmetadata(tags Tags) string {
	escape := strings.NewReplacer(`\`, `\\`, "=", `\=`, ";", `\;`, "#", `\#`, "\r\n", "\\\n", "\n", "\\\n", "\r", "")
	var b strings.Builder
	b.WriteString(";FFMETADATA1\n")
	for _, field := range [][2]string{{"title", tags.Title}, {"album", tags.Album}, {"artist", tags.Artist}, {"lyrics", tags.Lyrics}} {
		if value := strings.TrimSpace(field[1]); value != "" {
			b.WriteString(field[0] + "=" + escape.Replace(value) + "\n")
		}
	}
	return b.String()
}
