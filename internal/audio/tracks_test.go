package audio

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"yovoice/internal/msg"
)

func TestAudioTrackSelection(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("需要 FFmpeg 创建多音轨样本")
	}
	probe := os.Getenv("YOVOICE_TEST_FFPROBE")
	if probe == "" {
		probe, err = exec.LookPath("ffprobe")
		if err != nil {
			t.Skip("需要 ffprobe 探测音轨")
		}
	}
	decoder := os.Getenv("YOVOICE_TEST_FFMPEG")
	if decoder == "" {
		decoder = ffmpeg
	}
	ctx := context.Background()
	dir := t.TempDir()
	for _, tc := range []struct{ ext, codec string }{{"mkv", "eac3"}, {"mp4", "aac"}} {
		t.Run(tc.ext, func(t *testing.T) {
			path := filepath.Join(dir, "多语言."+tc.ext)
			cmd := exec.Command(ffmpeg, "-v", "error", "-f", "lavfi", "-i", "color=size=64x64:rate=10",
				"-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
				"-itsoffset", "0.25", "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000",
				"-t", "2", "-map", "0:v", "-map", "1:a", "-map", "2:a", "-c:v", "mpeg4", "-c:a", tc.codec,
				"-metadata:s:a:0", "language=eng", "-metadata:s:a:1", "language=jpn", "-metadata:s:a:1", "title=日本語",
				"-disposition:a:0", "0", "-disposition:a:1", "default", path)
			if output, err := cmd.CombinedOutput(); err != nil {
				t.Fatalf("%s: %v", output, err)
			}
			tracks, err := AudioTracks(ctx, probe, path)
			must(t, err)
			if len(tracks) != 2 || tracks[0].Number != 1 || tracks[0].Language != "eng" || tracks[0].Default ||
				tracks[1].Number != 2 || tracks[1].Language != "jpn" || !tracks[1].Default || tracks[1].Codec != tc.codec {
				t.Fatalf("音轨元数据或序号不正确：%+v", tracks)
			}
			if tc.ext == "mkv" && tracks[1].Title != "日本語" {
				t.Fatal(tracks)
			}
			wav := filepath.Join(dir, tc.ext+".wav")
			must(t, ConvertTrack(ctx, decoder, path, wav, 1, 1, 24000, 1))
			samples, rate, err := ReadMono(wav)
			must(t, err)
			if rate != 24000 || len(samples) != rate {
				t.Fatalf("所选音轨未按时长解码：%d Hz，%d 样本", rate, len(samples))
			}
			for _, sample := range samples[:rate/5] {
				if sample != 0 {
					t.Fatal("所选音轨晚开始时应保留开头静音")
				}
			}
			crossings := 0
			for i := rate/2 + 1; i < len(samples); i++ {
				if samples[i-1] < 0 && samples[i] >= 0 {
					crossings++
				}
			}
			if crossings < 425 || crossings > 455 {
				t.Fatalf("实际提取的音轨为 %d Hz，应为第二轨的 880 Hz", 2*crossings)
			}
			if ConvertTrack(ctx, decoder, path, wav, 2, 1, 24000, 1) == nil {
				t.Fatal("不存在的音轨不能回退到第一轨")
			}
		})
	}

	silent := filepath.Join(dir, "无音轨.mp4")
	if output, err := exec.Command(ffmpeg, "-v", "error", "-f", "lavfi", "-i", "color=size=64x64", "-t", "1", "-c:v", "mpeg4", silent).CombinedOutput(); err != nil {
		t.Fatalf("%s: %v", output, err)
	}
	var failure *msg.CallError
	if _, err := AudioTracks(ctx, probe, silent); !errors.As(err, &failure) || failure.Code != msg.ErrTranscribeNoTrack {
		t.Fatalf("无音轨：%v", err)
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := AudioTracks(cancelled, probe, silent); !errors.Is(err, context.Canceled) {
		t.Fatalf("探测未响应取消：%v", err)
	}
}

// 带画面的视频算视频；m4a、flac 的封面图和纯音频都不算。
func TestHasVideo(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("需要 FFmpeg 创建样本")
	}
	probe := os.Getenv("YOVOICE_TEST_FFPROBE")
	if probe == "" {
		probe, err = exec.LookPath("ffprobe")
		if err != nil {
			t.Skip("需要 ffprobe 探测视频流")
		}
	}
	ctx := context.Background()
	dir := t.TempDir()
	audioOnly := []string{"-map", "0:a"}
	cover := []string{"-map", "0:a", "-map", "1:v", "-frames:v", "1", "-c:v", "png", "-disposition:v:0", "attached_pic"}
	for _, tc := range []struct {
		name  string
		args  []string
		video bool
	}{
		{"视频.mp4", []string{"-map", "0:a", "-map", "1:v", "-c:v", "mpeg4", "-c:a", "aac"}, true},
		{"封面.m4a", append(cover, "-c:a", "aac"), false},
		{"封面.flac", append(cover, "-c:a", "flac"), false},
		{"音频.m4a", append(audioOnly, "-c:a", "aac"), false},
	} {
		path := filepath.Join(dir, tc.name)
		args := append([]string{"-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
			"-f", "lavfi", "-i", "color=size=64x64:rate=10", "-t", "1"}, tc.args...)
		if output, err := exec.Command(ffmpeg, append(args, path)...).CombinedOutput(); err != nil {
			t.Fatalf("%s: %s: %v", tc.name, output, err)
		}
		got, err := HasVideo(ctx, probe, path)
		must(t, err)
		if got != tc.video {
			t.Errorf("%s：HasVideo = %v，应为 %v", tc.name, got, tc.video)
		}
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := HasVideo(cancelled, probe, filepath.Join(dir, "视频.mp4")); !errors.Is(err, context.Canceled) {
		t.Fatalf("探测未响应取消：%v", err)
	}
}
