package workbench

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode"
)

type Workbench struct {
	Store      *Store
	mu         sync.Mutex
	cancel     context.CancelFunc
	done       chan struct{}
	closed     bool
	closeOnce  sync.Once
	engine     *Engine
	client     *http.Client
	bundledCPU string
}

func New(root string) (*Workbench, error) {
	s, e := NewStore(root)
	if e != nil {
		return nil, e
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = func(req *http.Request) (*url.URL, error) {
		preferences := s.Read().Preferences
		if (preferences.ProxyEnabled == nil && preferences.ProxyURL == "") || (preferences.ProxyEnabled != nil && !*preferences.ProxyEnabled) {
			return nil, nil
		}
		return downloadProxy(req, preferences.ProxyURL)
	}
	return &Workbench{Store: s, engine: NewEngine(root), client: &http.Client{Transport: transport}}, nil
}

// UseBundledCPU 在服务启动时登记内置内核，保留用户已安装的 GPU 内核。
func (w *Workbench) UseBundledCPU(path string) error {
	info, err := os.Stat(path)
	if os.IsNotExist(err) || path == "" {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return Err(MsgErrCPUBundleInvalid, nil)
	}
	w.bundledCPU = path
	return w.Store.Update(func(s *State) {
		if s.RuntimePath == nil || s.Preferences.Backend == "cpu" {
			s.RuntimePath = ptr(path)
			s.RuntimeBackend = ptr("cpu")
		}
	}, true)
}
func (w *Workbench) SaveDraft(d Draft) error {
	if !validID(d.ID) || textLen(d.Text) > 12000 || textLen(d.Title) > 120 || textLen(d.EmotionText) > 500 || textLen(d.VoiceDescription) > 500 || textLen(d.ReferenceText) > 2000 {
		return Err(MsgErrDraftLimits, nil)
	}
	return w.Store.Update(func(s *State) {
		i := slices.IndexFunc(s.Drafts, func(v Draft) bool { return v.ID == d.ID })
		if i < 0 {
			s.Drafts = append([]Draft{d}, s.Drafts...)
		} else {
			s.Drafts[i] = d
		}
	}, true)
}
func (w *Workbench) MediaFile(kind, id string) (string, error) {
	if !validID(id) {
		return "", Err(MsgErrAudioIDInvalid, nil)
	}
	s := w.Store.Read()
	var file string
	switch kind {
	case "voices":
		for _, v := range s.Voices {
			if v.ID == id {
				file = v.FileName
			}
		}
	case "outputs":
		for _, c := range s.Characters {
			if c.Preview != nil && c.Preview.ID == id {
				file = c.Preview.FileName
			}
		}
		for _, p := range s.Previews {
			if p.ID == id {
				file = p.FileName
			}
		}
		for _, v := range s.History {
			if v.ID == id {
				file = v.FileName
			}
		}
	default:
		return "", Err(MsgErrAudioKindInvalid, nil)
	}
	if file == "" {
		return "", Err(MsgErrAudioMissing, nil)
	}
	return w.Store.MediaPath(kind, file)
}
func (w *Workbench) rename(kind, id, name string) error {
	if _, e := w.MediaFile(kind, id); e != nil {
		return e
	}
	name = strings.TrimSpace(name)
	if textLen(name) < 1 || textLen(name) > 120 || strings.ContainsFunc(name, unicode.IsControl) {
		return Err(MsgErrNameLength, nil)
	}
	return w.Store.Update(func(s *State) {
		if kind == "voices" {
			for i := range s.Voices {
				if s.Voices[i].ID == id {
					s.Voices[i].Name = name
				}
			}
		} else {
			for i := range s.History {
				if s.History[i].ID == id {
					s.History[i].Title = name
				}
			}
		}
	}, true)
}
func (w *Workbench) deleteMedia(kind, id string) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	path, e := w.MediaFile(kind, id)
	if e != nil {
		return e
	}
	s := w.Store.Read()
	if kind == "outputs" && !slices.ContainsFunc(s.History, func(g Generation) bool { return g.ID == id }) {
		return Err(MsgErrAudioMissing, nil)
	}
	if kind == "voices" {
		for _, c := range s.Characters {
			if value(c.Settings.VoiceID) == id || value(c.Settings.EmotionVoiceID) == id {
				return Err(MsgErrVoiceInUse, nil)
			}
		}
	}
	if kind == "voices" && s.Activity != nil && s.Activity.Kind == "generate" && s.Activity.Status == "running" {
		return Err(MsgErrVoiceBusyDelete, nil)
	}
	removed := path + ".deleted"
	_, e = os.Stat(path)
	exists := e == nil
	if e != nil && !os.IsNotExist(e) {
		return e
	}
	if exists {
		if e = os.Rename(path, removed); e != nil {
			return e
		}
	}
	e = w.Store.Update(func(s *State) {
		if kind == "outputs" {
			s.History = slices.DeleteFunc(s.History, func(v Generation) bool { return v.ID == id })
		} else {
			s.Voices = slices.DeleteFunc(s.Voices, func(v Voice) bool { return v.ID == id })
			for i := range s.Drafts {
				if value(s.Drafts[i].VoiceID) == id {
					s.Drafts[i].VoiceID = nil
				}
				if value(s.Drafts[i].EmotionVoiceID) == id {
					s.Drafts[i].EmotionVoiceID = nil
				}
			}
		}
	}, true)
	if e != nil {
		if exists {
			if restore := os.Rename(removed, path); restore != nil {
				return Err(MsgErrUnknown, MessageParams{"detail": fmt.Sprintf("%v; restore failed: %v", e, restore)})
			}
		}
		return e
	}
	if exists {
		return os.Remove(removed)
	}
	return nil
}
func (w *Workbench) preferences(p Preferences) error {
	p.ProxyURL = strings.TrimSpace(p.ProxyURL)
	if p.ProxyEnabled != nil && *p.ProxyEnabled && p.ProxyURL == "" {
		return Err(MsgErrProxyURL, nil)
	}
	if _, err := parseProxyURL(p.ProxyURL); err != nil {
		return err
	}
	if _, e := runtimeArchives(p.Backend); e != nil {
		return e
	}
	if _, e := Catalog[0].URL(p.DownloadSource); e != nil {
		return e
	}
	if p.ModelDirectory != nil && !filepath.IsAbs(*p.ModelDirectory) {
		return Err(MsgErrModelDirAbsolute, nil)
	}
	if p.UiLocale == "" {
		p.UiLocale = w.Store.Read().Preferences.UiLocale
		if p.UiLocale == "" {
			p.UiLocale = UiLocaleZhCN
		}
	} else if _, e := ParseUiLocale(string(p.UiLocale)); e != nil {
		return e
	}
	return w.Store.Update(func(s *State) {
		s.Preferences = p
		if p.Backend == "cpu" && w.bundledCPU != "" {
			s.RuntimePath = ptr(w.bundledCPU)
			s.RuntimeBackend = ptr("cpu")
		} else if runtime.GOOS == "darwin" && s.RuntimePath != nil {
			s.RuntimeBackend = ptr(p.Backend)
		}
	}, true)
}

// 前台命令由服务串行调度，耗时操作独立运行，状态通过 Store 广播。
func (w *Workbench) begin(kind string, code MessageCode, params MessageParams, modelID *string, action func(context.Context) error, requestIDs ...string) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed || w.cancel != nil {
		return Err(MsgErrBusy, nil)
	}
	ctx, cancel := context.WithCancel(context.Background())
	if e := w.Store.Update(func(s *State) {
		requestID := ""
		if len(requestIDs) > 0 {
			requestID = requestIDs[0]
		}
		s.Activity = &Activity{RequestID: requestID, Kind: kind, Code: code, Params: params, Status: "running", ModelID: modelID, StartedAt: time.Now().UTC()}
	}, true); e != nil {
		cancel()
		return e
	}
	w.cancel = cancel
	done := make(chan struct{})
	w.done = done
	go func() {
		defer close(done)
		defer cancel()
		err := action(ctx)
		w.mu.Lock()
		defer w.mu.Unlock()
		update := func(s *State) {
			a := s.Activity
			if err == nil {
				a.Code = MsgActivityCompleted
				a.Params = nil
				a.Status = "completed"
				a.ErrorCode = nil
				a.ErrorParams = nil
			} else if errors.Is(err, context.Canceled) {
				a.Status = "cancelled"
				a.Code = MsgActivityCancelled
				a.Params = nil
				if kind == "download" {
					a.Code = MsgActivityPaused
				}
				a.ErrorCode = nil
				a.ErrorParams = nil
			} else {
				a.Status = "failed"
				a.Code = MsgActivityFailed
				a.Params = nil
				if ce, ok := err.(*CallError); ok && ce != nil {
					a.ErrorCode = &ce.Code
					a.ErrorParams = ce.Params
				} else {
					code := MsgErrUnknown
					a.ErrorCode = &code
					a.ErrorParams = MessageParams{"detail": err.Error()}
				}
			}
		}
		if err != nil && !errors.Is(err, context.Canceled) {
			_ = os.WriteFile(filepath.Join(w.Store.Root, "logs", "last-error.txt"), []byte(err.Error()), 0600)
		}
		if e := w.Store.Update(update, true); e != nil {
			_ = w.Store.Update(func(s *State) {
				update(s)
				s.Activity.Status = "failed"
				code := MsgErrStateSaveFailed
				s.Activity.ErrorCode = &code
				s.Activity.ErrorParams = MessageParams{"detail": e.Error()}
			}, false)
		}
		w.cancel = nil
	}()
	return nil
}
func (w *Workbench) Cancel() {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.cancel != nil {
		w.cancel()
	}
}
func (w *Workbench) Close() {
	w.closeOnce.Do(func() {
		w.mu.Lock()
		w.closed = true
		if w.cancel != nil {
			w.cancel()
		}
		done := w.done
		w.mu.Unlock()
		if done != nil {
			<-done
		}
		w.engine.Stop()
		w.client.CloseIdleConnections()
	})
}

func (w *Workbench) progress(code MessageCode, params MessageParams, received, total int64) {
	_ = w.Store.Update(func(s *State) {
		if s.Activity != nil {
			s.Activity.Code = code
			s.Activity.Params = params
			s.Activity.Received = received
			s.Activity.Total = total
		}
	}, false)
}
func (w *Workbench) register(id, path string, managed bool) error {
	path, e := filepath.Abs(path)
	if e != nil {
		return e
	}
	return w.Store.Update(func(s *State) {
		s.Models = slices.DeleteFunc(s.Models, func(m InstalledModel) bool { return m.ID == id })
		s.Models = append(s.Models, InstalledModel{id, path, managed})
	}, true)
}
func (w *Workbench) download(id string) error {
	m, e := model(id)
	if e != nil {
		return e
	}
	s := w.Store.Read()
	url, e := m.URL(s.Preferences.DownloadSource)
	if e != nil {
		return e
	}
	return w.begin("download", MsgActivityDownload, MessageParams{"name": m.Name}, ptr(id), func(ctx context.Context) error {
		dir := value(s.Preferences.ModelDirectory)
		if dir == "" {
			dir = filepath.Join(w.Store.Root, "models")
		}
		if e := os.MkdirAll(dir, 0700); e != nil {
			return e
		}
		dest := filepath.Join(dir, filepath.Base(m.RemotePath))
		available, e := freeSpace(dir)
		if e != nil {
			return e
		}
		need := max(int64(0), m.Size-fileSize(dest+".part")) + (100 << 20)
		if available < uint64(need) {
			return Err(MsgErrModelDirSpace, nil)
		}
		if e = Download(ctx, w.client, url, dest, m.SHA256, m.Size, func(r, t int64) {
			code, params := MsgActivityDownloading, MessageParams{"name": m.Name}
			if r == t {
				code, params = MsgActivityVerifying, nil
			}
			w.progress(code, params, r, t)
		}); e != nil {
			return e
		}
		return w.register(id, dest, true)
	})
}
func (w *Workbench) importModel(path string) error {
	return w.begin("import", MsgActivityImport, nil, nil, func(ctx context.Context) error {
		paths := []string{path}
		info, e := os.Stat(path)
		if e != nil {
			return e
		}
		if info.IsDir() {
			paths, e = filepath.Glob(filepath.Join(path, "*.gguf"))
			if e != nil {
				return e
			}
		}
		count := 0
		for _, p := range paths {
			if e = ctx.Err(); e != nil {
				return e
			}
			size := fileSize(p)
			if !slices.ContainsFunc(Catalog, func(m ModelPackage) bool { return m.Size == size }) {
				continue
			}
			hash, e := Hash(ctx, p)
			if e != nil {
				return e
			}
			for _, m := range Catalog {
				if m.SHA256 == hash {
					if e = w.register(m.ID, p, false); e != nil {
						return e
					}
					count++
				}
			}
		}
		if count == 0 {
			return Err(MsgErrModelImportNone, nil)
		}
		return nil
	})
}
func (w *Workbench) install() error {
	backend := w.Store.Read().Preferences.Backend
	archives, e := runtimeArchives(backend)
	if e != nil {
		return e
	}
	return w.begin("runtime", MsgActivityRuntimeDownload, nil, nil, func(ctx context.Context) (err error) {
		w.engine.Stop()
		staging, err := os.MkdirTemp(filepath.Join(w.Store.Root, "runtime"), EngineVersion+"-"+backend+"-")
		if err != nil {
			return err
		}
		defer func() {
			if err != nil {
				_ = os.RemoveAll(staging)
			}
		}()
		for _, a := range archives {
			file := filepath.Join(w.Store.Root, "downloads", a.Name)
			if err = Download(ctx, w.client, "https://github.com/0xShug0/audio.cpp/releases/download/"+EngineVersion+"/"+a.Name, file, a.Hash, 0, func(r, t int64) { w.progress(MsgActivityRuntimeDownload, nil, r, t) }); err != nil {
				return err
			}
			w.progress(MsgActivityRuntimeExtract, nil, 0, 0)
			if err = Extract(ctx, file, staging); err != nil {
				return err
			}
		}
		name := "audiocpp_server"
		if runtime.GOOS == "windows" {
			name += ".exe"
		}
		executables := []string{}
		dlls := []string{}
		err = filepath.WalkDir(staging, func(p string, d os.DirEntry, e error) error {
			if e != nil {
				return e
			}
			if !d.IsDir() {
				if d.Name() == name {
					executables = append(executables, p)
				}
				if strings.EqualFold(filepath.Ext(p), ".dll") {
					dlls = append(dlls, p)
				}
			}
			return ctx.Err()
		})
		if err != nil {
			return err
		}
		if len(executables) != 1 {
			return Err(MsgErrRuntimeUnique, nil)
		}
		executable := executables[0]
		for _, dll := range dlls {
			target := filepath.Join(filepath.Dir(executable), filepath.Base(dll))
			if !strings.EqualFold(target, dll) {
				b, e := os.ReadFile(dll)
				if e != nil {
					return e
				}
				if e = os.WriteFile(target, b, 0600); e != nil {
					return e
				}
			}
		}
		if err = os.Chmod(executable, 0755); err != nil {
			return err
		}
		if err = ctx.Err(); err != nil {
			return err
		}
		return w.Store.Update(func(s *State) { s.RuntimePath = ptr(executable); s.RuntimeBackend = ptr(backend) }, true)
	})
}
func (w *Workbench) ImportVoice(ctx context.Context, path, name string) (Voice, error) {
	return w.importVoice(ctx, path, name, "", "")
}

func (w *Workbench) importVoice(ctx context.Context, path, name, referenceText, sourceID string) (Voice, error) {
	info, e := os.Stat(path)
	if e != nil {
		return Voice{}, e
	}
	if !info.Mode().IsRegular() || info.Size() > 20<<20 {
		return Voice{}, Err(MsgErrAudioTooLarge, nil)
	}
	originalPath := path
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	duration, e := Duration(path)
	if e != nil {
		temporary, err := os.MkdirTemp(filepath.Join(w.Store.Root, "downloads"), "audio-")
		if err != nil {
			return Voice{}, err
		}
		defer os.RemoveAll(temporary)
		executable, err := w.audioConverter()
		if err != nil {
			return Voice{}, err
		}
		path = filepath.Join(temporary, "reference.wav")
		if err = convertAudio(ctx, executable, originalPath, path); err != nil {
			return Voice{}, err
		}
		duration, e = Duration(path)
		if e != nil {
			return Voice{}, e
		}
	}
	if duration < 1 || duration > 60 {
		return Voice{}, Err(MsgErrAudioDuration, nil)
	}
	if strings.TrimSpace(name) == "" {
		name = strings.TrimSuffix(filepath.Base(originalPath), filepath.Ext(originalPath))
	}
	r := []rune(name)
	if len(r) > 100 {
		name = string(r[:100])
	}
	if err := ctx.Err(); err != nil {
		return Voice{}, err
	}
	id := newID()
	v := Voice{ID: id, Name: name, FileName: id + ".wav", Duration: duration, Source: "import", ReferenceText: referenceText, SourceGenerationID: sourceID}
	if sourceID != "" {
		v.Source = "generation"
	}
	dest, e := w.Store.MediaPath("voices", v.FileName)
	if e != nil {
		return Voice{}, e
	}
	b, e := os.ReadFile(path)
	if e != nil {
		return Voice{}, e
	}
	if len(b) > 20<<20 {
		return Voice{}, Err(MsgErrAudioTooLarge, nil)
	}
	if e = os.WriteFile(dest, b, 0600); e != nil {
		return Voice{}, e
	}
	if e = w.Store.Update(func(s *State) { s.Voices = append(s.Voices, v) }, true); e != nil {
		_ = os.Remove(dest)
		return Voice{}, e
	}
	return v, nil
}
func (w *Workbench) generate(d Draft) error { return w.generateAudio(d, "") }

func (w *Workbench) generateAudio(d Draft, previewID string) error {
	if e := Validate(d); e != nil {
		return e
	}
	s := w.Store.Read()
	i := slices.IndexFunc(s.Models, func(m InstalledModel) bool { return m.ID == d.ModelID })
	if i < 0 {
		return Err(MsgErrModelRequired, nil)
	}
	voice := ""
	var e error
	if d.RequiresVoice() {
		voice, e = w.MediaFile("voices", value(d.VoiceID))
		if e != nil {
			return Err(MsgErrVoiceRequired, nil)
		}
	}
	emotion := ""
	if d.EmotionVoiceID != nil {
		emotion, _ = w.MediaFile("voices", *d.EmotionVoiceID)
	}
	if _, e = BuildRequest(d, voice, emotion); e != nil {
		return e
	}
	if s.RuntimePath == nil || value(s.RuntimeBackend) != s.Preferences.Backend {
		return Err(MsgErrRuntimeRequired, nil)
	}
	if previewID == "" {
		if e = w.SaveDraft(d); e != nil {
			return e
		}
	}
	return w.begin("generate", MsgActivityGenerate, nil, nil, func(ctx context.Context) error {
		id := newID()
		file := id + ".wav"
		if previewID != "" {
			id = previewID
			file = "audition-" + id + ".wav"
		}
		path, e := w.Store.MediaPath("outputs", file)
		if e != nil {
			return e
		}
		keep := false
		defer func() {
			if !keep {
				_ = os.Remove(path)
			}
		}()
		if e = w.engine.Generate(ctx, *s.RuntimePath, s.Models[i], s.Preferences.Backend, d, voice, emotion, path, func(code MessageCode, params MessageParams) { w.progress(code, params, 0, 0) }); e != nil {
			return e
		}
		duration, e := Duration(path)
		if e != nil {
			return e
		}
		if e = ctx.Err(); e != nil {
			return e
		}
		if previewID != "" {
			e = w.Store.Update(func(s *State) {
				s.Previews = append(s.Previews, CharacterPreview{ID: id, FileName: file, Duration: duration, Settings: d.SynthesisSettings, Text: d.Text})
			}, true)
			keep = e == nil
			return e
		}
		g := Generation{id, d.Title, file, time.Now().UTC(), duration, d}
		if e = w.Store.Update(func(s *State) { s.History = append([]Generation{g}, s.History...) }, true); e != nil {
			_ = os.Remove(path)
			return e
		}
		keep = true
		return nil
	}, previewID)
}
func (w *Workbench) Call(method string, data json.RawMessage) (any, error) {
	var p struct {
		ID     string `json:"id"`
		Kind   string `json:"kind"`
		Name   string `json:"name"`
		Path   string `json:"path"`
		Base64 string `json:"base64"`
	}
	if len(data) == 0 || string(data) == "null" {
		return nil, Err(MsgErrRequestInvalid, nil)
	}
	if e := json.Unmarshal(data, &p); e != nil {
		return nil, e
	}
	var err error
	switch method {
	case "character.save", "character.delete", "character.preview", "character.discardPreview", "voice.fromGeneration", "voice.update":
		return w.libraryCall(method, data)
	case "state.get":
		return map[string]any{"state": w.Store.Read(), "catalog": Catalog, "desktop": true}, nil
	case "media.path":
		return w.MediaFile(p.Kind, p.ID)
	case "media.rename":
		err = w.rename(p.Kind, p.ID, p.Name)
	case "media.delete":
		err = w.deleteMedia(p.Kind, p.ID)
	case "draft.delete":
		if !validID(p.ID) {
			return nil, Err(MsgErrDraftIDInvalid, nil)
		}
		err = w.Store.Update(func(s *State) { s.Drafts = slices.DeleteFunc(s.Drafts, func(d Draft) bool { return d.ID == p.ID }) }, true)
	case "draft.save", "generation.start":
		d := DefaultDraft()
		if e := json.Unmarshal(data, &d); e != nil {
			return nil, e
		}
		if method == "draft.save" {
			err = w.SaveDraft(d)
		} else {
			err = w.generate(d)
		}
	case "preferences.save":
		preferences := Preferences{DownloadSource: "modelscope", Backend: "cpu", UiLocale: UiLocaleZhCN}
		if e := json.Unmarshal(data, &preferences); e != nil {
			return nil, e
		}
		err = w.preferences(preferences)
	case "voice.import":
		return w.ImportVoice(context.Background(), p.Path, "")
	case "voice.record":
		b, e := base64.StdEncoding.DecodeString(p.Base64)
		if e != nil {
			return nil, e
		}
		if len(b) > 20<<20 {
			return nil, Err(MsgErrAudioTooLarge, nil)
		}
		path := filepath.Join(w.Store.Root, "downloads", newID()+".wav")
		defer os.Remove(path)
		if e = os.WriteFile(path, b, 0600); e != nil {
			return nil, e
		}
		return w.ImportVoice(context.Background(), path, p.Name)
	case "model.import":
		err = w.importModel(p.Path)
	case "model.directory":
		s := w.Store.Read()
		s.Preferences.ModelDirectory = ptr(p.Path)
		err = w.preferences(s.Preferences)
	case "model.download":
		err = w.download(p.ID)
	case "model.forget":
		w.mu.Lock()
		defer w.mu.Unlock()
		activity := w.Store.Read().Activity
		// 下载其他模型不占用推理引擎，也不会改写当前模型的登记。
		if w.cancel != nil && (activity == nil || activity.Kind != "download" || activity.ModelID == nil || *activity.ModelID == p.ID) {
			return nil, Err(MsgErrModelForgetBlocked, nil)
		}
		w.engine.Stop()
		err = w.Store.Update(func(s *State) {
			s.Models = slices.DeleteFunc(s.Models, func(m InstalledModel) bool { return m.ID == p.ID })
		}, true)
	case "runtime.install":
		err = w.install()
	case "operation.cancel":
		w.Cancel()
	default:
		return nil, Err(MsgErrMethodUnsupported, nil)
	}
	return true, err
}
