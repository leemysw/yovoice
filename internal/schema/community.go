package schema

import (
	"time"
	"yovoice/internal/msg"
)

// CommunityState 是社区功能的会话状态：当前账号、进行中的登录与分享。
// 只随状态广播，不写入状态库；登录令牌保存在私有设置里，启动时据此恢复账号。
type CommunityState struct {
	Account *CommunityAccount `json:"account,omitempty"`
	Login   *CommunityLogin   `json:"login,omitempty"`
	Share   *CommunityShare   `json:"share,omitempty"`
}

// CommunityAccount 是已登录的社区账号。
type CommunityAccount struct {
	Nickname string `json:"nickname"`
	Email    string `json:"email"`
}

// CommunityLogin 是等待用户在浏览器里确认的登录：Code 是要核对的确认码，URL 是确认页。
// Expired 表示用户没有在有效期内确认，需要重新发起。
type CommunityLogin struct {
	Code      string    `json:"code"`
	URL       string    `json:"url"`
	ExpiresAt time.Time `json:"expiresAt"`
	Expired   bool      `json:"expired,omitempty"`
}

// CommunityShare 是一次分享的进度：Stage 依次为 packing（打包和编码试听）、uploading、submitting。
// Received/Total 是上传阶段已发送与总共的字节数。
type CommunityShare struct {
	ID           string     `json:"id"`
	GenerationID string     `json:"generationId"`
	Status       string     `json:"status"`
	Stage        string     `json:"stage"`
	Received     int64      `json:"received"`
	Total        int64      `json:"total"`
	ErrorCode    msg.Code   `json:"errorCode,omitempty"`
	ErrorParams  msg.Params `json:"errorParams,omitempty"`
}
