package workbench

import (
	"archive/zip"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
	"yovoice/internal/audio"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
)

// fakeCommunity 模拟社区服务：设备登录第二次轮询放行，记录登记、上传和提交。
type fakeCommunity struct {
	mu        sync.Mutex
	polls     int
	created   map[string]any
	uploads   map[string][]byte
	submitted bool
	deleted   bool
	reject    bool
}

func (f *fakeCommunity) serve(t *testing.T) *httptest.Server {
	var server *httptest.Server
	reply := func(w http.ResponseWriter, status int, v any) {
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(v)
	}
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		authorized := r.Header.Get("Authorization") == "Bearer token-1"
		switch {
		case r.URL.Path == "/auth/device/start":
			reply(w, 200, map[string]any{"device_code": "device", "user_code": "ABCD-EFGH", "verification_url": "https://example.test/device?code=ABCD-EFGH", "expires_in": 600, "interval": 1})
		case r.URL.Path == "/auth/device/token":
			if f.polls++; f.polls < 2 {
				reply(w, 202, map[string]string{"status": "pending"})
				return
			}
			reply(w, 200, map[string]any{"token": "token-1", "user": map[string]string{"nickname": "小优", "email": "you@example.test"}})
		case r.URL.Path == "/community/config":
			reply(w, 200, map[string]any{"terms_version": "2026-11", "song_max_size": 1 << 20, "preview_max_size": 1 << 20})
		case !authorized && strings.HasPrefix(r.URL.Path, "/community/"):
			reply(w, 401, map[string]string{"message": "unauthorized"})
		case r.Method == http.MethodPost && r.URL.Path == "/community/items":
			_ = json.NewDecoder(r.Body).Decode(&f.created)
			upload := func(name string) map[string]any {
				return map[string]any{"url": server.URL + "/upload/" + name, "headers": map[string]string{"Content-Type": "application/x-" + name}}
			}
			reply(w, 200, map[string]any{"id": "11111111-2222-3333-4444-555555555555", "pack": upload("pack"), "preview": upload("preview")})
		case r.Method == http.MethodPut && strings.HasPrefix(r.URL.Path, "/upload/"):
			name := strings.TrimPrefix(r.URL.Path, "/upload/")
			body, _ := io.ReadAll(r.Body)
			if r.ContentLength != int64(len(body)) || r.Header.Get("Content-Type") != "application/x-"+name {
				t.Error("上传没有带上签名要求的大小或类型", r.ContentLength, r.Header.Get("Content-Type"))
			}
			f.uploads[name] = body
		case strings.HasSuffix(r.URL.Path, "/submit"):
			if f.reject {
				reply(w, 400, map[string]string{"message": "分享包结构不正确"})
				return
			}
			f.submitted = true
			reply(w, 200, map[string]string{"status": "pending"})
		case r.Method == http.MethodDelete:
			f.deleted = true
			reply(w, 200, map[string]bool{"ok": true})
		default:
			reply(w, 404, map[string]string{"message": "not found"})
		}
	}))
	t.Cleanup(server.Close)
	return server
}

// wantCode 断言调用以指定的消息码失败。
func wantCode(t *testing.T, err error, code msg.Code) {
	t.Helper()
	var ce *msg.CallError
	if !errors.As(err, &ce) || ce.Code != code {
		t.Fatal("期望", code, "得到", err)
	}
}

// waitCommunity 等到社区状态满足条件。
func waitCommunity(t *testing.T, w *Workbench, ready func(schema.CommunityState) bool) schema.CommunityState {
	t.Helper()
	for deadline := time.Now().Add(20 * time.Second); time.Now().Before(deadline); time.Sleep(20 * time.Millisecond) {
		if c := w.Store.Read().Community; c != nil && ready(*c) {
			return *c
		}
	}
	t.Fatal("社区状态没有按时更新")
	return schema.CommunityState{}
}

func TestCommunityLoginAndShare(t *testing.T) {
	if _, e := audio.Converter(); e != nil {
		t.Skip("没有音频转换器")
	}
	fake := &fakeCommunity{uploads: map[string][]byte{}}
	t.Setenv("YOVOICE_COMMUNITY_API", fake.serve(t).URL)
	root := t.TempDir()
	w, err := New(root)
	must(t, err)
	song := schema.DefaultDraft()
	song.Kind, song.Title, song.Lyrics, song.ModelID = "music", "夜航", "[verse]\n风从海上来", "ace-step"
	voice := schema.Voice{ID: schema.NewID(), Name: "参考", FileName: "reference.wav", Duration: 1}
	song.VoiceID = ptr(voice.ID)
	g := schema.Generation{ID: schema.NewID(), Title: "夜航", FileName: "song.wav", Duration: 1, Settings: song}
	stem := schema.Generation{ID: schema.NewID(), FileName: "stem.wav", Duration: 1, Settings: song, StemOf: g.ID, Stem: "vocals"}
	must(t, os.WriteFile(filepath.Join(root, "outputs", g.FileName), wav(), 0600))
	must(t, os.WriteFile(filepath.Join(root, "voices", voice.FileName), wav(), 0600))
	must(t, w.Store.Update(func(s *schema.State) {
		s.Drafts = append(s.Drafts, song)
		s.History = []schema.Generation{g, stem}
		s.Voices = []schema.Voice{voice}
	}, true))
	request := CommunityShareRequest{GenerationID: g.ID, Title: "夜航", Tags: []string{"民谣"}, License: "noncommercial", AcceptTerms: true}

	// 没登录不能分享；分轨不是完整的歌，也不能分享。
	_, err = w.CommunityShare(request)
	wantCode(t, err, msg.ErrCommunityLogin)
	login, err := w.CommunityLogin()
	must(t, err)
	if login.Code != "ABCD-EFGH" || !strings.Contains(login.URL, login.Code) {
		t.Fatal("没有拿到确认码", login)
	}
	if c := waitCommunity(t, w, func(c schema.CommunityState) bool { return c.Account != nil }); c.Login != nil || c.Account.Nickname != "小优" {
		t.Fatal("登录后状态不对", c)
	}
	state, _ := w.Store.ReadJSON()
	if strings.Contains(string(state), "token-1") {
		t.Fatal("登录令牌进入了广播状态")
	}
	_, err = w.CommunityShare(CommunityShareRequest{GenerationID: stem.ID, Title: "分轨", License: "open", AcceptTerms: true})
	wantCode(t, err, msg.ErrCommunitySource)

	_, err = w.CommunityShare(request)
	must(t, err)
	done := waitCommunity(t, w, func(c schema.CommunityState) bool { return c.Share != nil && c.Share.Status != "running" })
	if done.Share.Status != "completed" || done.Share.Received != done.Share.Total || done.Share.Total == 0 {
		t.Fatal("分享没有完成", *done.Share)
	}
	if !fake.submitted || fake.created["kind"] != "song" || fake.created["model"] != "ace-step" || fake.created["terms_version"] != "2026-11" {
		t.Fatal("登记或提交的内容不对", fake.created)
	}
	if string(fake.uploads["preview"][4:8]) != "ftyp" {
		t.Fatal("试听不是 M4A")
	}
	// 分享包能被本机当作作品导入，且不带参考音色。
	archive := filepath.Join(t.TempDir(), "shared.yovoice")
	must(t, os.WriteFile(archive, fake.uploads["pack"], 0600))
	reader, err := zip.OpenReader(archive)
	must(t, err)
	for _, f := range reader.File {
		if strings.HasPrefix(f.Name, "voices/") {
			t.Fatal("分享包带上了参考音色", f.Name)
		}
	}
	must(t, reader.Close())
	copy, err := w.ImportProject(archive)
	must(t, err)
	if copy.Kind != "music" || copy.Lyrics != song.Lyrics || copy.VoiceID != nil {
		t.Fatal("分享包导入后内容不对", copy)
	}
	w.CommunityCloseShare()
	if w.Store.Read().Community.Share != nil {
		t.Fatal("分享结果没有收起")
	}

	// 服务端拒绝时报出它的说明，并清掉没提交成功的草稿。
	fake.mu.Lock()
	fake.reject = true
	fake.mu.Unlock()
	_, err = w.CommunityShare(request)
	must(t, err)
	failed := waitCommunity(t, w, func(c schema.CommunityState) bool { return c.Share != nil && c.Share.Status != "running" })
	if failed.Share.Status != "failed" || failed.Share.ErrorCode != msg.ErrCommunityRejected || failed.Share.ErrorParams["message"] != "分享包结构不正确" || !fake.deleted {
		t.Fatal("被拒绝的分享状态不对", *failed.Share, fake.deleted)
	}

	// 重启后账号仍在；退出登录后令牌被删除。
	w.Close()
	w, err = New(root)
	must(t, err)
	defer w.Close()
	if c := w.Store.Read().Community; c == nil || c.Account == nil || c.Account.Email != "you@example.test" || c.Share != nil {
		t.Fatal("重启后没有恢复账号", c)
	}
	must(t, w.CommunityLogout())
	_, err = w.CommunityShare(request)
	wantCode(t, err, msg.ErrCommunityLogin)
}
