package workbench

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
)

type Store struct {
	Root        string
	mu          sync.Mutex
	state       State
	subscribers map[chan struct{}]bool
}

func NewStore(root string) (*Store, error) {
	for _, d := range []string{"", "voices", "outputs", "downloads", "runtime", "models", "logs"} {
		if e := os.MkdirAll(filepath.Join(root, d), 0700); e != nil {
			return nil, e
		}
	}
	s := &Store{Root: root, state: defaultState(), subscribers: map[chan struct{}]bool{}}
	b, e := os.ReadFile(filepath.Join(root, "state.json"))
	fromFile := false
	if e == nil {
		fromFile = true
		if string(b) == "null" {
			return nil, Err(MsgErrStateCorrupt, nil)
		}
		if e = json.Unmarshal(b, &s.state); e != nil {
			return nil, Err(MsgErrStateCorrupt, MessageParams{"detail": e.Error()})
		}
	} else if !os.IsNotExist(e) {
		return nil, e
	}
	if s.state.Activity != nil && s.state.Activity.Status == "running" {
		s.state.Activity.Status = "interrupted"
		s.state.Activity.Code = MsgActivityInterrupted
		s.state.Activity.Params = nil
		s.state.Activity.ErrorCode = nil
		s.state.Activity.ErrorParams = nil
	} else if s.state.Activity != nil && s.state.Activity.Code == "" {
		s.state.Activity = nil
	}
	// Legacy state.json without uiLocale defaults to zh-CN. Brand-new installs stay empty so the web can persist navigator.language.
	if s.state.Preferences.UiLocale == "" && fromFile {
		s.state.Preferences.UiLocale = UiLocaleZhCN
	}
	// 未保存的试听不跨会话保留，角色已保存的试听使用独立文件。
	s.state.Previews = []CharacterPreview{}
	files, _ := filepath.Glob(filepath.Join(root, "outputs", "audition-*.wav"))
	for _, file := range files {
		_ = os.Remove(file)
	}
	return s, nil
}
func clone(s State) State    { b, _ := json.Marshal(s); var r State; _ = json.Unmarshal(b, &r); return r }
func (s *Store) Read() State { s.mu.Lock(); defer s.mu.Unlock(); return clone(s.state) }
func writeState(path string, state State) error {
	b, e := json.MarshalIndent(state, "", "  ")
	if e != nil {
		return e
	}
	f, e := os.CreateTemp(filepath.Dir(path), ".state-*")
	if e != nil {
		return e
	}
	defer os.Remove(f.Name())
	if _, e = f.Write(b); e == nil {
		e = f.Sync()
	}
	ce := f.Close()
	if e != nil {
		return e
	}
	if ce != nil {
		return ce
	}
	return os.Rename(f.Name(), path)
}
func (s *Store) Update(change func(*State), persist bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := clone(s.state)
	change(&next)
	if persist {
		if e := writeState(filepath.Join(s.Root, "state.json"), next); e != nil {
			return e
		}
	}
	s.state = next
	for ch := range s.subscribers {
		select {
		case ch <- struct{}{}:
		default:
		}
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
func (s *Store) MediaPath(kind, name string) (string, error) {
	if (kind != "voices" && kind != "outputs") || name == "" || name == "." || name == ".." || strings.ContainsAny(name, "/\\:\x00") {
		return "", Err(MsgErrAudioPathInvalid, nil)
	}
	path := filepath.Join(s.Root, kind, name)
	if info, e := os.Lstat(path); e == nil && info.Mode()&os.ModeSymlink != 0 {
		return "", Err(MsgErrAudioPathSymlink, nil)
	}
	return path, nil
}
func DefaultDirectory() (string, error) {
	home, e := os.UserHomeDir()
	return filepath.Join(home, ".yovoice"), e
}
func PrepareDefault() error {
	target, e := DefaultDirectory()
	if e != nil {
		return e
	}
	home, e := os.UserHomeDir()
	if e != nil {
		return e
	}
	legacy := filepath.Join(home, "Library", "Application Support", "VoiceWorkbench")
	if runtime.GOOS == "windows" {
		legacy = filepath.Join(os.Getenv("LOCALAPPDATA"), "VoiceWorkbench")
	}
	return Migrate(legacy, target)
}
func Migrate(legacy, target string) error {
	if _, e := os.Stat(target); e == nil {
		return nil
	} else if !os.IsNotExist(e) {
		return e
	}
	if _, e := os.Stat(legacy); os.IsNotExist(e) {
		return nil
	} else if e != nil {
		return e
	}
	lock, e := Lock(filepath.Join(legacy, "service.lock"))
	if e != nil {
		return e
	}
	defer lock.Close()
	var state State
	b, e := os.ReadFile(filepath.Join(legacy, "state.json"))
	hasState := e == nil
	if e != nil && !os.IsNotExist(e) {
		return e
	}
	if hasState {
		if string(b) == "null" {
			return Err(MsgErrLegacyRestore, nil)
		}
		if e = json.Unmarshal(b, &state); e != nil {
			return e
		}
		rebase := func(p *string) *string {
			if p == nil {
				return nil
			}
			rel, e := filepath.Rel(legacy, *p)
			if e == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel) {
				return ptr(filepath.Join(target, rel))
			}
			return p
		}
		state.RuntimePath = rebase(state.RuntimePath)
		state.Preferences.ModelDirectory = rebase(state.Preferences.ModelDirectory)
		for i := range state.Models {
			state.Models[i].Path = *rebase(&state.Models[i].Path)
		}
	}
	// Windows 文件锁不允许移动父目录；迁移只在启动新服务前执行。
	if runtime.GOOS == "windows" {
		lock.Close()
	}
	if e = os.Rename(legacy, target); e != nil {
		return e
	}
	if hasState {
		if e = writeState(filepath.Join(target, "state.json"), state); e != nil {
			if rollback := os.Rename(target, legacy); rollback != nil {
				return Err(MsgErrUnknown, MessageParams{"detail": fmt.Sprintf("%v; rollback failed: %v", e, rollback)})
			}
			return e
		}
	}
	return nil
}
