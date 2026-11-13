// Package community 是 yovoice 社区服务的 HTTP 客户端：设备登录、登记分享、直传文件和查看自己的分享。
package community

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
	"yovoice/internal/msg"
)

// DefaultBase 是社区服务地址；环境变量 YOVOICE_COMMUNITY_API 可以改到自建或测试服务。
const DefaultBase = "https://api.leemysw.com/api/v1"

// Base 返回当前使用的社区服务地址。
func Base() string {
	if base := strings.TrimRight(strings.TrimSpace(os.Getenv("YOVOICE_COMMUNITY_API")), "/"); base != "" {
		return base
	}
	return DefaultBase
}

// Client 以某个账号的身份访问社区服务；Token 为空时只能调用登录和公开接口。
type Client struct {
	Base  string
	Token string
	HTTP  *http.Client
}

// Account 是登录后展示的账号信息。
type Account struct {
	Nickname string `json:"nickname"`
	Email    string `json:"email"`
}

// Device 是一次设备登录请求：应用拿 DeviceCode 轮询，用户在 VerificationURL 核对 UserCode。
type Device struct {
	DeviceCode      string `json:"device_code"`
	UserCode        string `json:"user_code"`
	VerificationURL string `json:"verification_url"`
	ExpiresIn       int    `json:"expires_in"`
	Interval        int    `json:"interval"`
}

// Limits 是服务端当前的条款版本和上传大小上限（字节）。
type Limits struct {
	TermsVersion string `json:"terms_version"`
	VoiceMaxSize int64  `json:"voice_max_size"`
	SongMaxSize  int64  `json:"song_max_size"`
	PreviewMax   int64  `json:"preview_max_size"`
}

// CreateInput 登记一个新分享，字段与服务端一致。
type CreateInput struct {
	Kind         string   `json:"kind"`
	Title        string   `json:"title"`
	Description  string   `json:"description"`
	Tags         []string `json:"tags"`
	Language     string   `json:"language"`
	Model        string   `json:"model"`
	License      string   `json:"license"`
	SourceClaim  string   `json:"source_claim"`
	TermsVersion string   `json:"terms_version"`
	AcceptTerms  bool     `json:"accept_terms"`
	PackSize     int64    `json:"pack_size"`
	PreviewSize  int64    `json:"preview_size"`
	Duration     float64  `json:"duration"`
	// Gene 是歌曲的响度起伏（96 个十六进制字符），社区页用它画封面；算不出来时留空。
	Gene string `json:"gene,omitempty"`
}

// Upload 是一个文件的直传地址和必须原样带上的请求头。
type Upload struct {
	URL     string            `json:"url"`
	Headers map[string]string `json:"headers"`
}

// Ticket 是登记分享后拿到的上传凭据。
type Ticket struct {
	ID      string `json:"id"`
	Pack    Upload `json:"pack"`
	Preview Upload `json:"preview"`
}

// Item 是自己的一个分享及其审核状态。
type Item struct {
	ID         string    `json:"id"`
	Kind       string    `json:"kind"`
	Status     string    `json:"status"`
	Title      string    `json:"title"`
	ReviewNote string    `json:"reviewNote,omitempty"`
	LikeCount  int64     `json:"likeCount"`
	UseCount   int64     `json:"useCount"`
	CreatedAt  time.Time `json:"createdAt"`
}

// reasons 把服务端的原因码对应到界面文案；没列出的原因显示服务端给的说明。
var reasons = map[string]msg.Code{
	"email_unverified": msg.ErrCommunityEmail,
	"daily_limit":      msg.ErrCommunityDailyLimit,
	"pending_limit":    msg.ErrCommunityPendingLimit,
	"tags":             msg.ErrCommunityTags,
	"pack_invalid":     msg.ErrCommunityPackInvalid,
	"upload_missing":   msg.ErrCommunityPackInvalid,
	"unavailable":      msg.ErrCommunityUnavailable,
	"not_found":        msg.ErrCommunityNotFound,
}

// call 发送 JSON 请求并解码回复，返回 HTTP 状态码。
// 连不上记为网络错误；401 表示登录已失效；其余失败带上服务端给出的说明。
func (c *Client) call(ctx context.Context, method, path string, in, out any) (int, error) {
	var body io.Reader
	if in != nil {
		b, e := json.Marshal(in)
		if e != nil {
			return 0, e
		}
		body = bytes.NewReader(b)
	}
	req, e := http.NewRequestWithContext(ctx, method, c.Base+path, body)
	if e != nil {
		return 0, e
	}
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}
	resp, e := c.HTTP.Do(req)
	if e != nil {
		if ctx.Err() != nil {
			return 0, ctx.Err()
		}
		return 0, msg.Err(msg.ErrCommunityNetwork, msg.Params{"detail": e.Error()})
	}
	defer resp.Body.Close()
	data, e := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if e != nil {
		return resp.StatusCode, msg.Err(msg.ErrCommunityNetwork, msg.Params{"detail": e.Error()})
	}
	if resp.StatusCode == http.StatusUnauthorized {
		return resp.StatusCode, msg.Err(msg.ErrCommunityLogin, nil)
	}
	if resp.StatusCode >= 300 {
		var failure struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		}
		if json.Unmarshal(data, &failure) != nil || failure.Message == "" {
			failure.Message = resp.Status
		}
		if code, ok := reasons[failure.Code]; ok {
			return resp.StatusCode, msg.Err(code, nil)
		}
		return resp.StatusCode, msg.Err(msg.ErrCommunityRejected, msg.Params{"message": failure.Message})
	}
	if out != nil && resp.StatusCode == http.StatusOK {
		if e = json.Unmarshal(data, out); e != nil {
			return resp.StatusCode, msg.Err(msg.ErrCommunityNetwork, msg.Params{"detail": e.Error()})
		}
	}
	return resp.StatusCode, nil
}

// DeviceStart 发起设备登录。
func (c *Client) DeviceStart(ctx context.Context) (Device, error) {
	var d Device
	_, e := c.call(ctx, http.MethodPost, "/auth/device/start", struct{}{}, &d)
	return d, e
}

// DeviceToken 查询登录结果：用户还没确认时 pending 为 true。
func (c *Client) DeviceToken(ctx context.Context, deviceCode string) (token string, account Account, pending bool, err error) {
	var reply struct {
		Token string  `json:"token"`
		User  Account `json:"user"`
	}
	status, e := c.call(ctx, http.MethodPost, "/auth/device/token", map[string]string{"device_code": deviceCode}, &reply)
	if e != nil {
		return "", Account{}, false, e
	}
	return reply.Token, reply.User, status == http.StatusAccepted, nil
}

// Limits 读取条款版本和大小上限。
func (c *Client) Limits(ctx context.Context) (Limits, error) {
	var l Limits
	_, e := c.call(ctx, http.MethodGet, "/community/config", nil, &l)
	return l, e
}

// Create 登记新分享。
func (c *Client) Create(ctx context.Context, in CreateInput) (Ticket, error) {
	var t Ticket
	_, e := c.call(ctx, http.MethodPost, "/community/items", in, &t)
	return t, e
}

// Submit 在文件传完后提交审核。
func (c *Client) Submit(ctx context.Context, id string) error {
	_, e := c.call(ctx, http.MethodPost, "/community/items/"+id+"/submit", struct{}{}, nil)
	return e
}

// Mine 列出自己的分享。
func (c *Client) Mine(ctx context.Context) ([]Item, error) {
	var reply struct {
		Items []struct {
			ID         string    `json:"id"`
			Kind       string    `json:"kind"`
			Status     string    `json:"status"`
			Title      string    `json:"title"`
			ReviewNote string    `json:"review_note"`
			LikeCount  int64     `json:"like_count"`
			UseCount   int64     `json:"use_count"`
			CreatedAt  time.Time `json:"created_at"`
		} `json:"items"`
	}
	if _, e := c.call(ctx, http.MethodGet, "/community/me/items", nil, &reply); e != nil {
		return nil, e
	}
	items := make([]Item, 0, len(reply.Items))
	for _, i := range reply.Items {
		items = append(items, Item{ID: i.ID, Kind: i.Kind, Status: i.Status, Title: i.Title, ReviewNote: i.ReviewNote, LikeCount: i.LikeCount, UseCount: i.UseCount, CreatedAt: i.CreatedAt})
	}
	return items, nil
}

// Delete 删除自己的一个分享。
func (c *Client) Delete(ctx context.Context, id string) error {
	_, e := c.call(ctx, http.MethodDelete, "/community/items/"+id, nil, nil)
	return e
}

// Put 把本地文件传到直传地址，progress 收到累计已发送的字节数。
func (c *Client) Put(ctx context.Context, u Upload, path string, progress func(int64)) error {
	f, e := os.Open(path)
	if e != nil {
		return e
	}
	defer f.Close()
	info, e := f.Stat()
	if e != nil {
		return e
	}
	req, e := http.NewRequestWithContext(ctx, http.MethodPut, u.URL, &countingReader{r: f, report: progress})
	if e != nil {
		return e
	}
	// 大小参与了地址签名，必须明确给出，不能用分块传输。
	req.ContentLength = info.Size()
	for name, value := range u.Headers {
		req.Header.Set(name, value)
	}
	resp, e := c.HTTP.Do(req)
	if e != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return msg.Err(msg.ErrCommunityNetwork, msg.Params{"detail": e.Error()})
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 300 {
		return msg.Err(msg.ErrCommunityNetwork, msg.Params{"detail": "upload " + resp.Status})
	}
	return nil
}

type countingReader struct {
	r      io.Reader
	sent   int64
	report func(int64)
}

func (c *countingReader) Read(p []byte) (int, error) {
	n, e := c.r.Read(p)
	if n > 0 {
		c.sent += int64(n)
		c.report(c.sent)
	}
	return n, e
}
