package audio

import (
	"context"
	"errors"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"yovoice/internal/msg"
	"yovoice/internal/platform"
)

// Converter 只使用安装包中的转换器，不在运行时下载或依赖系统 PATH。
func Converter() (string, error) {
	name := "ffmpeg"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	path, err := platform.PackagedTool(name)
	if errors.Is(err, platform.ErrToolMissing) {
		return "", msg.Err(msg.ErrAudioConverterMissing, nil)
	}
	return path, err
}

func Convert(ctx context.Context, executable, input, output string) error {
	return ConvertWithLimit(ctx, executable, input, output, 60)
}

func ConvertWithLimit(ctx context.Context, executable, input, output string, seconds int) error {
	input, err := filepath.Abs(input)
	if err != nil {
		return err
	}
	// 禁用网络和播放列表，只读取本地常见音频容器；多解码一秒用于拒绝超长输入。
	cmd := exec.CommandContext(ctx, executable, "-nostdin", "-v", "error", "-xerror",
		"-protocol_whitelist", "file", "-format_whitelist", "wav,mp3,mov,aac,flac,ogg,aiff,asf,matroska,webm",
		"-i", input, "-map", "0:a:0", "-vn", "-t", strconv.Itoa(seconds+1), "-ac", "1", "-ar", "24000",
		"-c:a", "pcm_s16le", "-map_metadata", "-1", "-y", output)
	platform.ConfigureProcess(cmd)
	if err = cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return msg.Err(msg.ErrAudioDecode, msg.Params{"detail": err.Error()})
	}
	return nil
}
