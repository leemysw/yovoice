// Package store 持久化应用状态、广播变更，并迁移旧版数据目录。
package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
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

// WebCacheDir 是 Windows 宿主的 WebView2 用户数据目录，完全可再生；宿主运行期间其中文件始终被占用。
const WebCacheDir = "web-cache"

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
	if _, e := os.Stat(path); os.IsNotExist(e) {
		if _, be := os.Stat(filepath.Join(s.Root, backupFile)); be == nil {
			// 状态库不在而备份还在（恢复中途失败、同步盘或杀毒软件临时移走文件）：先从备份恢复。
			// 此时绝不能新建空库，否则启动后的备份刷新会用空库覆盖唯一的副本，全部数据丢失。
			if e = s.restoreMissing(path); e != nil {
				return e
			}
		} else {
			state, found, e := readLegacy(s.Root)
			if e != nil {
				return e
			}
			if e = createDB(path, state, nil); e != nil {
				return e
			}
			if found {
				diag.Log(s.Root, "state.imported", "source", legacyState)
			}
		}
	} else if e != nil {
		return e
	}
	e := s.load(path)
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

// restoreMissing 在状态库文件丢失时用备份补回；遗留的回滚日志属于丢失的那份库，移走以免被应用到备份上。
func (s *Store) restoreMissing(path string) error {
	stamp := time.Now().Format("20060102-150405.000000000")
	if e := os.Rename(path+"-journal", filepath.Join(s.Root, "yovoice.corrupt-"+stamp+".db-journal")); e != nil && !os.IsNotExist(e) {
		return e
	}
	if e := copyFile(filepath.Join(s.Root, backupFile), path); e != nil {
		return e
	}
	diag.Log(s.Root, "state.recovered", "source", backupFile, "reason", "database missing")
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
	corruptPath := filepath.Join(s.Root, "yovoice.corrupt-"+time.Now().Format("20060102-150405.000000000")+".db")
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

func copyFile(src, dst string) error {
	in, e := os.Open(src)
	if e != nil {
		return e
	}
	defer in.Close()
	out, e := os.OpenFile(dst, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
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
		_ = os.Remove(dst)
	}
	return e
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

func (s *Store) Subscribe() (chan struct{}, func()) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ch := make(chan struct{}, 1)
	s.subscribers[ch] = true
	ch <- struct{}{}
	return ch, func() { s.mu.Lock(); delete(s.subscribers, ch); s.mu.Unlock() }
}
func (s *Store) MediaPath(kind, name string) (string, error) {
	if (kind != "voices" && kind != "outputs") || name == "" || name == "." || name == ".." || strings.ContainsAny(name, "/\\:\x00") {
		return "", msg.Err(msg.ErrAudioPathInvalid, nil)
	}
	path := filepath.Join(s.Root, kind, name)
	if info, e := os.Lstat(path); e == nil && info.Mode()&os.ModeSymlink != 0 {
		return "", msg.Err(msg.ErrAudioPathSymlink, nil)
	}
	return path, nil
}
func DefaultDirectory() (string, error) {
	home, e := os.UserHomeDir()
	return filepath.Join(home, ".yovoice"), e
}

// StorageConfig 存储全局重定向配置。
// PreviousPaths 记录迁移前的旧目录：新目录成功启动后由 CleanupPrevious 清理，释放原磁盘空间；
// 清理失败的旧目录保留在列表中下次重试，再次迁移时追加而不是覆盖，旧目录不会变成无人管理的孤儿。
type StorageConfig struct {
	DataPath      string   `json:"dataPath"`
	PreviousPaths []string `json:"previousPaths,omitempty"`
	// PreviousPath 是旧版只记一个旧目录的字段，读取时并入 PreviousPaths，写入时不再使用。
	PreviousPath string `json:"previousPath,omitempty"`
}

// ConfigFile 返回平台全局存储配置文件的路径，需与 Windows / macOS 宿主读取的位置保持一致。
func ConfigFile() (string, error) {
	var base string
	if runtime.GOOS == "windows" {
		base = os.Getenv("APPDATA")
		if base == "" {
			home, err := os.UserHomeDir()
			if err != nil {
				return "", err
			}
			base = filepath.Join(home, "AppData", "Roaming")
		}
	} else if runtime.GOOS == "darwin" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		base = filepath.Join(home, "Library", "Application Support")
	} else {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		base = filepath.Join(home, ".config")
	}
	return filepath.Join(base, "yovoice", "storage.json"), nil
}

// ReadConfig 读取已保存的数据目录重定向配置。
func ReadConfig() (StorageConfig, error) {
	var cfg StorageConfig
	cfgPath, err := ConfigFile()
	if err != nil {
		return cfg, err
	}
	b, err := os.ReadFile(cfgPath)
	if err != nil {
		return cfg, err
	}
	if err = json.Unmarshal(b, &cfg); err != nil {
		return cfg, fmt.Errorf("存储配置 %s 已损坏：%w", cfgPath, err)
	}
	if cfg.PreviousPath != "" {
		if !slices.ContainsFunc(cfg.PreviousPaths, func(p string) bool { return SamePath(p, cfg.PreviousPath) }) {
			cfg.PreviousPaths = append(cfg.PreviousPaths, cfg.PreviousPath)
		}
		cfg.PreviousPath = ""
	}
	return cfg, nil
}

// RecordRelocation 把数据目录切换到 target，并把 from 追加到待清理的旧目录列表；保留配置中的其他内容。
func RecordRelocation(from, target string) error {
	cfg, err := ReadConfig()
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	cfg.DataPath = target
	cfg.PreviousPaths = slices.DeleteFunc(cfg.PreviousPaths, func(p string) bool { return SamePath(p, target) || SamePath(p, from) })
	cfg.PreviousPaths = append(cfg.PreviousPaths, from)
	return WriteConfig(cfg)
}

// WriteConfig 原子保存数据目录重定向配置，避免写到一半时宿主读到损坏的配置。
func WriteConfig(cfg StorageConfig) error {
	cfgPath, err := ConfigFile()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(cfgPath), 0700); err != nil {
		return err
	}
	b, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return platform.WriteFileAtomic(cfgPath, b, 0600)
}

// SamePath 判断两个路径是否指向同一位置；Windows 与 macOS 默认文件系统不区分大小写。
func SamePath(a, b string) bool {
	a, b = filepath.Clean(a), filepath.Clean(b)
	if runtime.GOOS == "windows" || runtime.GOOS == "darwin" {
		return strings.EqualFold(a, b)
	}
	return a == b
}

// Within 判断 child 是否位于 parent 内部（含相同路径）。
func Within(parent, child string) bool {
	parent, child = filepath.Clean(parent), filepath.Clean(child)
	if SamePath(parent, child) {
		return true
	}
	if runtime.GOOS == "windows" || runtime.GOOS == "darwin" {
		parent, child = strings.ToLower(parent), strings.ToLower(child)
	}
	rel, err := filepath.Rel(parent, child)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel)
}

// dataEntries 是数据目录中由应用创建的条目；清理旧目录时只删除这些，其余内容（用户自行放入的文件）原样保留。
var dataEntries = []string{"voices", "outputs", "downloads", "runtime", "models", "logs", "service.lock", hostPreferences, backupFile, legacyBackup, legacyMigrated, "local-api.json", "secrets.json", WebCacheDir}

// dataEntry 判断名称是否为应用创建的条目，包括损坏快照与修复快照。
func dataEntry(name string) bool {
	if slices.Contains(dataEntries, name) {
		return true
	}
	for _, pattern := range []string{"state.corrupt-*.json", "yovoice.*.db", "yovoice.*.db-journal", ".yovoice-*", ".tmp-*"} {
		if ok, _ := filepath.Match(pattern, name); ok {
			return true
		}
	}
	return false
}

// CleanupPrevious 在新数据目录成功启动后清理迁移前的旧目录，返回已清理的目录。
// 只有配置确认当前目录就是迁移目标、旧目录确实是数据目录且没有其他进程占用时才清理；
// 宿主未切换到新目录（例如旧版宿主）时保持旧目录不动，绝不删除正在使用的数据。
// 清理只删除应用创建的条目，状态文件最后删除；目录里还有其他内容时保留目录本身。
func CleanupPrevious(root string) (removed []string, err error) {
	cfg, err := ReadConfig()
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	if len(cfg.PreviousPaths) == 0 || cfg.DataPath == "" || !SamePath(cfg.DataPath, root) {
		return nil, nil
	}
	var pending []string
	var errs []error
	for _, previous := range cfg.PreviousPaths {
		done, e := cleanupPrevious(root, previous)
		if e != nil {
			errs = append(errs, fmt.Errorf("%s: %w", previous, e))
		}
		if done {
			removed = append(removed, previous)
		} else {
			pending = append(pending, previous)
		}
	}
	if len(pending) != len(cfg.PreviousPaths) {
		cfg.PreviousPaths = pending
		if e := WriteConfig(cfg); e != nil {
			errs = append(errs, e)
		}
	}
	return removed, errors.Join(errs...)
}

// cleanupPrevious 清理单个旧目录；done 为真表示无需再保留在待清理列表中。
func cleanupPrevious(root, previous string) (done bool, err error) {
	if previous == "" || Within(previous, root) || Within(root, previous) {
		return true, nil
	}
	if _, e := os.Stat(previous); os.IsNotExist(e) {
		return true, nil
	}
	if !HasData(previous) {
		// 不是可识别的数据目录，不冒险删除。
		return true, nil
	}
	lock, e := platform.Lock(filepath.Join(previous, "service.lock"))
	if e != nil {
		// 旧目录仍被其他进程使用，下次启动再试。
		return false, e
	}
	lock.Close()
	entries, e := os.ReadDir(previous)
	if e != nil {
		return false, e
	}
	for _, entry := range entries {
		if name := entry.Name(); name != DatabaseFile && name != legacyState && dataEntry(name) {
			if e = os.RemoveAll(filepath.Join(previous, name)); e != nil {
				return false, e
			}
		}
	}
	// 状态文件最后删除：中途退出时下次启动仍能识别这是旧数据目录并继续清理。
	for _, name := range []string{DatabaseFile + "-journal", DatabaseFile, legacyState} {
		if e = os.Remove(filepath.Join(previous, name)); e != nil && !os.IsNotExist(e) {
			return false, e
		}
	}
	// 只在目录已空时删除目录本身，用户放入的其他文件保留。
	if e = os.Remove(previous); e != nil {
		if rest, _ := os.ReadDir(previous); len(rest) > 0 {
			return true, nil
		}
		return false, e
	}
	return true, nil
}
