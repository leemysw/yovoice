package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"yovoice/internal/platform"
	"yovoice/internal/schema"

	"modernc.org/sqlite"
)

// 状态库文件：所有持久化状态保存在单个 SQLite 数据库中，每次修改在一个事务里提交。
const (
	DatabaseFile = "yovoice.db"
	backupFile   = "yovoice.backup.db"
)

// row 是一行已编码的记录；pos 保留列表顺序，data 为实体的 JSON。
type row struct {
	pos  int
	data string
}

// snapshot 是状态按表拆分后的编码结果，用于与上次提交比较，只写入变化的行。
type snapshot map[string]map[string]row

// table 描述 State 中一个持久化字段与数据库表的对应关系。
type table struct {
	name string
	// field 为 State 中对应字段的 JSON 名，用于检查新增字段是否已纳入持久化。
	field  string
	encode func(*schema.State) (map[string]row, error)
	decode func(*schema.State, []string) error
}

// list 把实体切片映射为一张表，每个实体一行，按 ID 定位；ID 为空或重复时以位置区分，保证旧数据也能完整保存。
func list[T any](name, field string, get func(*schema.State) *[]T, id func(T) string) table {
	return table{
		name: name, field: field,
		encode: func(s *schema.State) (map[string]row, error) {
			rows := map[string]row{}
			for i, item := range *get(s) {
				b, e := json.Marshal(item)
				if e != nil {
					return nil, e
				}
				key := id(item)
				if _, taken := rows[key]; taken || key == "" {
					key = fmt.Sprintf("%s#%d", key, i)
				}
				rows[key] = row{pos: i, data: string(b)}
			}
			return rows, nil
		},
		decode: func(s *schema.State, data []string) error {
			items := make([]T, len(data))
			for i, d := range data {
				if e := json.Unmarshal([]byte(d), &items[i]); e != nil {
					return fmt.Errorf("%s: %w", name, e)
				}
			}
			*get(s) = items
			return nil
		},
	}
}

// settings 把单个字段保存为 settings 表中的一行。
type setting struct {
	field string
	value func(*schema.State) any
}

var settingFields = []setting{
	{"preferences", func(s *schema.State) any { return &s.Preferences }},
	{"runtimePath", func(s *schema.State) any { return &s.RuntimePath }},
	{"runtimeBackend", func(s *schema.State) any { return &s.RuntimeBackend }},
	{"runtimeVersion", func(s *schema.State) any { return &s.RuntimeVersion }},
	{"runtimes", func(s *schema.State) any { return &s.Runtimes }},
	{"activity", func(s *schema.State) any { return &s.Activity }},
	{"modelActivity", func(s *schema.State) any { return &s.ModelActivity }},
	{"aiProviderID", func(s *schema.State) any { return &s.AIProviderID }},
	{"assistantSessions", func(s *schema.State) any { return &s.AssistantSessions }},
	{"assistantMemory", func(s *schema.State) any { return &s.AssistantMemory }},
}

// sessionFields 只属于本次会话，不写入数据库。
var sessionFields = []string{"previews", "aiTask", "melody", "assistantLive"}

var tables = []table{
	{
		name: "settings",
		encode: func(s *schema.State) (map[string]row, error) {
			rows := map[string]row{}
			for _, f := range settingFields {
				b, e := json.Marshal(f.value(s))
				if e != nil {
					return nil, e
				}
				rows[f.field] = row{data: string(b)}
			}
			return rows, nil
		},
	},
	list("characters", "characters", func(s *schema.State) *[]schema.Character { return &s.Characters }, func(c schema.Character) string { return c.ID }),
	list("drafts", "drafts", func(s *schema.State) *[]schema.Draft { return &s.Drafts }, func(d schema.Draft) string { return d.ID }),
	list("voices", "voices", func(s *schema.State) *[]schema.Voice { return &s.Voices }, func(v schema.Voice) string { return v.ID }),
	list("models", "models", func(s *schema.State) *[]schema.InstalledModel { return &s.Models }, func(m schema.InstalledModel) string { return m.ID }),
	list("history", "history", func(s *schema.State) *[]schema.Generation { return &s.History }, func(g schema.Generation) string { return g.ID }),
	list("ai_providers", "aiProviders", func(s *schema.State) *[]schema.AIProvider { return &s.AIProviders }, func(p schema.AIProvider) string { return p.ID }),
}

func encode(s *schema.State) (snapshot, error) {
	snap := snapshot{}
	for _, t := range tables {
		rows, e := t.encode(s)
		if e != nil {
			return nil, e
		}
		snap[t.name] = rows
	}
	return snap, nil
}

// openDB 打开（必要时创建）状态库并升级到当前表结构。
// 采用回滚日志而非 WAL：数据目录可能位于外置盘或网络盘，WAL 依赖的共享内存在这些位置不可靠；
// synchronous=FULL 保证提交返回时数据已落盘。
func openDB(path string) (*sql.DB, error) {
	abs, e := filepath.Abs(path)
	if e != nil {
		return nil, e
	}
	// 使用 file: URI 并转义路径，路径中的 ? 或 # 不会被误当作参数。
	p := filepath.ToSlash(abs)
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	dsn := (&url.URL{Scheme: "file", Path: p}).String() + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(DELETE)&_pragma=synchronous(FULL)"
	db, e := sql.Open("sqlite", dsn)
	if e != nil {
		return nil, e
	}
	// 单连接：写入本就由 Store 串行化。空闲时不保留连接，不长期占用文件句柄：
	// Windows 上打开的文件不能改名或删除，数据目录迁移、损坏恢复与清理都依赖这一点。
	// 写入频率很低，每次事务重新打开连接的开销可以忽略；连接级 PRAGMA 由 DSN 在每次打开时设置。
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(0)
	if e = migrate(db, filepath.Dir(abs)); e != nil {
		db.Close()
		return nil, e
	}
	return db, nil
}

// checkDB 做快速完整性检查；返回的错误若为损坏类，调用方转入恢复流程。
func checkDB(db *sql.DB) error {
	var result string
	if e := db.QueryRow("PRAGMA quick_check").Scan(&result); e != nil {
		return e
	}
	if result != "ok" {
		return errCorrupt{result}
	}
	return nil
}

type errCorrupt struct{ detail string }

func (e errCorrupt) Error() string { return "database corrupt: " + e.detail }

// sqliteCode 返回 SQLite 主错误码；不是 SQLite 错误时为 0。
func sqliteCode(e error) int {
	var se *sqlite.Error
	if errors.As(e, &se) {
		return se.Code() & 0xff
	}
	return 0
}

// corrupt 判断错误是否表示数据库文件本身已损坏或不是数据库。
func corrupt(e error) bool {
	if _, ok := e.(errCorrupt); ok {
		return true
	}
	switch sqliteCode(e) {
	case 11, 26: // SQLITE_CORRUPT, SQLITE_NOTADB
		return true
	}
	return false
}

// diskFull 判断错误是否为磁盘已满（SQLITE_FULL）。
func diskFull(e error) bool { return sqliteCode(e) == 13 }

// unwritable 判断错误是否为数据库只读或无法打开（SQLITE_READONLY、SQLITE_CANTOPEN）。
func unwritable(e error) bool {
	switch sqliteCode(e) {
	case 8, 14:
		return true
	}
	return false
}

// load 读取全部表并组装状态；缺失的设置保持默认值。
func load(db *sql.DB) (schema.State, snapshot, error) {
	state := schema.DefaultState()
	snap := snapshot{}
	for _, t := range tables {
		rows, e := db.Query("SELECT key, pos, data FROM " + t.name + " ORDER BY pos, key")
		if e != nil {
			return state, nil, e
		}
		saved := map[string]row{}
		var data []string
		for rows.Next() {
			var key string
			var r row
			if e = rows.Scan(&key, &r.pos, &r.data); e != nil {
				rows.Close()
				return state, nil, e
			}
			saved[key] = r
			data = append(data, r.data)
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return state, nil, e
		}
		snap[t.name] = saved
		if t.decode != nil {
			if e = t.decode(&state, data); e != nil {
				return state, nil, errCorrupt{e.Error()}
			}
			continue
		}
		for _, f := range settingFields {
			if r, ok := saved[f.field]; ok {
				if e = json.Unmarshal([]byte(r.data), f.value(&state)); e != nil {
					return state, nil, errCorrupt{fmt.Sprintf("settings.%s: %v", f.field, e)}
				}
			}
		}
	}
	return state, snap, nil
}

// commit 在一个事务中写入与 saved 相比发生变化的行，返回本次是否有写入。
func commit(db *sql.DB, saved, next snapshot) (bool, error) {
	tx, e := db.Begin()
	if e != nil {
		return false, e
	}
	defer tx.Rollback()
	changed := false
	for _, t := range tables {
		old, rows := saved[t.name], next[t.name]
		for key, r := range rows {
			if o, ok := old[key]; ok && o == r {
				continue
			}
			if _, e = tx.Exec("INSERT INTO "+t.name+" (key, pos, data) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET pos = excluded.pos, data = excluded.data", key, r.pos, r.data); e != nil {
				return false, e
			}
			changed = true
		}
		for key := range old {
			if _, ok := rows[key]; ok {
				continue
			}
			if _, e = tx.Exec("DELETE FROM "+t.name+" WHERE key = ?", key); e != nil {
				return false, e
			}
			changed = true
		}
	}
	if !changed {
		return false, nil
	}
	return true, tx.Commit()
}

// createDB 新建状态库并写入 state 与 private 中的私有设置；先写临时文件再改名，中途失败不会留下半成品数据库。
func createDB(path string, state schema.State, private map[string]string) error {
	tmp := filepath.Join(filepath.Dir(path), fmt.Sprintf(".yovoice-%d.db", os.Getpid()))
	removeDB(tmp)
	defer removeDB(tmp)
	db, e := openDB(tmp)
	if e != nil {
		return e
	}
	backfillModelSHA256State(&state)
	snap, e := encode(&state)
	if e == nil {
		_, e = commit(db, snapshot{}, snap)
	}
	for key, data := range private {
		if e != nil {
			break
		}
		_, e = db.Exec("INSERT INTO private (key, data) VALUES (?, ?)", key, data)
	}
	if ce := db.Close(); e == nil {
		e = ce
	}
	if e != nil {
		return e
	}
	if e = secure(tmp); e != nil {
		return e
	}
	if e = os.Rename(tmp, path); e != nil {
		return e
	}
	platform.SyncDir(filepath.Dir(path))
	return nil
}

// backup 用 VACUUM INTO 生成一致的完整副本，先写临时文件再改名为 target。
func backup(db *sql.DB, target string) error {
	tmp := filepath.Join(filepath.Dir(target), fmt.Sprintf(".yovoice-backup-%d.db", os.Getpid()))
	removeDB(tmp)
	defer removeDB(tmp)
	if _, e := db.Exec("VACUUM INTO ?", tmp); e != nil {
		return e
	}
	if e := secure(tmp); e != nil {
		return e
	}
	return os.Rename(tmp, target)
}

// secure 收紧数据库文件权限（含 AI 密钥与本机接口令牌）并落盘。
func secure(path string) error {
	if e := os.Chmod(path, 0600); e != nil {
		return e
	}
	return syncFile(path)
}

// loadPrivate 读取 private 表的全部原始内容。
func loadPrivate(db *sql.DB) (map[string]string, error) {
	rows, e := db.Query("SELECT key, data FROM private")
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	private := map[string]string{}
	for rows.Next() {
		var key, data string
		if e = rows.Scan(&key, &data); e != nil {
			return nil, e
		}
		private[key] = data
	}
	return private, rows.Err()
}

// removeDB 删除数据库文件及其回滚日志。
func removeDB(path string) {
	_ = os.Remove(path)
	_ = os.Remove(path + "-journal")
}

func syncFile(path string) error {
	f, e := os.OpenFile(path, os.O_RDWR, 0)
	if e != nil {
		return e
	}
	e = f.Sync()
	if ce := f.Close(); e == nil {
		e = ce
	}
	return e
}
