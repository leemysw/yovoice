package workbench

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"slices"
	"time"
	"yovoice/internal/audio"
	"yovoice/internal/catalog"
	"yovoice/internal/diag"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
	"yovoice/internal/score"
)

// 旋律谱（YuE2 的 ABC 方言）：先出谱或从歌曲扒谱，改谱后按谱生成整首歌。
// 出谱与扒谱占用推理引擎，结果放在会话状态 Melody 里，由界面填入作品；谱面校验与比较在 score 包。

// coverSeconds 是扒谱接受的最长歌曲时长，与 YuE2 谱面上限一致。
const coverSeconds = int(schema.ScoreMaxSeconds)

// MelodyInspection 是界面显示旋律谱所需的信息：谱面问题、概要和转换后的轨道。
type MelodyInspection struct {
	Issue   *score.ABCIssue `json:"issue,omitempty"`
	Tempo   int             `json:"tempo,omitempty"`
	Meter   [2]int          `json:"meter,omitempty"`
	Key     string          `json:"key,omitempty"`
	Bars    int             `json:"bars,omitempty"`
	Seconds float64         `json:"seconds,omitempty"`
	Chords  bool            `json:"chords,omitempty"`
	Score   *schema.Score   `json:"score,omitempty"`
}

// InspectMelody 校验并概括旋律谱；谱面有误时只返回问题。
func InspectMelody(text string) MelodyInspection {
	s, e := score.ParseABC(text)
	if e != nil {
		var issue *score.ABCIssue
		if !errors.As(e, &issue) {
			issue = &score.ABCIssue{Code: "token", Detail: e.Error()}
		}
		return MelodyInspection{Issue: issue}
	}
	converted := s.Score()
	return MelodyInspection{Tempo: s.Tempo, Meter: s.Meter, Key: converted.Key, Bars: s.Bars(), Seconds: s.Seconds(), Chords: s.HasChords(), Score: &converted}
}

// TransformMelody 是不需要模型的快捷改谱：stripChords 去掉和弦，tempo 改速度，instrumental 把人声旋律移到器乐声部。
func TransformMelody(text, op string, tempo int) (string, error) {
	var out string
	var e error
	switch op {
	case "stripChords":
		out, e = score.StripABCChords(text)
	case "tempo":
		out, e = score.SetABCTempo(text, tempo)
	case "instrumental":
		out, _, e = score.InstrumentalABC(text)
	default:
		return "", msg.Err(msg.ErrRequestInvalid, nil)
	}
	if e != nil {
		return "", melodyIssue(e)
	}
	return out, nil
}

func melodyIssue(e error) error {
	var issue *score.ABCIssue
	if errors.As(e, &issue) {
		return msg.Err(msg.ErrMelodyInvalid, msg.Params{"bar": issue.Bar, "voice": issue.Voice, "code": issue.Code, "detail": issue.Detail})
	}
	return e
}

// PlanMelody 让 YuE2 按风格与歌词写出旋律谱（只跑规划阶段），结果写入会话状态。
func (w *Workbench) PlanMelody(d schema.Draft) error {
	w.edit.Lock()
	defer w.edit.Unlock()
	d.Abc = ""
	if e := schema.Validate(d); e != nil {
		return e
	}
	m, e := catalog.Lookup(d.ModelID)
	if e != nil || m.Family != "yue2" {
		return msg.Err(msg.ErrModelUnsupported, nil)
	}
	s := w.Store.Read()
	model, e := w.engineModel(s, d.ModelID)
	if e != nil {
		return e
	}
	if e = w.saveDraftKeepingMelody(d); e != nil {
		return e
	}
	_, e = w.start("generate", msg.ActivityPlanMelody, nil, &d.ModelID, func(ctx context.Context) error {
		abc, truncated, e := w.engine.PlanMelody(ctx, *s.RuntimePath, model, s.Preferences.Backend, performanceFirst(s), d, func(code msg.Code, params msg.Params) { w.progress(code, params, 0, 1) })
		if e != nil {
			return e
		}
		diag.Log(w.Store.Root, "melody.planned", "project_id", d.ID, "bytes", len(abc), "truncated", truncated)
		return w.offerMelody(d.ID, "plan", abc, truncated)
	}, "", d.ID)
	if e == nil {
		w.tagActivity("melody")
	}
	return e
}

// CoverMelody 用 SheetSage2 从上传的歌曲扒出旋律谱，用于翻唱。扒出的和弦默认去掉，
// 按谱生成时改用 melody 模式，让新风格自由编配伴奏（YuE2 官方翻唱流程）。
func (w *Workbench) CoverMelody(projectID string, r io.Reader) error {
	if !schema.ValidID(projectID) {
		return msg.Err(msg.ErrDraftIDInvalid, nil)
	}
	upload, e := w.receive(r)
	if e != nil {
		return e
	}
	w.edit.Lock()
	defer w.edit.Unlock()
	s := w.Store.Read()
	i := slices.IndexFunc(s.Models, func(m schema.InstalledModel) bool {
		p, e := catalog.Lookup(m.ID)
		return e == nil && p.Family == "sheetsage2"
	})
	if i < 0 {
		_ = os.Remove(upload)
		return msg.Err(msg.ErrCoverModelRequired, nil)
	}
	model, e := w.engineModel(s, s.Models[i].ID)
	if e != nil {
		_ = os.Remove(upload)
		return e
	}
	converter, e := audio.Converter()
	if e != nil {
		_ = os.Remove(upload)
		return e
	}
	_, e = w.start("generate", msg.ActivityTranscribe, nil, &model.ID, func(ctx context.Context) error {
		defer os.Remove(upload)
		wav := upload + ".wav"
		defer os.Remove(wav)
		if e := audio.ConvertWithLimit(ctx, converter, upload, wav, coverSeconds); e != nil {
			return e
		}
		if seconds, e := audio.Duration(wav); e != nil {
			return e
		} else if seconds > float64(coverSeconds) {
			return msg.Err(msg.ErrAudioDuration, nil)
		}
		abc, e := w.engine.Transcribe(ctx, *s.RuntimePath, model, s.Preferences.Backend, wav, func(code msg.Code, params msg.Params) { w.progress(code, params, 0, 1) })
		if e != nil {
			return e
		}
		if stripped, e := score.StripABCChords(abc); e == nil {
			abc = stripped
		}
		diag.Log(w.Store.Root, "melody.transcribed", "project_id", projectID, "bytes", len(abc))
		return w.offerMelody(projectID, "cover", abc, false)
	}, "", projectID)
	if e == nil {
		w.tagActivity("melody")
	} else {
		_ = os.Remove(upload)
	}
	return e
}

// engineModel 检查推理引擎与模型可用，返回已安装的模型。要求调用方持有编辑锁。
func (w *Workbench) engineModel(s schema.State, id string) (schema.InstalledModel, error) {
	if !RuntimeReady(s) {
		return schema.InstalledModel{}, msg.Err(msg.ErrRuntimeRequired, nil)
	}
	i := slices.IndexFunc(s.Models, func(m schema.InstalledModel) bool { return m.ID == id })
	if i < 0 {
		return schema.InstalledModel{}, msg.Err(msg.ErrModelRequired, nil)
	}
	if e := modelEngineReady(s, id); e != nil {
		return schema.InstalledModel{}, e
	}
	if installing(s, id) {
		return schema.InstalledModel{}, msg.Err(msg.ErrBusy, nil)
	}
	if _, e := os.Stat(s.Models[i].Path); e != nil {
		return schema.InstalledModel{}, msg.Err(msg.ErrModelMoved, nil)
	}
	return s.Models[i], nil
}

// saveDraftKeepingMelody 保存出谱前的作品，但保留已有的旋律谱，出谱结果由界面决定是否替换。
func (w *Workbench) saveDraftKeepingMelody(d schema.Draft) error {
	s := w.Store.Read()
	if i := slices.IndexFunc(s.Drafts, func(v schema.Draft) bool { return v.ID == d.ID }); i >= 0 {
		d.Abc = s.Drafts[i].Abc
	}
	return w.saveDraft(d)
}

func (w *Workbench) offerMelody(projectID, source, abc string, truncated bool) error {
	result := schema.MelodyResult{ID: schema.NewID(), ProjectID: projectID, Source: source, Abc: abc, Truncated: truncated, CreatedAt: time.Now().UTC()}
	return w.Store.Update(func(s *schema.State) { s.Melody = &result }, false)
}

// DismissMelody 在界面填入或放弃出谱结果后清除。
func (w *Workbench) DismissMelody(id string) error {
	return w.Store.Update(func(s *schema.State) {
		if s.Melody != nil && s.Melody.ID == id {
			s.Melody = nil
		}
	}, false)
}

// ListenMelody 用已安装的音色库把旋律谱渲染成试听音频，不经过推理引擎：人声旋律、器乐旋律、和弦与低音各一轨。
// 试听文件放在 outputs 下、以 audition- 开头，不进历史，只保留最近一次，下次启动时清理。
func (w *Workbench) ListenMelody(ctx context.Context, abc string) (string, error) {
	parsed, e := score.ParseABC(abc)
	if e != nil {
		return "", melodyIssue(e)
	}
	soundFont := ""
	for _, m := range w.Store.Read().Models {
		if c, e := catalog.Lookup(m.ID); e == nil && c.Family == "soundfont" {
			soundFont = m.Path
			break
		}
	}
	if soundFont == "" {
		return "", msg.Err(msg.ErrMelodySoundFontRequired, nil)
	}
	sf, e := score.LoadSoundFont(soundFont)
	if e != nil {
		return "", msg.Err(msg.ErrModelMoved, nil)
	}
	file := "audition-melody-" + schema.NewID() + ".wav"
	path, e := w.Store.MediaPath("outputs", file)
	if e != nil {
		return "", e
	}
	if e = score.Render(ctx, sf, parsed.Score(), path, "", func(int, int) {}); e != nil {
		_ = os.Remove(path)
		return "", e
	}
	old, _ := filepath.Glob(filepath.Join(filepath.Dir(path), "audition-melody-*.wav"))
	for _, f := range old {
		if filepath.Base(f) != file {
			_ = os.Remove(f)
		}
	}
	return file, nil
}
