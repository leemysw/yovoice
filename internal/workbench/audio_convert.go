package workbench

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

// audioConverter 只使用安装包中的转换器，不在运行时下载或依赖系统 PATH。
func (w *Workbench) audioConverter() (string, error) {
	name := "ffmpeg"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	return packagedTool(name)
}

func packagedTool(name string) (string, error) {
	executable, err := os.Executable()
	if err != nil {
		return "", err
	}
	executable, err = filepath.EvalSymlinks(executable)
	if err != nil {
		return "", err
	}
	directory := filepath.Dir(executable)
	// CLI 的 tools 与可执行文件同级；桌面服务位于 service 子目录。
	bases := []string{directory}
	if filepath.Base(directory) == "service" {
		bases = append(bases, filepath.Dir(directory))
	}
	for _, base := range bases {
		path := filepath.Join(base, "tools", name)
		if info, err := os.Stat(path); err == nil && info.Mode().IsRegular() {
			return path, nil
		}
	}
	return "", Err(MsgErrAudioConverterMissing, nil)
}

func convertAudio(ctx context.Context, executable, input, output string) error {
	input, err := filepath.Abs(input)
	if err != nil {
		return err
	}
	// 禁用网络和播放列表，只读取本地常见音频容器；多解码一秒用于拒绝超长输入。
	cmd := exec.CommandContext(ctx, executable, "-nostdin", "-v", "error", "-xerror",
		"-protocol_whitelist", "file", "-format_whitelist", "wav,mp3,mov,aac,flac,ogg,aiff,asf,matroska,webm",
		"-i", input, "-map", "0:a:0", "-vn", "-t", "61", "-ac", "1", "-ar", "24000",
		"-c:a", "pcm_s16le", "-map_metadata", "-1", "-y", output)
	configureProcess(cmd)
	if err = cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return Err(MsgErrAudioDecode, MessageParams{"detail": err.Error()})
	}
	return nil
}
