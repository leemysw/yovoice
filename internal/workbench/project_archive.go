package workbench

import (
	"archive/zip"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
	"yovoice/internal/audio"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
	"yovoice/internal/store"
)

const projectArchiveLimit = 500 << 20

type projectArchive struct {
	Version    int                 `json:"version"`
	Draft      schema.Draft        `json:"draft"`
	History    []schema.Generation `json:"history"`
	Voices     []schema.Voice      `json:"voices"`
	Characters []schema.Character  `json:"characters"`
}

// projectMedia 只枚举工程实际引用的文件，归档中不包含模型、密钥和全局设置。
func (p *projectArchive) projectMedia() []string {
	files := []string{}
	for _, g := range p.History {
		files = append(files, "outputs/"+g.FileName)
	}
	for _, v := range p.Voices {
		files = append(files, "voices/"+v.FileName)
	}
	for _, c := range p.Characters {
		if c.Preview != nil {
			files = append(files, "outputs/"+c.Preview.FileName)
		}
	}
	if p.Draft.Timeline != nil {
		for _, a := range p.Draft.Timeline.Assets {
			files = append(files, "outputs/"+a.FileName)
		}
	}
	slices.Sort(files)
	return slices.Compact(files)
}

func (w *Workbench) ExportProject(id, path string) error {
	state := w.Store.Read()
	index := slices.IndexFunc(state.Drafts, func(d schema.Draft) bool { return d.ID == id })
	if index < 0 || !strings.EqualFold(filepath.Ext(path), ".yovoice") {
		return msg.Err(msg.ErrDraftIDInvalid, nil)
	}
	pack := projectArchive{Version: 1, Draft: state.Drafts[index]}
	generations, characters, voices := map[string]bool{}, map[string]bool{}, map[string]bool{}
	if pack.Draft.Timeline != nil {
		for _, t := range pack.Draft.Timeline.Tracks {
			for _, c := range t.Clips {
				generations[c.GenerationID] = true
			}
		}
	}
	collect := func(d schema.Draft) {
		settings := d.AllSettings()
		characters[d.CharacterID] = true
		if d.Subtitles != nil {
			for _, s := range d.Subtitles.Speakers {
				characters[s.CharacterID] = true
			}
		}
		for _, s := range settings {
			voices[value(s.VoiceID)] = true
			voices[value(s.EmotionVoiceID)] = true
		}
	}
	collect(pack.Draft)
	for _, g := range state.History {
		if g.Settings.ID == id || generations[g.ID] {
			g.Settings.Timeline = nil
			pack.History = append(pack.History, g)
			collect(g.Settings)
		}
	}
	for _, c := range state.Characters {
		if characters[c.ID] {
			pack.Characters = append(pack.Characters, c)
			for _, p := range c.Performances {
				voices[value(p.Settings.VoiceID)] = true
				voices[value(p.Settings.EmotionVoiceID)] = true
			}
			voices[value(c.Settings.VoiceID)] = true
			voices[value(c.Settings.EmotionVoiceID)] = true
			if c.Preview != nil {
				voices[value(c.Preview.Settings.VoiceID)] = true
				voices[value(c.Preview.Settings.EmotionVoiceID)] = true
			}
		}
	}
	for _, v := range state.Voices {
		if voices[v.ID] {
			pack.Voices = append(pack.Voices, v)
			delete(voices, v.ID)
		}
	}
	delete(voices, "")
	if len(voices) != 0 {
		return msg.Err(msg.ErrVoiceRequired, nil)
	}
	manifest, err := json.Marshal(pack)
	if err != nil {
		return err
	}
	temp, err := os.CreateTemp(filepath.Dir(path), ".yovoice-*")
	if err != nil {
		return err
	}
	defer os.Remove(temp.Name())
	defer temp.Close()
	writer := zip.NewWriter(temp)
	entry, err := writer.Create("project.json")
	if err != nil {
		return err
	}
	if _, err = entry.Write(manifest); err != nil {
		return err
	}
	total := int64(len(manifest))
	for _, name := range pack.projectMedia() {
		kind, file, _ := strings.Cut(name, "/")
		source, e := w.Store.MediaPath(kind, file)
		if e != nil {
			return e
		}
		input, e := os.Open(source)
		if e != nil {
			return e
		}
		info, e := input.Stat()
		if e != nil {
			input.Close()
			return e
		}
		total += info.Size()
		if total > projectArchiveLimit {
			input.Close()
			return msg.Err(msg.ErrProjectPackageLimit, nil)
		}
		entry, e = writer.Create(name)
		if e == nil {
			_, e = io.Copy(entry, input)
		}
		input.Close()
		if e != nil {
			return e
		}
	}
	if err = writer.Close(); err != nil {
		return err
	}
	if err = temp.Sync(); err != nil {
		return err
	}
	if err = temp.Close(); err != nil {
		return err
	}
	return os.Rename(temp.Name(), path)
}

// ImportProject 使用新身份导入副本；校验完成前不覆盖现有作品或素材。
func (w *Workbench) ImportProject(path string) (schema.Draft, error) {
	bad := msg.Err(msg.ErrProjectPackage, nil)
	reader, err := zip.OpenReader(path)
	if err != nil {
		return schema.Draft{}, bad
	}
	defer reader.Close()
	entries := map[string]*zip.File{}
	var total uint64
	for _, f := range reader.File {
		if entries[f.Name] != nil || f.FileInfo().IsDir() || f.Mode()&os.ModeSymlink != 0 {
			return schema.Draft{}, bad
		}
		if f.UncompressedSize64 > projectArchiveLimit-total {
			return schema.Draft{}, bad
		}
		total += f.UncompressedSize64
		if total > projectArchiveLimit || len(entries) >= 10000 {
			return schema.Draft{}, bad
		}
		entries[f.Name] = f
	}
	manifest := entries["project.json"]
	if manifest == nil || manifest.UncompressedSize64 > 20<<20 {
		return schema.Draft{}, bad
	}
	stream, err := manifest.Open()
	if err != nil {
		return schema.Draft{}, bad
	}
	var pack projectArchive
	err = json.NewDecoder(io.LimitReader(stream, 20<<20)).Decode(&pack)
	stream.Close()
	if err != nil || pack.Version != 1 || len(pack.History) > 5000 || len(pack.Voices) > 2000 || len(pack.Characters) > 1000 {
		return schema.Draft{}, bad
	}
	files := pack.projectMedia()
	if len(files)+1 != len(entries) {
		return schema.Draft{}, bad
	}
	stage, err := os.MkdirTemp(w.Store.Root, ".project-*")
	if err != nil {
		return schema.Draft{}, err
	}
	defer os.RemoveAll(stage)
	for _, kind := range []string{"outputs", "voices"} {
		if err = os.Mkdir(filepath.Join(stage, kind), 0700); err != nil {
			return schema.Draft{}, err
		}
	}
	names := map[string]string{}
	for _, name := range files {
		kind, file, _ := strings.Cut(name, "/")
		if _, err = w.Store.MediaPath(kind, file); err != nil || entries[name] == nil {
			return schema.Draft{}, bad
		}
		stream, err := entries[name].Open()
		if err != nil {
			return schema.Draft{}, bad
		}
		destination := filepath.Join(stage, kind, file)
		out, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			stream.Close()
			return schema.Draft{}, bad
		}
		_, err = io.Copy(out, io.LimitReader(stream, projectArchiveLimit+1))
		stream.Close()
		closeErr := out.Close()
		if err != nil || closeErr != nil {
			return schema.Draft{}, bad
		}
		if _, err = audio.Duration(destination); err != nil {
			return schema.Draft{}, bad
		}
		names[name] = schema.NewID() + ".wav"
	}
	tempWorkbench := &Workbench{Store: &store.Store{Root: stage}}
	if err = tempWorkbench.validateTimelineAssets(pack.Draft.Timeline); err != nil {
		return schema.Draft{}, bad
	}
	if err = schema.ValidateTimeline(pack.Draft.Timeline, pack.History); err != nil {
		return schema.Draft{}, bad
	}
	if _, err = pack.Draft.SubtitleDrafts(); err != nil {
		return schema.Draft{}, bad
	}
	if !schema.ValidID(pack.Draft.ID) || schema.TextLen(pack.Draft.Title) > 120 || schema.TextLen(pack.Draft.Text) > 12000 || schema.TextLen(pack.Draft.EmotionText) > 500 || schema.TextLen(pack.Draft.VoiceDescription) > 500 || schema.TextLen(pack.Draft.ReferenceText) > 2000 || !slices.Contains([]string{"", "text", "story", "subtitle"}, pack.Draft.Kind) {
		return schema.Draft{}, bad
	}
	ids, voiceIDs := map[string]string{}, map[string]bool{}
	register := func(id string) bool {
		if !schema.ValidID(id) || ids[id] != "" {
			return false
		}
		ids[id] = schema.NewID()
		return true
	}
	for _, v := range pack.Voices {
		if !register(v.ID) || schema.TextLen(v.Name) > 120 || schema.TextLen(v.ReferenceText) > 2000 || !schema.InRange(v.Duration, 1, 60) {
			return schema.Draft{}, bad
		}
		voiceIDs[v.ID] = true
		actual, _ := audio.Duration(filepath.Join(stage, "voices", v.FileName))
		if actual < 1 || actual > 60 {
			return schema.Draft{}, bad
		}
	}
	for _, c := range pack.Characters {
		if !register(c.ID) || schema.TextLen(c.Name) > 120 || schema.TextLen(c.DemoText) > 2000 {
			return schema.Draft{}, bad
		}
		if c.Preview != nil && !register(c.Preview.ID) {
			return schema.Draft{}, bad
		}
	}
	for _, g := range pack.History {
		if !register(g.ID) || !schema.InRange(g.Duration, .01, 3600) {
			return schema.Draft{}, bad
		}
		actual, _ := audio.Duration(filepath.Join(stage, "outputs", g.FileName))
		if actual+.001 < g.Duration {
			return schema.Draft{}, bad
		}
	}
	if pack.Draft.Timeline != nil {
		for _, a := range pack.Draft.Timeline.Assets {
			if !register(a.ID) {
				return schema.Draft{}, bad
			}
			names["outputs/"+a.FileName] = "import-" + ids[a.ID] + ".wav"
		}
	}
	pack.Draft.ID = schema.NewID()
	remapSettings := func(s *schema.SynthesisSettings) error {
		for _, ref := range []**string{&s.VoiceID, &s.EmotionVoiceID} {
			if *ref != nil && **ref != "" {
				if !voiceIDs[**ref] {
					return bad
				}
				*ref = ptr(ids[**ref])
			}
		}
		return nil
	}
	remapDraft := func(d *schema.Draft) error {
		if err := remapSettings(&d.SynthesisSettings); err != nil {
			return err
		}
		if d.Performance != nil {
			if err := remapSettings(&d.Performance.Settings); err != nil {
				return err
			}
		}
		d.CharacterID = ids[d.CharacterID]
		// 外部作品引用的源音频也归入导入副本，不能污染原作品的版本列表。
		d.ID = pack.Draft.ID
		if d.Subtitles != nil {
			for i := range d.Subtitles.Cues {
				if p := d.Subtitles.Cues[i].Performance; p != nil {
					if err := remapSettings(&p.Settings); err != nil {
						return err
					}
				}
			}
			for i := range d.Subtitles.Speakers {
				s := &d.Subtitles.Speakers[i]
				s.CharacterID = ids[s.CharacterID]
				if s.Settings != nil {
					if err := remapSettings(s.Settings); err != nil {
						return err
					}
				}
			}
		}
		return nil
	}
	if err = remapDraft(&pack.Draft); err != nil {
		return schema.Draft{}, err
	}
	for i := range pack.Voices {
		v := &pack.Voices[i]
		v.ID = ids[v.ID]
		v.FileName = names["voices/"+v.FileName]
		v.SourceGenerationID = ids[v.SourceGenerationID]
	}
	for i := range pack.Characters {
		c := &pack.Characters[i]
		c.ID = ids[c.ID]
		if len(c.Performances) > 32 {
			return schema.Draft{}, bad
		}
		for j := range c.Performances {
			if err = remapSettings(&c.Performances[j].Settings); err != nil {
				return schema.Draft{}, err
			}
		}
		if err = remapSettings(&c.Settings); err != nil {
			return schema.Draft{}, err
		}
		if c.Preview != nil {
			c.Preview.ID = ids[c.Preview.ID]
			c.Preview.FileName = names["outputs/"+c.Preview.FileName]
			if err = remapSettings(&c.Preview.Settings); err != nil {
				return schema.Draft{}, err
			}
		}
	}
	for i := range pack.History {
		g := &pack.History[i]
		g.ID = ids[g.ID]
		g.FileName = names["outputs/"+g.FileName]
		g.Settings.Timeline = nil
		if err = remapDraft(&g.Settings); err != nil {
			return schema.Draft{}, err
		}
	}
	if pack.Draft.Timeline != nil {
		timeline := pack.Draft.Timeline
		for i := range timeline.Assets {
			a := &timeline.Assets[i]
			id := ids[a.ID]
			a.ID = id
			a.FileName = "import-" + id + ".wav"
		}
		for i := range timeline.Tracks {
			for j := range timeline.Tracks[i].Clips {
				c := &timeline.Tracks[i].Clips[j]
				c.GenerationID = ids[c.GenerationID]
				c.AssetID = ids[c.AssetID]
			}
		}
		timeline.AcceptedGenerations = nil
		for _, g := range pack.History {
			if g.Segment != nil {
				timeline.AcceptedGenerations = append(timeline.AcceptedGenerations, g.ID)
			}
		}
	}
	now := time.Now()
	pack.Draft.CreatedAt = &now
	pack.Draft.UpdatedAt = &now
	written := []string{}
	committed := false
	defer func() {
		if !committed {
			for _, path := range written {
				_ = os.Remove(path)
			}
		}
	}()
	for old, name := range names {
		kind, _, _ := strings.Cut(old, "/")
		destination := filepath.Join(w.Store.Root, kind, name)
		if _, err = os.Lstat(destination); !os.IsNotExist(err) {
			return schema.Draft{}, bad
		}
		if err = os.Rename(filepath.Join(stage, filepath.FromSlash(old)), destination); err != nil {
			return schema.Draft{}, err
		}
		written = append(written, destination)
	}
	if err = schema.ValidateTimeline(pack.Draft.Timeline, pack.History); err != nil {
		return schema.Draft{}, bad
	}
	if err = w.Store.Update(func(s *schema.State) {
		s.Drafts = append([]schema.Draft{pack.Draft}, s.Drafts...)
		s.History = append(pack.History, s.History...)
		s.Voices = append(s.Voices, pack.Voices...)
		s.Characters = append(s.Characters, pack.Characters...)
	}, true); err != nil {
		return schema.Draft{}, err
	}
	committed = true
	return pack.Draft, nil
}
