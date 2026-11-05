package workbench

import (
	"context"
	"slices"
	"strings"
	"testing"
	"yovoice/internal/msg"
)

// 看图取风格：图片按多段内容发给服务，回复里的标签去掉空项后返回；不是图片的内容不发出去。
func TestStyleFromImage(t *testing.T) {
	server, requests := fakeLLM(t, "```json\n{\"tags\": [\"city pop\", \" 80s \", \"\", \"synth bass\", \"female\"], \"theme\": \"夜里的海边公路\"}\n```")
	w := aiWorkbench(t, server)
	_, err := w.AIModels(context.Background(), "")
	must(t, err)
	png := []byte("\x89PNG\r\n\x1a\nrest")
	got, err2 := w.StyleFromImage(context.Background(), "image/png", png, "简体中文")
	must(t, err2)
	if !slices.Equal(got.Tags, []string{"city pop", "80s", "synth bass", "female"}) || got.Theme != "夜里的海边公路" {
		t.Fatalf("%+v", got)
	}
	messages := (*requests)[0]["messages"].([]any)
	content := messages[len(messages)-1].(map[string]any)["content"].([]any)
	image := content[1].(map[string]any)["image_url"].(map[string]any)["url"].(string)
	if !strings.HasPrefix(image, "data:image/png;base64,") {
		t.Fatalf("图片没有发出去：%v", content)
	}
	if _, err = w.StyleFromImage(context.Background(), "image/jpeg", png, ""); !isCode(err, msg.ErrImageInvalid) {
		t.Fatalf("类型与文件头不符应被拒绝：%v", err)
	}
	if len(*requests) != 1 {
		t.Fatal("无效图片不应发给服务")
	}
}
