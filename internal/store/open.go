package store

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
	"yovoice/internal/diag"
	"yovoice/internal/msg"
	"yovoice/internal/platform"
	"yovoice/internal/schema"
)

func New(root string) (store *Store, err error) {
	defer func() { diag.Log(root, "state.open", "platform", runtime.GOOS, "error", diag.Error(err)) }()
	for _, d := range []string{"", "voices", "outputs", "downloads", "runtime", "models", "logs"} {
		if e := os.MkdirAll(filepath.Join(root, d), 0700); e != nil {
			return nil, e
		}
	}
	s := &Store{Root: root, subscribers: map[chan struct{}]bool{}}
	if err = s.open(); err != nil {
		return nil, err
	}
	s.settleDeleted()
	s.state.Activity = settleActivity(s.state.Activity)
	s.state.ModelActivity = settleActivity(s.state.ModelActivity)
	// AI 任务、旋律谱结果与助手对话的实时状态只属于本次会话，助手消息记录保留。
	s.state.AITask = nil
	s.state.Melody = nil
	s.state.AssistantLive = nil
	// 未保存的试听不跨会话保留，角色已保存的试听使用独立文件。
	s.state.Previews = []schema.CharacterPreview{}
	files, _ := filepath.Glob(filepath.Join(root, "outputs", "audition-*.wav"))
	for _, file := range files {
		_ = os.Remove(file)
	}
	if e := s.writeHostPreferences(); e != nil {
		diag.Log(root, "state.host_preferences_failed", "error", diag.Error(e))
	}
	// 每次成功打开后刷新备份，数据库损坏时可回到最近一次启动的状态。
	if e := backup(s.db, filepath.Join(root, backupFile)); e != nil {
		diag.Log(root, "state.backup_failed", "error", diag.Error(e))
	} else {
		s.backedUp = time.Now()
	}
	return s, nil
}

// open 打开状态库；首次运行新版本时从旧版 state.json 导入，数据库损坏或丢失时从备份恢复。
func (s *Store) open() error {
	path := filepath.Join(s.Root, DatabaseFile)
	info, e := os.Stat(path)
	_, backupErr := os.Stat(filepath.Join(s.Root, backupFile))
	hasBackup := backupErr == nil
	// 0 字节的库文件是复制或恢复中途被打断留下的：SQLite 会在空文件上建表并通过检查，启动后再用这份空库刷新备份，
	// 数据就全丢了。有备份时与丢失同样处理，空文件移走留存。
	empty := e == nil && info.Size() == 0
	switch {
	case (os.IsNotExist(e) || empty) && hasBackup:
		// 状态库不在而备份还在（恢复中途失败、同步盘或杀毒软件临时移走文件）：先从备份恢复。
		// 此时绝不能新建空库，否则启动后的备份刷新会用空库覆盖唯一的副本。
		reason := "database missing"
		if empty {
			reason = "database empty"
			if e = os.Rename(path, filepath.Join(s.Root, "yovoice.corrupt-"+timestamp()+".db")); e != nil {
				return e
			}
		}
		if e = s.restoreMissing(path, reason); e != nil {
			return e
		}
	case os.IsNotExist(e):
		state, found, le := readLegacy(s.Root)
		if le != nil {
			return le
		}
		if le = createDB(path, state, nil); le != nil {
			return le
		}
		if found {
			diag.Log(s.Root, "state.imported", "source", legacyState)
		}
	case e != nil:
		return e
	}
	e = s.load(path)
	if corrupt(e) {
		if e = s.restore(path, e); e == nil {
			if e = s.load(path); corrupt(e) {
				// 备份同样不可用：不再尝试，交由用户处理。
				return msg.Err(msg.ErrStateCorrupt, nil)
			}
		}
	}
	if e != nil {
		return e
	}
	// 导入后中途退出时旧文件可能仍在，数据库已是数据源，旧文件只需移走。
	return retireLegacy(s.Root)
}

func (s *Store) load(path string) error {
	db, e := openDB(path)
	if e != nil {
		return e
	}
	if e = checkDB(db); e == nil {
		s.state, s.saved, e = load(db)
	}
	if e != nil {
		db.Close()
		return e
	}
	s.db = db
	return nil
}

// settleDeleted 处理删除中途退出留下的 .deleted 文件：记录仍引用它且原文件不在时改回原名，否则才删除。
// 一律删除会丢掉状态库里还在使用的音频。
func (s *Store) settleDeleted() {
	refs := s.state.MediaRefs()
	for _, kind := range []string{"voices", "outputs"} {
		files, _ := filepath.Glob(filepath.Join(s.Root, kind, "*.deleted"))
		for _, file := range files {
			original := strings.TrimSuffix(file, ".deleted")
			if refs[kind][filepath.Base(original)] {
				if _, e := os.Stat(original); e == nil {
					// 原文件还在，这份是过期的删除标记。
					_ = os.Remove(file)
					continue
				}
				if e := os.Rename(file, original); e != nil {
					diag.Log(s.Root, "media.restore_failed", "path", file, "error", diag.Error(e))
				} else {
					diag.Log(s.Root, "media.restored", "kind", kind, "name", filepath.Base(original))
				}
				continue
			}
			_ = os.Remove(file)
		}
	}
}

// timestamp 给损坏快照等留存文件命名。
func timestamp() string { return time.Now().Format("20060102-150405.000000000") }

// restoreMissing 在状态库文件丢失（或已移走）时用备份补回；遗留的回滚日志属于丢失的那份库，移走以免被应用到备份上。
func (s *Store) restoreMissing(path, reason string) error {
	if e := os.Rename(path+"-journal", filepath.Join(s.Root, "yovoice.corrupt-"+timestamp()+".db-journal")); e != nil && !os.IsNotExist(e) {
		return e
	}
	if e := copyFile(filepath.Join(s.Root, backupFile), path); e != nil {
		return e
	}
	diag.Log(s.Root, "state.recovered", "source", backupFile, "reason", reason)
	pruneCorrupt(s.Root, keepCorrupt)
	return nil
}

// restore 保留损坏的数据库供排查，并用最近的备份替换；没有可用备份时报错且不改动原文件。
func (s *Store) restore(path string, cause error) error {
	source := filepath.Join(s.Root, backupFile)
	if _, e := os.Stat(source); e != nil {
		diag.Log(s.Root, "state.corrupt", "error", diag.Error(cause))
		return msg.Err(msg.ErrStateCorrupt, nil)
	}
	corruptPath := filepath.Join(s.Root, "yovoice.corrupt-"+timestamp()+".db")
	if e := os.Rename(path, corruptPath); e != nil {
		return e
	}
	// 回滚日志属于损坏的数据库，一并移走，避免被应用到备份上。
	if e := os.Rename(path+"-journal", corruptPath+"-journal"); e != nil && !os.IsNotExist(e) {
		return e
	}
	if e := copyFile(source, path); e != nil {
		return e
	}
	diag.Log(s.Root, "state.recovered", "source", backupFile, "error", diag.Error(cause))
	pruneCorrupt(s.Root, keepCorrupt)
	return nil
}

// copyFile 把 src 复制为 dst：先写同目录的临时文件再改名，中途被打断不会在 dst 留下半个（或 0 字节的）库文件；
// dst 已存在时不覆盖。
func copyFile(src, dst string) error {
	if _, e := os.Lstat(dst); e == nil {
		return fmt.Errorf("%s 已存在", dst)
	}
	in, e := os.Open(src)
	if e != nil {
		return e
	}
	defer in.Close()
	tmp := filepath.Join(filepath.Dir(dst), fmt.Sprintf(".yovoice-restore-%d.db", os.Getpid()))
	_ = os.Remove(tmp)
	defer os.Remove(tmp)
	out, e := os.OpenFile(tmp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if e != nil {
		return e
	}
	if _, e = io.Copy(out, in); e == nil {
		e = out.Sync()
	}
	if ce := out.Close(); e == nil {
		e = ce
	}
	if e != nil {
		return e
	}
	if e = os.Rename(tmp, dst); e != nil {
		return e
	}
	platform.SyncDir(filepath.Dir(dst))
	return nil
}

// settleActivity 整理上次会话遗留的操作：运行中的标记为中断，失败提示属于上次会话，重启后不再冒充本次操作的错误。
func settleActivity(a *schema.Activity) *schema.Activity {
	if a == nil {
		return nil
	}
	if a.Status == "running" {
		a.Status = "interrupted"
		a.Code = msg.ActivityInterrupted
		a.Params = nil
		a.ErrorCode = nil
		a.ErrorParams = nil
		return a
	}
	if a.Code == "" || a.Status == "failed" {
		return nil
	}
	return a
}

// WriteSnapshot 在 dir 中新建状态库，写入 state 与当前的全部私有设置，供数据目录迁移生成新目录的数据。
func (s *Store) WriteSnapshot(dir string, state schema.State) error {
	path := filepath.Join(dir, DatabaseFile)
	if _, e := os.Stat(path); e == nil {
		return fmt.Errorf("%s 已存在", path)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return errors.New("状态库已关闭")
	}
	private, e := loadPrivate(s.db)
	if e != nil {
		return e
	}
	return createDB(path, state, private)
}

// Snapshot 把当前数据库完整复制为 yovoice.<label>-<时间>.db，在批量修复等不可撤销的修改前留存；同类快照最多保留 keepCorrupt 份。
func (s *Store) Snapshot(label string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return "", errors.New("状态库已关闭")
	}
	path := filepath.Join(s.Root, "yovoice."+label+"-"+time.Now().Format("20060102-150405.000000000")+".db")
	if e := backup(s.db, path); e != nil {
		return "", e
	}
	pruneSnapshots(s.Root, "yovoice."+label+"-*.db", keepCorrupt)
	return path, nil
}

// HasData 判断目录中是否已有状态数据（新版数据库或尚未导入的旧版 state.json）。
func HasData(root string) bool {
	for _, name := range []string{DatabaseFile, legacyState} {
		if _, e := os.Stat(filepath.Join(root, name)); e == nil {
			return true
		}
	}
	return false
}
