package audio

import (
	"context"
	"encoding/json"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
	"yovoice/internal/msg"
	"yovoice/internal/platform"
)

// Track 描述一个音频流，Number 从 1 开始，只对音频流编号。
type Track struct {
	Number   int    `json:"number"`
	Language string `json:"language,omitempty"`
	Title    string `json:"title,omitempty"`
	Codec    string `json:"codec,omitempty"`
	Channels int    `json:"channels,omitempty"`
	Default  bool   `json:"default,omitempty"`
}

// AudioTracks 只读取音轨元数据，不解码视频或上传文件。
func AudioTracks(ctx context.Context, probe, path string) ([]Track, error) {
	path, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	args := append([]string{"-v", "error"}, localInput()...)
	args = append(args, "-select_streams", "a", "-show_entries",
		"stream=codec_name,channels:stream_tags=language,title,handler_name:stream_disposition=default", "-of", "json", path)
	cmd := exec.CommandContext(ctx, probe, args...)
	platform.ConfigureProcess(cmd)
	data, err := cmd.Output()
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return nil, msg.Err(msg.ErrAudioDecode, nil)
		}
		return nil, mediaToolError(ctx, err)
	}
	var result struct {
		Streams []struct {
			Codec       string `json:"codec_name"`
			Channels    int
			Tags        map[string]string
			Disposition struct{ Default int }
		}
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, msg.Err(msg.ErrAudioDecode, nil)
	}
	if len(result.Streams) == 0 {
		return nil, msg.Err(msg.ErrTranscribeNoTrack, nil)
	}
	tracks := make([]Track, 0, len(result.Streams))
	for i, stream := range result.Streams {
		tags := make(map[string]string, len(stream.Tags))
		for k, v := range stream.Tags {
			tags[strings.ToLower(k)] = strings.TrimSpace(v)
		}
		title := tags["title"]
		if title == "" && tags["handler_name"] != "SoundHandler" {
			title = tags["handler_name"]
		}
		tracks = append(tracks, Track{
			Number: i + 1, Language: tags["language"], Title: title, Codec: stream.Codec,
			Channels: stream.Channels, Default: stream.Disposition.Default == 1,
		})
	}
	return tracks, nil
}

// HasVideo 判断文件是否带视频画面；mp3、m4a、flac 等常带的封面图（attached_pic）不算视频。
func HasVideo(ctx context.Context, probe, path string) (bool, error) {
	path, err := filepath.Abs(path)
	if err != nil {
		return false, err
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	args := append([]string{"-v", "error"}, localInput()...)
	args = append(args, "-select_streams", "v", "-show_entries", "stream=codec_type:stream_disposition=attached_pic", "-of", "json", path)
	cmd := exec.CommandContext(ctx, probe, args...)
	platform.ConfigureProcess(cmd)
	data, err := cmd.Output()
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return false, msg.Err(msg.ErrAudioDecode, nil)
		}
		return false, mediaToolError(ctx, err)
	}
	var result struct {
		Streams []struct {
			Disposition struct {
				AttachedPic int `json:"attached_pic"`
			}
		}
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return false, msg.Err(msg.ErrAudioDecode, nil)
	}
	for _, stream := range result.Streams {
		if stream.Disposition.AttachedPic != 1 {
			return true, nil
		}
	}
	return false, nil
}
