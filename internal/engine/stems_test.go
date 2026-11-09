package engine

import (
	"context"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// 分离结果逐轨写盘（id 在 audio 前后都能识别）：不需要的轨和其他字段跳过；回包中途断开时报错，而不是把半截音频当成结果。
func TestRunStemsWritesEachStem(t *testing.T) {
	wav := func(n int) string { return base64.StdEncoding.EncodeToString(append([]byte("RIFF"), make([]byte, n)...)) }
	big := wav(4 << 20)
	truncate := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body := fmt.Sprintf(`{"text":"","named_audio_outputs":[{"id":"vocals","audio":%q,"sample_rate":44100,"channels":2},{"id":"skip","audio":%q},{"audio":%q,"channels":2,"id":"drums"}],"artifacts":[]}`, big, wav(64), big)
		if truncate {
			body = body[:len(body)/2]
		}
		_, _ = w.Write([]byte(body))
	}))
	defer server.Close()
	dir := t.TempDir()
	e := &Engine{endpoint: server.URL + "/", client: server.Client(), root: dir}
	asked := map[string]int{}
	target := func(id string) string {
		asked[id]++
		if id == "skip" {
			return ""
		}
		return filepath.Join(dir, id+".wav")
	}
	written, err := e.runStems(context.Background(), map[string]any{}, target)
	if err != nil {
		t.Fatal(err)
	}
	if len(written) != 2 || asked["vocals"] != 1 || asked["drums"] != 1 {
		t.Fatalf("应写出两轨、每轨只问一次路径：%v %v", written, asked)
	}
	for _, id := range []string{"vocals", "drums"} {
		info, err := os.Stat(written[id])
		if err != nil || info.Size() != 4+4<<20 {
			t.Fatalf("%s 没有完整写出：%v %v", id, info, err)
		}
	}
	truncate = true
	if _, err = e.runStems(context.Background(), map[string]any{}, target); err == nil || !strings.Contains(err.Error(), "EOF") {
		t.Fatalf("回包截断应报错：%v", err)
	}
}
