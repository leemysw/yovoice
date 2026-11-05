package audio

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// 导出转码：FLAC 与 M4A 带上标题、专辑、歌词（含换行和需要转义的字符）与 JPEG 封面；
// 16 位来源保持 16 位，浮点来源写成 24 位 FLAC；临时文件用完即删。
func TestEncode(t *testing.T) {
	system, _ := exec.LookPath("ffmpeg")
	probe, _ := exec.LookPath("ffprobe")
	if system == "" || probe == "" {
		t.Skip("需要 FFmpeg 与 ffprobe 执行真实编码测试")
	}
	// YOVOICE_TEST_FFMPEG 指向随包的精简构建，确认它开了需要的编码器与封面读取。
	executable := os.Getenv("YOVOICE_TEST_FFMPEG")
	if executable == "" {
		executable = system
	}
	root := t.TempDir()
	run := func(args ...string) {
		if out, e := exec.Command(system, append([]string{"-v", "error", "-y"}, args...)...).CombinedOutput(); e != nil {
			t.Fatalf("%s: %v", out, e)
		}
	}
	wav16, wavFloat, cover := filepath.Join(root, "s16.wav"), filepath.Join(root, "f32.wav"), filepath.Join(root, "cover.jpg")
	run("-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "pcm_s16le", wav16)
	run("-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-ac", "2", "-c:a", "pcm_f32le", wavFloat)
	run("-f", "lavfi", "-i", "color=red:s=64x64", "-frames:v", "1", cover)
	image, err := os.ReadFile(cover)
	must(t, err)
	out := t.TempDir()
	tags := Tags{Title: "夜航 = 第一版", Album: "专辑#1", Lyrics: "[Verse]\n第一行; 有分号\n第二行 \\ 反斜杠"}
	for _, c := range []struct{ input, format, bits string }{{wav16, "flac", "16"}, {wavFloat, "flac", "24"}, {wavFloat, "m4a", ""}} {
		t.Run(filepath.Base(c.input)+"."+c.format, func(t *testing.T) {
			output := filepath.Join(out, "out."+c.format)
			must(t, Encode(context.Background(), executable, c.input, output, c.format, tags, image))
			probed, e := exec.Command(probe, "-v", "error", "-show_streams", "-show_format", output).CombinedOutput()
			if e != nil {
				t.Fatalf("%s: %v", probed, e)
			}
			text := string(probed)
			wants := []string{"TAG:title=夜航 = 第一版", "TAG:album=专辑#1", "第一行; 有分号", "attached_pic=1"}
			if c.bits != "" {
				wants = append(wants, "bits_per_raw_sample="+c.bits)
			}
			for _, want := range wants {
				if !strings.Contains(text, want) {
					t.Fatalf("缺少 %q：\n%s", want, text)
				}
			}
			if leftovers, _ := filepath.Glob(filepath.Join(out, "encode-*")); len(leftovers) > 0 {
				t.Fatalf("临时目录未清理：%v", leftovers)
			}
		})
	}
	if err = Encode(context.Background(), executable, wav16, filepath.Join(out, "bad.flac"), "flac", tags, []byte("not a jpeg")); err == nil {
		t.Fatal("非 JPEG 封面应被拒绝")
	}
	if err = Encode(context.Background(), executable, wav16, filepath.Join(out, "bad.ogg"), "ogg", tags, nil); err == nil {
		t.Fatal("不支持的格式应被拒绝")
	}
}

func TestFFMetadataEscapes(t *testing.T) {
	got := ffmetadata(Tags{Title: " a=b ", Lyrics: "x;y\r\nz#\\", Comment: "AI"})
	want := ";FFMETADATA1\n" + `title=a\=b` + "\n" + `lyrics=x\;y\` + "\n" + `z\#\\` + "\n" + "comment=AI\n"
	if got != want {
		t.Fatalf("%q", got)
	}
}
