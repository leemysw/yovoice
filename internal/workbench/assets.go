package workbench

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
)

// Asset 是资源页的一行：生成音频、故事配音片段、参考音频、时间轴素材或 AI 图片。
// Users 列出正在引用它的角色或作品，非空时不能直接删除；Bytes 为 -1 表示文件已丢失。
type Asset struct {
	Kind         string    `json:"kind"`
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	Media        string    `json:"media"`
	FileName     string    `json:"fileName"`
	ProjectID    string    `json:"projectId,omitempty"`
	ProjectTitle string    `json:"projectTitle,omitempty"`
	ProjectKind  string    `json:"projectKind,omitempty"`
	CreatedAt    time.Time `json:"createdAt"`
	Duration     float64   `json:"duration,omitempty"`
	Bytes        int64     `json:"bytes"`
	Users        []string  `json:"users,omitempty"`
}

// AssetRef 指定要删除的一项资源。
type AssetRef struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
}

// AssetResult 是批量删除中一项的结果：失败时带消息码，界面按码翻译原因。
type AssetResult struct {
	Kind   string     `json:"kind"`
	ID     string     `json:"id"`
	Error  msg.Code   `json:"error,omitempty"`
	Params msg.Params `json:"params,omitempty"`
}

const (
	AssetGeneration = "generation"
	AssetSegment    = "segment"
	AssetVoice      = "voice"
	AssetMaterial   = "material"
	AssetImage      = "image"
	imagesDir       = "images"
	// 单张图片预览的上限：超出时界面只提示在文件夹中查看。
	maxImagePreview = 16 << 20
)

var imageTypes = map[string]string{".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}

// ListAssets 汇总数据目录里所有可管理的资源，按创建时间从新到旧排列。
func (w *Workbench) ListAssets() ([]Asset, error) {
	s := w.Store.Read()
	drafts := map[string]schema.Draft{}
	for _, d := range s.Drafts {
		drafts[d.ID] = d
	}
	project := func(a *Asset, id string) {
		a.ProjectID = id
		if d, ok := drafts[id]; ok {
			a.ProjectTitle, a.ProjectKind = d.Title, projectKind(d)
		}
	}
	size := func(media, file string) (int64, time.Time) {
		path, e := w.Store.MediaPath(media, file)
		if e != nil {
			return -1, time.Time{}
		}
		info, e := os.Stat(path)
		if e != nil {
			return -1, time.Time{}
		}
		return info.Size(), info.ModTime()
	}
	// 时间轴片段引用生成音频；被引用的版本删除会被拒绝，这里提前标出引用它的作品。
	clipUsers := map[string][]string{}
	for _, d := range s.Drafts {
		if d.Timeline == nil {
			continue
		}
		for _, track := range d.Timeline.Tracks {
			for _, c := range track.Clips {
				if c.GenerationID != "" && !slices.Contains(clipUsers[c.GenerationID], d.Title) {
					clipUsers[c.GenerationID] = append(clipUsers[c.GenerationID], d.Title)
				}
			}
		}
	}
	var assets []Asset
	for _, g := range s.History {
		a := Asset{Kind: AssetGeneration, ID: g.ID, Name: g.Title, Media: "outputs", FileName: g.FileName, CreatedAt: g.CreatedAt, Duration: g.Duration, Users: clipUsers[g.ID]}
		if g.Segment != nil {
			a.Kind = AssetSegment
			if g.Segment.SpeakerName != "" {
				a.Name = g.Segment.SpeakerName + " · " + strings.TrimSpace(g.Settings.Text)
			}
		}
		project(&a, g.Settings.ID)
		a.Bytes, _ = size("outputs", g.FileName)
		assets = append(assets, a)
	}
	for _, v := range s.Voices {
		a := Asset{Kind: AssetVoice, ID: v.ID, Name: v.Name, Media: "voices", FileName: v.FileName, Duration: v.Duration, Users: s.VoiceUsers(v.ID)}
		a.Bytes, a.CreatedAt = size("voices", v.FileName)
		assets = append(assets, a)
	}
	for _, d := range s.Drafts {
		if d.Timeline == nil {
			continue
		}
		for _, m := range d.Timeline.Assets {
			a := Asset{Kind: AssetMaterial, ID: m.ID, Name: m.Name, Media: "outputs", FileName: m.FileName, Duration: m.Duration, Users: []string{d.Title}}
			project(&a, d.ID)
			a.Bytes, a.CreatedAt = size("outputs", m.FileName)
			assets = append(assets, a)
		}
	}
	images, e := w.listImages()
	if e != nil {
		return nil, e
	}
	assets = append(assets, images...)
	slices.SortStableFunc(assets, func(a, b Asset) int { return b.CreatedAt.Compare(a.CreatedAt) })
	return assets, nil
}

// projectKind 与前端 shared/workbench/drafts.ts 的同名函数一致：音乐、音效、编曲按 kind，有字幕或故事类型的是故事配音，其余是语音生成。
func projectKind(d schema.Draft) string {
	switch {
	case d.Kind == "music" || d.Kind == "sfx" || d.Kind == "score":
		return d.Kind
	case d.Subtitles != nil || d.Kind == "story" || d.Kind == "subtitle":
		return "story"
	default:
		return "text"
	}
}

// listImages 列出 AI 生成的图片：images/ 下以 ID 命名的图片文件，没有数据库记录。
func (w *Workbench) listImages() ([]Asset, error) {
	entries, e := os.ReadDir(filepath.Join(w.Store.Root, imagesDir))
	if os.IsNotExist(e) {
		return nil, nil
	}
	if e != nil {
		return nil, e
	}
	var images []Asset
	for _, entry := range entries {
		ext := strings.ToLower(filepath.Ext(entry.Name()))
		id := strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name()))
		if entry.IsDir() || imageTypes[ext] == "" || !schema.ValidID(id) {
			continue
		}
		info, e := entry.Info()
		if e != nil || !info.Mode().IsRegular() {
			continue
		}
		images = append(images, Asset{Kind: AssetImage, ID: id, Name: entry.Name(), Media: imagesDir, FileName: entry.Name(), CreatedAt: info.ModTime(), Bytes: info.Size()})
	}
	return images, nil
}

// imagePath 按 ID 找到 images/ 下的图片文件；不接受符号链接。
func (w *Workbench) imagePath(id string) (string, error) {
	if !schema.ValidID(id) {
		return "", msg.Err(msg.ErrAudioIDInvalid, nil)
	}
	for ext := range imageTypes {
		path := filepath.Join(w.Store.Root, imagesDir, id+ext)
		if info, e := os.Lstat(path); e == nil && info.Mode().IsRegular() {
			return path, nil
		}
	}
	return "", msg.Err(msg.ErrAudioMissing, nil)
}

// ImagePreview 返回图片的 data URL，供界面预览（CSP 允许 data: 图片），过大的图片拒绝。
func (w *Workbench) ImagePreview(id string) (string, error) {
	path, e := w.imagePath(id)
	if e != nil {
		return "", e
	}
	info, e := os.Stat(path)
	if e != nil {
		return "", e
	}
	if info.Size() > maxImagePreview {
		return "", msg.Err(msg.ErrRequestInvalid, nil)
	}
	b, e := os.ReadFile(path)
	if e != nil {
		return "", e
	}
	return "data:" + imageTypes[strings.ToLower(filepath.Ext(path))] + ";base64," + base64.StdEncoding.EncodeToString(b), nil
}

// DeleteAssets 逐项删除资源，单项失败（被引用、正在生成、已不存在）不影响其他项。
// 音频沿用 DeleteMedia 的引用检查与共享文件处理；时间轴素材属于作品草稿，只能在作品里移除。
func (w *Workbench) DeleteAssets(refs []AssetRef) []AssetResult {
	results := make([]AssetResult, 0, len(refs))
	for _, ref := range refs {
		var e error
		switch ref.Kind {
		case AssetGeneration, AssetSegment:
			e = w.DeleteMedia("outputs", ref.ID)
		case AssetVoice:
			e = w.DeleteMedia("voices", ref.ID)
		case AssetImage:
			e = w.deleteImage(ref.ID)
		case AssetMaterial:
			e = msg.Err(msg.ErrTimelineInUse, nil)
		default:
			e = msg.Err(msg.ErrAudioKindInvalid, nil)
		}
		result := AssetResult{Kind: ref.Kind, ID: ref.ID}
		if e != nil {
			wire := msg.Encode(e)
			result.Error, _ = wire["code"].(msg.Code)
			result.Params, _ = wire["params"].(msg.Params)
		}
		results = append(results, result)
	}
	return results
}

func (w *Workbench) deleteImage(id string) error {
	w.edit.Lock()
	defer w.edit.Unlock()
	path, e := w.imagePath(id)
	if e != nil {
		return e
	}
	return os.Remove(path)
}
