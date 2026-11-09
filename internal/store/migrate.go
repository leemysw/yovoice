package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"time"
	"yovoice/internal/catalog"
	"yovoice/internal/schema"
)

// 状态库升级：PRAGMA user_version 记录已执行的步骤数，打开时按顺序补跑缺少的步骤，全部在同一事务内完成，
// 失败时整体回滚、版本不变。已有数据的库升级前先留一份完整副本。
// 已发布的步骤不能修改，表结构或已保存数据的格式变化时在末尾追加新步骤；旧格式只在这里转换，读取代码只认当前格式。

// migration 是一次升级：sql 修改表结构，data 改写已保存的记录，二者按需填写；root 为数据目录。
type migration struct {
	sql  string
	data func(tx *sql.Tx, root string) error
}

var migrations = []migration{
	// 1：建表。
	{sql: `CREATE TABLE settings (key TEXT PRIMARY KEY, pos INTEGER NOT NULL, data TEXT NOT NULL);
	 CREATE TABLE characters (key TEXT PRIMARY KEY, pos INTEGER NOT NULL, data TEXT NOT NULL);
	 CREATE TABLE drafts (key TEXT PRIMARY KEY, pos INTEGER NOT NULL, data TEXT NOT NULL);
	 CREATE TABLE voices (key TEXT PRIMARY KEY, pos INTEGER NOT NULL, data TEXT NOT NULL);
	 CREATE TABLE models (key TEXT PRIMARY KEY, pos INTEGER NOT NULL, data TEXT NOT NULL);
	 CREATE TABLE history (key TEXT PRIMARY KEY, pos INTEGER NOT NULL, data TEXT NOT NULL);
	 CREATE TABLE ai_providers (key TEXT PRIMARY KEY, pos INTEGER NOT NULL, data TEXT NOT NULL);
	 CREATE TABLE private (key TEXT PRIMARY KEY, data TEXT NOT NULL);`},
	// 2：补齐旧作品（台词 ID、空乐谱、旧故事的整篇音频放上时间线）；助手旧消息的工具卡片并入内容块；
	// 旧版下载的内核按安装目录名补记版本。
	{data: func(tx *sql.Tx, root string) error {
		if e := upgradeDrafts(tx); e != nil {
			return e
		}
		if e := rewriteRows(tx, "settings", assistantBlocks); e != nil {
			return e
		}
		return runtimeVersion(tx, root)
	}},
	// 3：按本次模型目录更新前的清单，为已安装模型补记主文件 SHA256。
	{data: func(tx *sql.Tx, root string) error {
		return rewriteRows(tx, "models", func(_ string, data []byte) ([]byte, error) {
			return backfillModelSHA256(data)
		})
	}},
	// 4：转写页的转写记录改为长期保存。
	{sql: `CREATE TABLE transcripts (key TEXT PRIMARY KEY, pos INTEGER NOT NULL, data TEXT NOT NULL);`},
}

func backfillModelSHA256(data []byte) ([]byte, error) {
	var model schema.InstalledModel
	if err := json.Unmarshal(data, &model); err != nil {
		return nil, err
	}
	legacy := catalog.LegacyModelFiles[model.ID]
	if model.SHA256 != "" || legacy.SHA256 == "" {
		return nil, nil
	}
	model.SHA256 = legacy.SHA256
	return json.Marshal(model)
}

func backfillModelSHA256State(state *schema.State) {
	for i := range state.Models {
		if state.Models[i].SHA256 == "" {
			state.Models[i].SHA256 = catalog.LegacyModelFiles[state.Models[i].ID].SHA256
		}
	}
}

// schemaVersion 是当前应用对应的状态库版本。
var schemaVersion = len(migrations)

// upgradeSnapshot 是升级前副本的文件名前缀，最多保留 keepCorrupt 份。
const upgradeSnapshot = "yovoice.upgrade"

func migrate(db *sql.DB, root string) error {
	var version int
	if e := db.QueryRow("PRAGMA user_version").Scan(&version); e != nil {
		return e
	}
	if version > schemaVersion {
		return fmt.Errorf("数据库版本 %d 高于当前应用支持的版本 %d，请升级应用", version, schemaVersion)
	}
	if version == schemaVersion {
		return nil
	}
	if version > 0 {
		// 升级会改写已保存的数据，先留一份副本，升级逻辑有误时仍能找回原始数据。
		path := filepath.Join(root, fmt.Sprintf("%s-v%d-%s.db", upgradeSnapshot, version, time.Now().Format("20060102-150405.000000000")))
		if e := backup(db, path); e != nil {
			return e
		}
		pruneSnapshots(root, upgradeSnapshot+"-*.db", keepCorrupt)
	}
	tx, e := db.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	for _, step := range migrations[version:] {
		if step.sql != "" {
			if _, e = tx.Exec(step.sql); e != nil {
				return e
			}
		}
		if step.data != nil {
			if e = step.data(tx, root); e != nil {
				return e
			}
		}
	}
	if _, e = tx.Exec(fmt.Sprintf("PRAGMA user_version = %d", schemaVersion)); e != nil {
		return e
	}
	return tx.Commit()
}

// rewriteRows 逐行交给 change 改写，change 返回 nil 表示该行不变；只写回变化的行。
func rewriteRows(tx *sql.Tx, table string, change func(key string, data []byte) ([]byte, error)) error {
	rows, e := tx.Query("SELECT key, data FROM " + table)
	if e != nil {
		return e
	}
	type record struct{ key, data string }
	var records []record
	for rows.Next() {
		var r record
		if e = rows.Scan(&r.key, &r.data); e != nil {
			rows.Close()
			return e
		}
		records = append(records, r)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return e
	}
	for _, r := range records {
		next, e := change(r.key, []byte(r.data))
		if e != nil {
			return fmt.Errorf("%s.%s: %w", table, r.key, e)
		}
		if next == nil {
			continue
		}
		if _, e = tx.Exec("UPDATE "+table+" SET data = ? WHERE key = ?", string(next), r.key); e != nil {
			return e
		}
	}
	return nil
}

// upgradeDrafts 补齐旧作品：台词与乐谱按 Draft.Normalize 补齐；还没有时间线的旧故事作品，
// 把最近一次整篇生成的音频作为一个片段放上时间线，与旧版界面打开时显示的一致。
func upgradeDrafts(tx *sql.Tx) error {
	// 历史表按 pos 从新到旧排列，每个作品取第一条整篇生成；已有分句生成的作品由界面按分句接收，不放整篇音频。
	whole, segmented := map[string]schema.Generation{}, map[string]bool{}
	rows, e := tx.Query("SELECT data FROM history ORDER BY pos, key")
	if e != nil {
		return e
	}
	for rows.Next() {
		var data string
		var g schema.Generation
		if e = rows.Scan(&data); e == nil {
			e = json.Unmarshal([]byte(data), &g)
		}
		if e != nil {
			rows.Close()
			return e
		}
		if g.Segment != nil {
			segmented[g.Settings.ID] = true
		} else if _, seen := whole[g.Settings.ID]; !seen {
			whole[g.Settings.ID] = g
		}
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return e
	}
	return rewriteRows(tx, "drafts", func(_ string, data []byte) ([]byte, error) {
		var d schema.Draft
		if e := json.Unmarshal(data, &d); e != nil {
			return nil, e
		}
		changed := d.Kind == "score" && (d.Score == nil || d.Score.Tracks == nil) ||
			d.Subtitles != nil && slices.ContainsFunc(d.Subtitles.Cues, func(c schema.SubtitleCue) bool { return c.ID == "" })
		d.Normalize()
		story := d.Subtitles != nil || d.Kind == "story" || d.Kind == "subtitle"
		if g, ok := whole[d.ID]; ok && story && d.Timeline == nil && !segmented[d.ID] {
			d.Timeline = &schema.AudioTimeline{Tracks: []schema.AudioLane{{ID: "legacy-" + g.ID, Name: d.Title, Clips: []schema.AudioClip{{ID: g.ID, GenerationID: g.ID, Duration: g.Duration}}}}}
			changed = true
		}
		if !changed {
			return nil, nil
		}
		return json.Marshal(d)
	})
}

// assistantBlocks 把助手旧消息单独存放的工具卡片转成内容块：工具在前、文本在后，与旧版界面的显示顺序一致。
func assistantBlocks(key string, data []byte) ([]byte, error) {
	if key != "assistantSessions" {
		return nil, nil
	}
	type message struct {
		schema.AssistantMessage
		Tools []schema.AssistantToolCard `json:"tools,omitempty"`
	}
	var sessions *struct {
		CurrentID string `json:"currentId"`
		Sessions  []struct {
			ID        string    `json:"id"`
			Title     string    `json:"title"`
			Messages  []message `json:"messages"`
			UpdatedAt time.Time `json:"updatedAt"`
		} `json:"sessions"`
	}
	if e := json.Unmarshal(data, &sessions); e != nil {
		return nil, e
	}
	if sessions == nil {
		return nil, nil
	}
	changed := false
	next := schema.AssistantSessions{CurrentID: sessions.CurrentID, Sessions: make([]schema.AssistantSession, 0, len(sessions.Sessions))}
	for _, s := range sessions.Sessions {
		session := schema.AssistantSession{ID: s.ID, Title: s.Title, UpdatedAt: s.UpdatedAt, Messages: make([]schema.AssistantMessage, 0, len(s.Messages))}
		for _, m := range s.Messages {
			if len(m.Tools) > 0 {
				changed = true
				if len(m.Blocks) == 0 {
					for i := range m.Tools {
						m.Blocks = append(m.Blocks, schema.AssistantBlock{Kind: "tool", Card: &m.Tools[i]})
					}
					if m.Text != "" {
						m.Blocks = append(m.Blocks, schema.AssistantBlock{Kind: "text", Text: m.Text})
					}
				}
			}
			session.Messages = append(session.Messages, m.AssistantMessage)
		}
		next.Sessions = append(next.Sessions, session)
	}
	if !changed {
		return nil, nil
	}
	return json.Marshal(next)
}

// runtimeDir 匹配内核安装目录名“版本-后端-随机数”。
var runtimeDir = regexp.MustCompile(`^v\d+\.\d+\.\d+-[a-z0-9]+-\d+$`)

// runtimeVersion 为旧版下载、未记录版本的内核补记版本：版本取自数据目录下 runtime 中的安装目录名，用户无需重新下载。
func runtimeVersion(tx *sql.Tx, root string) error {
	var path *string
	var version *string
	for key, target := range map[string]**string{"runtimePath": &path, "runtimeVersion": &version} {
		var data string
		e := tx.QueryRow("SELECT data FROM settings WHERE key = ?", key).Scan(&data)
		if e == sql.ErrNoRows {
			continue
		}
		if e != nil {
			return e
		}
		if e = json.Unmarshal([]byte(data), target); e != nil {
			return fmt.Errorf("settings.%s: %w", key, e)
		}
	}
	if path == nil || version != nil {
		return nil
	}
	rel, e := filepath.Rel(filepath.Join(root, "runtime"), *path)
	if e != nil {
		return nil
	}
	dir, _, _ := strings.Cut(filepath.ToSlash(rel), "/")
	if !runtimeDir.MatchString(dir) {
		return nil
	}
	found, _, _ := strings.Cut(dir, "-")
	b, e := json.Marshal(found)
	if e != nil {
		return e
	}
	_, e = tx.Exec("INSERT INTO settings (key, pos, data) VALUES ('runtimeVersion', 0, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data", string(b))
	return e
}
