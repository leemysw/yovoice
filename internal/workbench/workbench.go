package workbench

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
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
	return &Workbench{Store: s, engine: NewEngine(root), client: &http.Client{}}, nil
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
		return fmt.Errorf("内置 CPU 内核不是有效文件。")
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
	if !validID(d.ID) || textLen(d.Text) > 12000 || textLen(d.Title) > 120 || textLen(d.EmotionText) > 500 {
		return fmt.Errorf("作品内容超出限制。")
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
		return "", fmt.Errorf("音频编号无效。")
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
		for _, v := range s.History {
			if v.ID == id {
				file = v.FileName
			}
		}
	default:
		return "", fmt.Errorf("音频类型无效。")
	}
	if file == "" {
		return "", fmt.Errorf("没有找到音频。")
	}
	return w.Store.MediaPath(kind, file)
}
func (w *Workbench) rename(kind, id, name string) error {
	if _, e := w.MediaFile(kind, id); e != nil {
		return e
	}
	name = strings.TrimSpace(name)
	if textLen(name) < 1 || textLen(name) > 120 || strings.ContainsFunc(name, unicode.IsControl) {
		return fmt.Errorf("名称需为 1–120 个字符。")
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
	path, e := w.MediaFile(kind, id)
	if e != nil {
		return e
	}
	s := w.Store.Read()
	if kind == "voices" && s.Activity != nil && s.Activity.Kind == "generate" && s.Activity.Status == "running" {
		return fmt.Errorf("请等待生成结束后再删除声音。")
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
				return fmt.Errorf("%w；音频恢复失败：%v", e, restore)
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
	if _, e := runtimeArchives(p.Backend); e != nil {
		return e
	}
	if _, e := Catalog[0].URL(p.DownloadSource); e != nil {
		return e
	}
	if p.ModelDirectory != nil && !filepath.IsAbs(*p.ModelDirectory) {
		return fmt.Errorf("模型目录必须是绝对路径。")
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
func (w *Workbench) begin(kind, label string, modelID *string, action func(context.Context) error) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed || w.cancel != nil {
		return fmt.Errorf("请等待当前操作结束，或先取消。")
	}
	ctx, cancel := context.WithCancel(context.Background())
	if e := w.Store.Update(func(s *State) {
		s.Activity = &Activity{Kind: kind, Label: label, Status: "running", ModelID: modelID, StartedAt: time.Now().UTC()}
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
				a.Label = "已完成"
				a.Status = "completed"
			} else if errors.Is(err, context.Canceled) {
				a.Status = "cancelled"
				a.Label = "已取消，可重新开始"
				if kind == "download" {
					a.Label = "已暂停"
				}
			} else {
				a.Status = "failed"
				a.Label = "操作未完成"
				a.Error = ptr(err.Error())
			}
		}
		if err != nil && !errors.Is(err, context.Canceled) {
			_ = os.WriteFile(filepath.Join(w.Store.Root, "logs", "last-error.txt"), []byte(err.Error()), 0600)
		}
		if e := w.Store.Update(update, true); e != nil {
			_ = w.Store.Update(func(s *State) {
				update(s)
				s.Activity.Status = "failed"
				s.Activity.Error = ptr("状态保存失败：" + e.Error())
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

func (w *Workbench) progress(label string, received, total int64) {
	_ = w.Store.Update(func(s *State) {
		if s.Activity != nil {
			s.Activity.Label = label
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
	return w.begin("download", "下载 "+m.Name, ptr(id), func(ctx context.Context) error {
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
			return fmt.Errorf("模型目录磁盘空间不足。")
		}
		if e = Download(ctx, w.client, url, dest, m.SHA256, m.Size, func(r, t int64) {
			label := "下载 " + m.Name
			if r == t {
				label = "正在校验模型"
			}
			w.progress(label, r, t)
		}); e != nil {
			return e
		}
		return w.register(id, dest, true)
	})
}
func (w *Workbench) importModel(path string) error {
	return w.begin("import", "正在识别并校验模型", nil, func(ctx context.Context) error {
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
			return fmt.Errorf("没有识别到兼容的 IndexTTS GGUF。当前支持 audio.cpp 发布的 2.0 / 2.5 Q8 和 F16 包。")
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
	return w.begin("runtime", "准备 audio.cpp 运行时", nil, func(ctx context.Context) (err error) {
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
			if err = Download(ctx, w.client, "https://github.com/0xShug0/audio.cpp/releases/download/"+EngineVersion+"/"+a.Name, file, a.Hash, 0, func(r, t int64) { w.progress("下载推理运行库", r, t) }); err != nil {
				return err
			}
			w.progress("正在解压运行库", 0, 0)
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
			return fmt.Errorf("运行库未包含唯一的推理服务。")
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
	info, e := os.Stat(path)
	if e != nil {
		return Voice{}, e
	}
	if !info.Mode().IsRegular() || info.Size() > 20<<20 {
		return Voice{}, fmt.Errorf("参考音频需小于 20 MB。")
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
		return Voice{}, fmt.Errorf("请选择 1–60 秒的参考音频。")
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
	v := Voice{id, name, id + ".wav", duration}
	dest, e := w.Store.MediaPath("voices", v.FileName)
	if e != nil {
		return Voice{}, e
	}
	b, e := os.ReadFile(path)
	if e != nil {
		return Voice{}, e
	}
	if len(b) > 20<<20 {
		return Voice{}, fmt.Errorf("参考音频需小于 20 MB。")
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
func (w *Workbench) generate(d Draft) error {
	if e := Validate(d); e != nil {
		return e
	}
	s := w.Store.Read()
	i := slices.IndexFunc(s.Models, func(m InstalledModel) bool { return m.ID == d.ModelID })
	if i < 0 {
		return fmt.Errorf("请先在设置中下载或导入模型。")
	}
	voice, e := w.MediaFile("voices", value(d.VoiceID))
	if e != nil {
		return fmt.Errorf("请先添加音色参考音频。")
	}
	emotion := ""
	if d.EmotionVoiceID != nil {
		emotion, _ = w.MediaFile("voices", *d.EmotionVoiceID)
	}
	if _, e = BuildRequest(d, voice, emotion); e != nil {
		return e
	}
	if s.RuntimePath == nil || value(s.RuntimeBackend) != s.Preferences.Backend {
		return fmt.Errorf("请先安装当前设备对应的推理运行时。")
	}
	if e = w.SaveDraft(d); e != nil {
		return e
	}
	return w.begin("generate", "准备生成", nil, func(ctx context.Context) error {
		id := newID()
		file := id + ".wav"
		path, e := w.Store.MediaPath("outputs", file)
		if e != nil {
			return e
		}
		if e = w.engine.Generate(ctx, *s.RuntimePath, s.Models[i], s.Preferences.Backend, d, voice, emotion, path, func(label string) { w.progress(label, 0, 0) }); e != nil {
			return e
		}
		duration, e := Duration(path)
		if e != nil {
			return e
		}
		g := Generation{id, d.Title, file, time.Now().UTC(), duration, d}
		if e = w.Store.Update(func(s *State) { s.History = append([]Generation{g}, s.History...) }, true); e != nil {
			_ = os.Remove(path)
			return e
		}
		return nil
	})
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
		return nil, fmt.Errorf("请求参数无效。")
	}
	if e := json.Unmarshal(data, &p); e != nil {
		return nil, e
	}
	var err error
	switch method {
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
			return nil, fmt.Errorf("作品编号无效。")
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
		preferences := Preferences{DownloadSource: "modelscope", Backend: "cpu"}
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
			return nil, fmt.Errorf("参考音频需小于 20 MB。")
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
		if w.cancel != nil {
			return nil, fmt.Errorf("请先结束当前操作。")
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
		return nil, fmt.Errorf("不支持的操作。")
	}
	return true, err
}
