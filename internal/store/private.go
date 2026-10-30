package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"yovoice/internal/diag"
	"yovoice/internal/msg"
)

// Private 读取不属于 State 的私有设置（如本机接口令牌、AI 服务密钥），它们不随状态广播给界面。
// 不存在时返回 false。
func (s *Store) Private(key string, v any) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return false, errors.New("状态库已关闭")
	}
	var data string
	e := s.db.QueryRow("SELECT data FROM private WHERE key = ?", key).Scan(&data)
	if errors.Is(e, sql.ErrNoRows) {
		return false, nil
	}
	if e != nil {
		return false, e
	}
	if e = json.Unmarshal([]byte(data), v); e != nil {
		return false, msg.Err(msg.ErrStateCorrupt, nil)
	}
	return true, nil
}

// SetPrivate 保存私有设置，v 为 nil 时删除；与状态写入一样受冻结和数据目录检查约束。
func (s *Store) SetPrivate(key string, v any) (err error) {
	defer func() {
		if err != nil {
			diag.Log(s.Root, "state.write_failed", "stage", "private", "key", key, "error", diag.Error(err))
		}
	}()
	s.mu.Lock()
	defer s.mu.Unlock()
	if e := s.checkWritable(); e != nil {
		return e
	}
	if v == nil {
		_, e := s.db.Exec("DELETE FROM private WHERE key = ?", key)
		return s.writeError(e)
	}
	b, e := json.Marshal(v)
	if e != nil {
		return e
	}
	_, e = s.db.Exec("INSERT INTO private (key, data) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data", key, string(b))
	if e != nil {
		return s.writeError(e)
	}
	return nil
}
