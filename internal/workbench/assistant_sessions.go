package workbench

import (
	"os"
	"path/filepath"
	"strings"
	"time"
	"yovoice/internal/diag"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
)

// assistantSessionDir 返回某个会话的助手子进程配置目录。
func assistantSessionDir(root, sessionID string) string {
	return filepath.Join(root, "assistant", "sessions", sessionID)
}

// NewAssistantSession 新建空会话并设为当前；超过上限时删除最旧的会话及其配置目录。
func (w *Workbench) NewAssistantSession() (schema.AssistantSession, error) {
	session := schema.AssistantSession{ID: schema.NewID(), Messages: []schema.AssistantMessage{}, UpdatedAt: time.Now().UTC()}
	var removed []string
	err := w.Store.Update(func(s *schema.State) {
		if s.AssistantSessions == nil {
			s.AssistantSessions = &schema.AssistantSessions{}
		}
		s.AssistantSessions.Sessions = append([]schema.AssistantSession{session}, s.AssistantSessions.Sessions...)
		s.AssistantSessions.CurrentID = session.ID
		if excess := len(s.AssistantSessions.Sessions) - schema.AssistantSessionLimit; excess > 0 {
			for _, old := range s.AssistantSessions.Sessions[len(s.AssistantSessions.Sessions)-excess:] {
				removed = append(removed, old.ID)
			}
			s.AssistantSessions.Sessions = s.AssistantSessions.Sessions[:len(s.AssistantSessions.Sessions)-excess]
		}
	}, true)
	if err != nil {
		return session, err
	}
	// 状态已提交才删目录：状态没删掉而目录没了，会话的助手时间线就找不回来了。
	for _, id := range removed {
		_ = os.RemoveAll(assistantSessionDir(w.Store.Root, id))
	}
	return session, nil
}

// OpenAssistantSession 切换到某个会话；下一轮对话用该会话的助手时间线（子进程按配置目录重启）。
func (w *Workbench) OpenAssistantSession(id string) error {
	if assistantSessionByID(w.Store.Read(), id) == nil {
		return msg.Err(msg.ErrRequestInvalid, nil)
	}
	return w.Store.Update(func(s *schema.State) {
		if s.AssistantSessions != nil {
			s.AssistantSessions.CurrentID = id
		}
	}, true)
}

// DeleteAssistantSession 删除某个会话及其配置目录；删的是当前会话时切到最近更新的其余会话。
func (w *Workbench) DeleteAssistantSession(id string) error {
	found := false
	err := w.Store.Update(func(s *schema.State) {
		if s.AssistantSessions == nil {
			return
		}
		sessions := make([]schema.AssistantSession, 0, len(s.AssistantSessions.Sessions))
		for _, session := range s.AssistantSessions.Sessions {
			if session.ID == id {
				found = true
				continue
			}
			sessions = append(sessions, session)
		}
		s.AssistantSessions.Sessions = sessions
		if s.AssistantSessions.CurrentID == id {
			s.AssistantSessions.CurrentID = ""
			if len(sessions) > 0 {
				current := sessions[0]
				for _, session := range sessions {
					if session.UpdatedAt.After(current.UpdatedAt) {
						current = session
					}
				}
				s.AssistantSessions.CurrentID = current.ID
			}
		}
	}, true)
	if err != nil {
		return err
	}
	if !found {
		return msg.Err(msg.ErrRequestInvalid, nil)
	}
	_ = os.RemoveAll(assistantSessionDir(w.Store.Root, id))
	return nil
}

// ensureAssistantSession 返回当前会话 ID；没有会话时新建一个。
func (w *Workbench) ensureAssistantSession() (string, error) {
	if s := w.Store.Read(); s.AssistantSessions != nil && assistantSessionByID(s, s.AssistantSessions.CurrentID) != nil {
		return s.AssistantSessions.CurrentID, nil
	}
	session, err := w.NewAssistantSession()
	return session.ID, err
}

// assistantSessionByID 在状态里查找会话。
func assistantSessionByID(s schema.State, id string) *schema.AssistantSession {
	if s.AssistantSessions == nil {
		return nil
	}
	for i := range s.AssistantSessions.Sessions {
		if s.AssistantSessions.Sessions[i].ID == id {
			return &s.AssistantSessions.Sessions[i]
		}
	}
	return nil
}

// sessionTitle 由首条用户消息生成会话标题：去掉换行后截取前 24 个字。
func sessionTitle(text string) string {
	first := strings.TrimSpace(strings.SplitN(text, "\n", 2)[0])
	runes := []rune(first)
	if len(runes) > 24 {
		return string(runes[:24]) + "…"
	}
	return first
}

// appendChat 把一条消息追加进某个会话并持久化；会话已被删除时丢弃，超过上限时丢弃最旧的消息。
// 写入失败记入诊断日志：这条消息会从记录里消失，排查时要能看到原因。
func (w *Workbench) appendChat(sessionID string, m schema.AssistantMessage) {
	now := time.Now().UTC()
	if err := w.Store.Update(func(s *schema.State) {
		session := assistantSessionByID(*s, sessionID)
		if session == nil {
			return
		}
		session.Messages = append(session.Messages, m)
		if excess := len(session.Messages) - schema.AssistantChatLimit; excess > 0 {
			session.Messages = session.Messages[excess:]
		}
		session.UpdatedAt = now
	}, true); err != nil {
		diag.Log(w.Store.Root, "assistant.persist_failed", "session_id", sessionID, "role", m.Role, "error", diag.Error(err))
	}
}
