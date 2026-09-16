package workbench

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestAudioConversion(t *testing.T) {
	executable, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("需要 FFmpeg 执行真实格式转换测试")
	}
	decoder := os.Getenv("YOVOICE_TEST_FFMPEG")
	if decoder == "" {
		decoder = executable
	}
	root := t.TempDir()
	for _, format := range []string{"mp3", "m4a", "aac", "flac", "ogg", "opus", "aiff", "wma", "webm"} {
		t.Run(format, func(t *testing.T) {
			input := filepath.Join(root, "声音."+format)
			cmd := exec.Command(executable, "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", input)
			if output, err := cmd.CombinedOutput(); err != nil {
				t.Fatalf("%s: %v", output, err)
			}
			output := filepath.Join(root, format+".wav")
			must(t, convertAudio(context.Background(), decoder, input, output))
			duration, err := Duration(output)
			must(t, err)
			if duration < 1.9 || duration > 2.2 {
				t.Fatal(duration)
			}
		})
	}
	invalid := filepath.Join(root, "invalid.mp3")
	must(t, os.WriteFile(invalid, []byte("not audio"), 0600))
	if convertAudio(context.Background(), decoder, invalid, filepath.Join(root, "invalid.wav")) == nil {
		t.Fatal("损坏文件不应导入成功")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if convertAudio(ctx, decoder, invalid, filepath.Join(root, "cancelled.wav")) != context.Canceled {
		t.Fatal("转换应响应取消")
	}
}
