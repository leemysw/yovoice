package audio

import (
	"context"
	"errors"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"yovoice/internal/msg"
	"yovoice/internal/platform"
)

// Converter 只使用安装包中的转换器，不在运行时下载或依赖系统 PATH。
func Converter() (string, error) { return packagedMediaTool("ffmpeg") }

// Prober 与转换器使用相同版本和格式白名单，确保探测的音轨编号与解码一致。
func Prober() (string, error) { return packagedMediaTool("ffprobe") }

func packagedMediaTool(name string) (string, error) {
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	path, err := platform.PackagedTool(name)
	if errors.Is(err, platform.ErrToolMissing) {
		return "", msg.Err(msg.ErrAudioConverterMissing, nil)
	}
	return path, err
}

// localInput 限制工具只读取本地常见容器，禁用网络和播放列表。
func localInput() []string {
	return []string{"-protocol_whitelist", "file", "-format_whitelist", "wav,mp3,mov,aac,flac,ogg,aiff,asf,matroska,webm"}
}

func ConvertWithLimit(ctx context.Context, executable, input, output string, seconds int) error {
	// 多解码一秒用于拒绝超长输入。
	return convertTrack(ctx, executable, input, output, 0, 1, 24000, 0, seconds+1, false)
}

// ConvertStereo 将第一个音轨转换成双声道 16 位 WAV。
func ConvertStereo(ctx context.Context, executable, input, output string, rate int) error {
	return convertTrack(ctx, executable, input, output, 0, 2, rate, 0, 0, false)
}

// ConvertTrack 按从零开始的音轨序号解码，不把视频和字幕流算进去。seconds 为 0 时不截断。
func ConvertTrack(ctx context.Context, executable, input, output string, track, channels, rate, seconds int) error {
	return convertTrack(ctx, executable, input, output, track, channels, rate, 0, seconds, true)
}

// StereoSegment 从已转换的 WAV 文件中提取固定时长的双声道片段。
func StereoSegment(ctx context.Context, executable, input, output string, rate, start, seconds int) error {
	return convertTrack(ctx, executable, input, output, 0, 2, rate, start, seconds, false)
}

func convertTrack(ctx context.Context, executable, input, output string, track, channels, rate, start, seconds int, keepTimestamps bool) error {
	input, err := filepath.Abs(input)
	if err != nil {
		return err
	}
	args := append([]string{"-nostdin", "-v", "error", "-xerror"}, localInput()...)
	if start > 0 {
		args = append(args, "-ss", strconv.Itoa(start))
	}
	args = append(args, "-i", input, "-map", "0:a:"+strconv.Itoa(track), "-vn")
	if keepTimestamps {
		// 所选音轨比画面晚开始时保留开头空白，使导出的字幕也能对齐原视频。
		args = append(args, "-af", "aresample=async=1:first_pts=0")
	}
	if seconds > 0 {
		args = append(args, "-t", strconv.Itoa(seconds))
	}
	args = append(args, "-ac", strconv.Itoa(channels), "-ar", strconv.Itoa(rate), "-c:a", "pcm_s16le", "-map_metadata", "-1", "-y", output)
	cmd := exec.CommandContext(ctx, executable, args...)
	platform.ConfigureProcess(cmd)
	_, err = cmd.Output()
	return mediaToolError(ctx, err)
}

func mediaToolError(ctx context.Context, err error) error {
	if err == nil {
		return nil
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	detail := err.Error()
	var exit *exec.ExitError
	if errors.As(err, &exit) && len(exit.Stderr) > 0 {
		detail = strings.TrimSpace(string(exit.Stderr))
		if runes := []rune(detail); len(runes) > 500 {
			detail = string(runes[:500])
		}
	}
	return msg.Err(msg.ErrAudioDecode, msg.Params{"detail": detail})
}
