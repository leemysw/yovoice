package diag

import (
	"archive/zip"
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"time"
	"yovoice/internal/platform"
)

// Entry 是服务日志里的一条记录；Fields 是除时间、级别、事件名以外的全部字段。
type Entry struct {
	Time   time.Time      `json:"time"`
	Level  string         `json:"level"`
	Event  string         `json:"event"`
	Fields map[string]any `json:"fields,omitempty"`
}

// Filter 按级别下限、模块（事件名第一段）、关键词和时间范围筛选，Offset/Limit 分页，结果新的在前。
type Filter struct {
	Level  string    `json:"level"`
	Module string    `json:"module"`
	Text   string    `json:"text"`
	Since  time.Time `json:"since"`
	Until  time.Time `json:"until"`
	Offset int       `json:"offset"`
	Limit  int       `json:"limit"`
}

// Page 是一页查询结果；Total 是筛选后的总条数，Modules 是两份日志里出现过的全部模块，供界面筛选。
type Page struct {
	Entries []Entry  `json:"entries"`
	Total   int      `json:"total"`
	Modules []string `json:"modules"`
}

const queryLimit = 500

var levelRank = map[string]int{"DEBUG": 0, "INFO": 1, "WARN": 2, "ERROR": 3}

// Module 取事件名第一段，如 generation.saved 属于 generation。
func Module(event string) string {
	module, _, _ := strings.Cut(event, ".")
	return module
}

// Query 读取 service.log 与滚动的 service.log.1；无法解析的行跳过，日志不存在时返回空页。
func Query(root string, f Filter) (Page, error) {
	if f.Limit <= 0 || f.Limit > queryLimit {
		f.Limit = queryLimit
	}
	f.Offset = max(0, f.Offset)
	text := strings.ToLower(strings.TrimSpace(f.Text))
	minimum := levelRank[strings.ToUpper(f.Level)]
	modules := map[string]bool{}
	var matched []Entry
	// 锁只保护读取与轮转不交错；两份日志最多十几 MB，整体读入后解析放在锁外，不让所有写日志的调用等着解析。
	contents, err := readLogs(root)
	if err != nil {
		return Page{}, err
	}
	for _, content := range contents {
		scanner := bufio.NewScanner(bytes.NewReader(content))
		scanner.Buffer(make([]byte, 64<<10), 1<<20)
		for scanner.Scan() {
			line := scanner.Bytes()
			entry, ok := parse(line)
			if !ok {
				continue
			}
			module := Module(entry.Event)
			modules[module] = true
			if levelRank[entry.Level] < minimum || f.Module != "" && module != f.Module ||
				!f.Since.IsZero() && entry.Time.Before(f.Since) || !f.Until.IsZero() && entry.Time.After(f.Until) ||
				text != "" && !strings.Contains(strings.ToLower(string(line)), text) {
				continue
			}
			matched = append(matched, entry)
		}
		if err := scanner.Err(); err != nil {
			return Page{}, err
		}
	}
	slices.Reverse(matched)
	page := Page{Entries: []Entry{}, Total: len(matched), Modules: make([]string, 0, len(modules))}
	for module := range modules {
		page.Modules = append(page.Modules, module)
	}
	slices.Sort(page.Modules)
	if f.Offset < len(matched) {
		page.Entries = matched[f.Offset:min(len(matched), f.Offset+f.Limit)]
	}
	return page, nil
}

// readLogs 在锁内读取滚动的 service.log.1 与当前的 service.log，顺序为旧到新；不存在的跳过。
func readLogs(root string) ([][]byte, error) {
	diagnosticMu.Lock()
	defer diagnosticMu.Unlock()
	var contents [][]byte
	for _, name := range []string{"service.log.1", "service.log"} {
		content, err := os.ReadFile(filepath.Join(root, "logs", name))
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		contents = append(contents, content)
	}
	return contents, nil
}

func parse(line []byte) (Entry, bool) {
	var raw map[string]any
	if json.Unmarshal(line, &raw) != nil {
		return Entry{}, false
	}
	event, _ := raw["msg"].(string)
	stamp, _ := raw["time"].(string)
	at, err := time.Parse(time.RFC3339Nano, stamp)
	if event == "" || err != nil {
		return Entry{}, false
	}
	level, _ := raw["level"].(string)
	if _, ok := levelRank[level]; !ok {
		level = "INFO"
	}
	delete(raw, "msg")
	delete(raw, "time")
	delete(raw, "level")
	entry := Entry{Time: at, Level: level, Event: event}
	if len(raw) > 0 {
		entry.Fields = raw
	}
	return entry, true
}

// 诊断包里单个日志文件的上限，避免意外的大文件撑大压缩包。
const bundleFileLimit = 20 << 20

// Bundle 把日志目录里的服务、宿主与更新日志打包成 zip，附一份环境说明；推理进程的原始输出（engine.*）不收录。
func Bundle(root, path, version string) error {
	var buffer bytes.Buffer
	archive := zip.NewWriter(&buffer)
	info, err := archive.Create("about.txt")
	if err != nil {
		return err
	}
	_, _ = fmt.Fprintf(info, "yovoice %s\nos %s\narch %s\ncreated %s\n", version, runtime.GOOS, runtime.GOARCH, time.Now().Format(time.RFC3339))
	items, err := os.ReadDir(filepath.Join(root, "logs"))
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	diagnosticMu.Lock()
	defer diagnosticMu.Unlock()
	for _, item := range items {
		name := item.Name()
		if !item.Type().IsRegular() || strings.HasPrefix(name, "engine.") {
			continue
		}
		if e := addFile(archive, filepath.Join(root, "logs", name), "logs/"+name); e != nil {
			return e
		}
	}
	if err = archive.Close(); err != nil {
		return err
	}
	// 先写临时文件再替换，保存失败时不留下半个压缩包。
	return platform.WriteFileAtomic(path, buffer.Bytes(), 0600)
}

func addFile(archive *zip.Writer, source, name string) error {
	file, err := os.Open(source)
	if err != nil {
		return err
	}
	defer file.Close()
	target, err := archive.Create(name)
	if err != nil {
		return err
	}
	content := io.Reader(io.LimitReader(file, bundleFileLimit))
	// 宿主日志不经过 Log，同样把主目录替换为 ~。
	if home != nil {
		b, e := io.ReadAll(content)
		if e != nil {
			return e
		}
		content = bytes.NewReader(bytes.ReplaceAll(bytes.ReplaceAll(b, home, []byte("~")), unescapedHome(), []byte("~")))
	}
	_, err = io.Copy(target, content)
	return err
}

// 宿主日志是纯文本，主目录不是 JSON 转义形式。
func unescapedHome() []byte {
	var dir string
	_ = json.Unmarshal(append(append([]byte{'"'}, home...), '"'), &dir)
	return []byte(dir)
}
