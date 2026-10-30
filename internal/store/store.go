// Package store 持久化应用状态、广播变更，并迁移旧版数据目录。
package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"
	"yovoice/internal/diag"
	"yovoice/internal/msg"
	"yovoice/internal/platform"
	"yovoice/internal/schema"
)

// Store 在内存中保存当前状态供读取，持久化修改以事务写入 SQLite 状态库。
// 数据目录由 service.lock 独占，同一时间只有一个进程打开状态库。
type Store struct {
	Root  string
	mu    sync.Mutex
	state schema.State
	db    *sql.DB
	// saved 是数据库中已提交的内容，用于只写入变化的行。
	saved       snapshot
	backedUp    time.Time
	subscribers map[chan struct{}]bool
	// frozen 在数据目录迁移完成后置位：新目录已是重启后的数据源，旧目录不再接受持久化写入，避免重启前的修改静默丢失。
	frozen bool
	// cloneFailed 记录已经报告过状态无法序列化，避免每次读取都写日志。
	cloneFailed bool
}

// backupInterval 控制运行期间刷新 yovoice.backup.db 的最短间隔；每次打开时也会刷新一次。
const backupInterval = 30 * time.Minute

// hostPreferences 供原生宿主在服务启动前读取界面语言，内容由数据库派生，丢失后下次启动重建。
const hostPreferences = "host-preferences.json"

// clone 经 JSON 往返做深拷贝；状态无法序列化（例如出现 NaN）时返回错误，不能把零值状态当成当前状态。
func clone(s schema.State) (schema.State, error) {
	b, e := json.Marshal(s)
	if e != nil {
		return schema.State{}, e
	}
	var r schema.State
	if e = json.Unmarshal(b, &r); e != nil {
		return schema.State{}, e
	}
	return r, nil
}

// Read 返回当前状态的副本。状态无法序列化时退而返回浅拷贝（切片与内存状态共享，只读使用）：
// 返回零值会让清理逻辑把所有文件当成未引用而删除。
func (s *Store) Read() schema.State {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, e := clone(s.state)
	if e != nil {
		if !s.cloneFailed {
			s.cloneFailed = true
			diag.Log(s.Root, "state.read_failed", "error", diag.Error(e))
		}
		return s.state
	}
	return r
}

// ReadJSON 直接返回当前状态的 JSON，供状态推送使用，省去 Read 复制后再序列化的一轮。
func (s *Store) ReadJSON() ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return json.Marshal(s.state)
}

// Update 应用修改：persist 为真时在内存副本上修改，先把变化的记录在一个事务中写入数据库，提交成功后才替换内存状态；
// 否则只修改内存中的状态。
func (s *Store) Update(change func(*schema.State), persist bool) (err error) {
	defer func() {
		if err != nil {
			diag.Log(s.Root, "state.write_failed", "stage", DatabaseFile, "error", diag.Error(err))
		}
	}()
	s.mu.Lock()
	defer s.mu.Unlock()
	// 只在内存中更新的进度与实时状态每秒会有多次，直接修改当前状态，不再整份复制。
	if !persist {
		change(&s.state)
		s.notify()
		return nil
	}
	if e := s.checkWritable(); e != nil {
		return e
	}
	next, e := clone(s.state)
	if e != nil {
		// 拷贝失败时拒绝提交：在零值状态上修改再写库会清空所有表。
		return e
	}
	change(&next)
	snap, e := encode(&next)
	if e != nil {
		return e
	}
	changed, e := commit(s.db, s.saved, snap)
	if e != nil {
		return s.writeError(e)
	}
	s.saved = snap
	if changed {
		if next.Preferences.UiLocale != s.state.Preferences.UiLocale {
			s.state.Preferences.UiLocale = next.Preferences.UiLocale
			if e = s.writeHostPreferences(); e != nil {
				diag.Log(s.Root, "state.host_preferences_failed", "error", diag.Error(e))
			}
		}
		if time.Since(s.backedUp) >= backupInterval {
			if e = backup(s.db, filepath.Join(s.Root, backupFile)); e != nil {
				diag.Log(s.Root, "state.backup_failed", "error", diag.Error(e))
			}
			s.backedUp = time.Now()
		}
	}
	s.state = next
	s.notify()
	return nil
}

// notify 通知订阅者状态已变化；通道只缓冲一次，来不及处理的多次变化合并为一次推送。
func (s *Store) notify() {
	for ch := range s.subscribers {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}

// writeHostPreferences 写出原生宿主需要的界面语言，结构与旧版 state.json 的 preferences 保持一致。
func (s *Store) writeHostPreferences() error {
	b, e := json.Marshal(map[string]any{"preferences": map[string]any{"uiLocale": s.state.Preferences.UiLocale}})
	if e != nil {
		return e
	}
	return platform.WriteFileAtomic(filepath.Join(s.Root, hostPreferences), b, 0600)
}

// writeError 把“数据目录已不存在”翻译成可读的提示，而不是底层的文件系统错误；
// 运行中删除数据目录或拔出外置盘时，用户需要知道原因和处理方式。
// 这里不重新创建目录：外置盘未挂载时在原路径新建会把数据写到系统盘。
func (s *Store) writeError(e error) error {
	if e == nil {
		return nil
	}
	if _, err := os.Stat(s.Root); os.IsNotExist(err) {
		return msg.Err(msg.ErrDataRootMissing, msg.Params{"path": s.Root})
	}
	if diskFull(e) {
		return msg.Err(msg.ErrDiskFull, nil)
	}
	if unwritable(e) {
		// 文件只读或无法打开（权限被改、文件被占用）：归为状态保存失败，细节留在日志里。
		return msg.Err(msg.ErrStateSaveFailed, msg.Params{"detail": e.Error()})
	}
	return e
}

// Freeze 拒绝之后的所有持久化写入；仅内存中的进度广播仍然可用。
func (s *Store) Freeze() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.frozen = true
}

// Thaw 撤销 Freeze：数据目录迁移在冻结后失败时，旧目录仍是数据源，恢复持久化写入。
func (s *Store) Thaw() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.frozen = false
}

// Close 关闭状态库；之后的持久化写入返回错误，内存读取仍可用。
func (s *Store) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return nil
	}
	e := s.db.Close()
	s.db = nil
	return e
}

// checkWritable 确认可以持久化写入：未冻结、未关闭、数据库仍在原位。调用方需持有 s.mu。
func (s *Store) checkWritable() error {
	if s.frozen {
		return msg.Err(msg.ErrStorageRestart, nil)
	}
	if s.db == nil {
		return errors.New("状态库已关闭")
	}
	// 类 Unix 系统上已删除的文件仍可写入，必须先确认数据库仍在原位，否则修改会静默丢失。
	if _, e := os.Stat(filepath.Join(s.Root, DatabaseFile)); e != nil {
		return s.writeError(e)
	}
	return nil
}

func (s *Store) Subscribe() (chan struct{}, func()) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ch := make(chan struct{}, 1)
	s.subscribers[ch] = true
	ch <- struct{}{}
	return ch, func() { s.mu.Lock(); delete(s.subscribers, ch); s.mu.Unlock() }
}
