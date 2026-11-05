package workbench

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"yovoice/internal/diag"
	"yovoice/internal/llm"
	"yovoice/internal/msg"
)

// imageStyleLimit 是看图取风格接受的图片大小；界面先缩小再上传，这里只防止误传大文件。
const imageStyleLimit = 8 << 20

// ImageStyle 是从一张图片读出的音乐风格：Tags 是 YuE2 风格栏用的英文标签，Theme 是写词可用的一句主题。
type ImageStyle struct {
	Tags  []string `json:"tags"`
	Theme string   `json:"theme"`
}

const imageStyleSystem = `You turn a picture into a music brief for the YuE2 song model.
Look at the mood, colours, place, era and any people in the image, then reply with JSON only:
{"tags": ["...", ...], "theme": "..."}
- tags: 5 to 8 short English style tags, in this order: genre, sub-genre or era, 2-3 instruments, mood, vocal gender and timbre (e.g. "female", "airy vocal"), tempo feel. No sentences, no artist names.
- theme: one sentence describing what a song about this image would be about, written in the language named by the user.`

// StyleFromImage 请接入的 AI 服务看一张图片，给出音乐风格标签和一句主题。服务需要支持看图。
func (w *Workbench) StyleFromImage(ctx context.Context, mediaType string, data []byte, language string) (ImageStyle, error) {
	if len(data) == 0 || len(data) > imageStyleLimit || !imageMatches(mediaType, data) {
		return ImageStyle{}, msg.Err(msg.ErrImageInvalid, nil)
	}
	if strings.TrimSpace(language) == "" {
		language = "English"
	}
	result, e := w.complete(ctx, llm.Request{System: imageStyleSystem, MaxTokens: 600, Temperature: 0.7,
		Messages: []llm.Message{{Role: "user", Content: "Language for theme: " + language, Image: &llm.Image{MediaType: mediaType, Data: data}}}})
	if e != nil {
		return ImageStyle{}, e
	}
	text := strings.TrimSpace(result.Text)
	text = strings.TrimSuffix(strings.TrimPrefix(strings.TrimPrefix(text, "```json"), "```"), "```")
	if a, b := strings.Index(text, "{"), strings.LastIndex(text, "}"); a >= 0 && b > a {
		text = text[a : b+1]
	}
	var out ImageStyle
	if e = json.Unmarshal([]byte(text), &out); e != nil {
		w.logAIOutput("image_style", "json", result.Text)
		return ImageStyle{}, msg.Err(msg.ErrAIResultInvalid, nil)
	}
	tags := make([]string, 0, len(out.Tags))
	for _, tag := range out.Tags {
		if tag = strings.TrimSpace(strings.Trim(tag, ",.")); tag != "" && len([]rune(tag)) <= 40 && len(tags) < 10 {
			tags = append(tags, tag)
		}
	}
	if len(tags) == 0 {
		w.logAIOutput("image_style", "empty", result.Text)
		return ImageStyle{}, msg.Err(msg.ErrAIResultInvalid, nil)
	}
	out.Tags, out.Theme = tags, strings.TrimSpace(out.Theme)
	if len([]rune(out.Theme)) > 300 {
		out.Theme = string([]rune(out.Theme)[:300])
	}
	diag.Log(w.Store.Root, "ai.image_style", "tags", len(tags), "bytes", len(data))
	return out, nil
}

// imageMatches 按文件头确认图片格式与声明的类型一致。
func imageMatches(mediaType string, data []byte) bool {
	switch mediaType {
	case "image/jpeg":
		return bytes.HasPrefix(data, []byte{0xFF, 0xD8, 0xFF})
	case "image/png":
		return bytes.HasPrefix(data, []byte("\x89PNG\r\n\x1a\n"))
	}
	return false
}
