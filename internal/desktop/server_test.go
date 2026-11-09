package desktop

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
	"yovoice/internal/workbench"
)

func TestHTTPBoundaryAndEvents(t *testing.T) {
	w, e := workbench.New(t.TempDir())
	must(t, e)
	defer w.Close()
	secret := strings.Repeat("a", 64)
	handler := &Server{Workbench: w, Assets: t.TempDir(), Secret: secret}
	server := httptest.NewServer(handler)
	defer server.Close()
	request := func(path, origin string, auth bool) *http.Request {
		r, e := http.NewRequest("GET", server.URL+path, nil)
		must(t, e)
		if auth {
			r.AddCookie(&http.Cookie{Name: "vw-" + secret[:12], Value: secret})
		}
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		return r
	}
	for _, r := range []*http.Request{request("/", "", false), request("/", "https://untrusted.invalid", true)} {
		res, e := server.Client().Do(r)
		must(t, e)
		res.Body.Close()
		if res.StatusCode != 403 {
			t.Fatal(res.StatusCode)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	r := request("/api/state-events", "", true).WithContext(ctx)
	res, e := server.Client().Do(r)
	must(t, e)
	defer res.Body.Close()
	buffer := make([]byte, 8192)
	n, e := res.Body.Read(buffer)
	must(t, e)
	if !bytes.Contains(buffer[:n], []byte(`"event":"state"`)) {
		t.Fatal(string(buffer[:n]))
	}
	d := schema.DefaultDraft()
	d.Title = "事件更新"
	must(t, w.SaveDraft(d))
	n, e = res.Body.Read(buffer)
	must(t, e)
	if !bytes.Contains(buffer[:n], []byte("事件更新")) {
		t.Fatal(string(buffer[:n]))
	}
	file := filepath.Join(w.Store.Root, "input.wav")
	must(t, os.WriteFile(file, wav(), 0600))
	v, e := w.ImportVoice(context.Background(), file, "")
	must(t, e)
	r = request("/media/voices/"+v.FileName, "", true)
	r.Header.Set("Range", "bytes=0-43")
	audio, e := server.Client().Do(r)
	must(t, e)
	b, e := io.ReadAll(audio.Body)
	audio.Body.Close()
	must(t, e)
	if audio.StatusCode != 206 || len(b) != 44 {
		t.Fatal(audio.StatusCode, len(b))
	}
}

// 时间线导出的长音频经 /api/export-audio 上传，不受 RPC 的 28 MB 上限；宿主再按 ID 取路径。
func TestExportAudioUpload(t *testing.T) {
	w, e := workbench.New(t.TempDir())
	must(t, e)
	defer w.Close()
	secret := strings.Repeat("b", 64)
	server := httptest.NewServer(&Server{Workbench: w, Assets: t.TempDir(), Secret: secret})
	defer server.Close()
	wav := append([]byte("RIFF\x00\x00\x00\x00WAVE"), bytes.Repeat([]byte{1}, 40<<20)...)
	r, e := http.NewRequest("POST", server.URL+"/api/export-audio", bytes.NewReader(wav))
	must(t, e)
	r.AddCookie(&http.Cookie{Name: "vw-" + secret[:12], Value: secret})
	r.Header.Set("Origin", server.URL)
	res, e := server.Client().Do(r)
	must(t, e)
	defer res.Body.Close()
	var reply struct {
		ID string `json:"id"`
	}
	must(t, json.NewDecoder(res.Body).Decode(&reply))
	path, e := Call(context.Background(), w, "export.path", json.RawMessage(`{"id":"`+reply.ID+`"}`))
	must(t, e)
	if info, e := os.Stat(path.(string)); e != nil || info.Size() != int64(len(wav)) {
		t.Fatalf("上传的导出文件不完整：%v %v", info, e)
	}
}

// 转写上传经 /api/transcribe 走原始请求体，视频等超过 RPC 28 MB 上限的文件也能交给转写；
// 这里没有安装识别模型，收到的应是“需要识别模型”而不是文件过大。
func TestTranscribeUpload(t *testing.T) {
	w, e := workbench.New(t.TempDir())
	must(t, e)
	defer w.Close()
	secret := strings.Repeat("c", 64)
	server := httptest.NewServer(&Server{Workbench: w, Assets: t.TempDir(), Secret: secret})
	defer server.Close()
	r, e := http.NewRequest("POST", server.URL+"/api/transcribe?name="+url.QueryEscape("采访.mp4"), bytes.NewReader(bytes.Repeat([]byte{1}, 40<<20)))
	must(t, e)
	r.AddCookie(&http.Cookie{Name: "vw-" + secret[:12], Value: secret})
	res, e := server.Client().Do(r)
	must(t, e)
	defer res.Body.Close()
	var reply struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	must(t, json.NewDecoder(res.Body).Decode(&reply))
	if reply.Error.Code != string(msg.ErrRecognizeModelRequired) {
		t.Fatalf("转写上传应进入转写流程：%+v", reply)
	}
	if left, _ := filepath.Glob(filepath.Join(w.Store.Root, "downloads", "upload-*")); len(left) != 0 {
		t.Fatalf("失败后应删除上传的临时文件：%v", left)
	}
}
