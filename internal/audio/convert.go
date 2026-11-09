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

// inputFormats 是转换器接受的本地音频容器，禁用其他格式以免读取网络或播放列表。
const inputFormats = "wav,mp3,mov,aac,flac,ogg,aiff,asf,matroska,webm"

func ConvertWithLimit(ctx context.Context, executable, input, output string, seconds int) error {
	input, err := filepath.Abs(input)
	if err != nil {
		return err
	}
	// 禁用网络和播放列表，只读取本地常见音频容器；多解码一秒用于拒绝超长输入。
	cmd := exec.CommandContext(ctx, executable, "-nostdin", "-v", "error", "-xerror",
		"-protocol_whitelist", "file", "-format_whitelist", inputFormats,
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

// ConvertStereo 把本地音频（与 ConvertWithLimit 相同的常见格式）转成 rate 的双声道 16 位 WAV，供分轨等要求固定输入格式的模型使用；单声道来源复制成两个声道。
func ConvertStereo(ctx context.Context, executable, input, output string, rate int) error {
	input, err := filepath.Abs(input)
	if err != nil {
		return err
	}
	cmd := exec.CommandContext(ctx, executable, "-nostdin", "-v", "error", "-xerror",
		"-protocol_whitelist", "file", "-format_whitelist", inputFormats, "-i", input, "-map", "0:a:0", "-vn",
		"-ac", "2", "-ar", strconv.Itoa(rate), "-c:a", "pcm_s16le", "-map_metadata", "-1", "-y", output)
	platform.ConfigureProcess(cmd)
	if err = cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return msg.Err(msg.ErrAudioDecode, msg.Params{"detail": err.Error()})
	}
	return nil
}
