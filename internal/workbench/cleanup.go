package workbench

import (
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"time"
	"yovoice/internal/catalog"
	"yovoice/internal/schema"
	"yovoice/internal/store"
)

// 运行时安装目录由 os.MkdirTemp 以“版本-后端-随机数”命名。
var runtimeDir = regexp.MustCompile(`^v\d+\.\d+\.\d+-[a-z0-9]+-\d+$`)

// 生成后转码与旧版录音导入使用 32 位十六进制 ID 命名的临时 WAV。
var temporaryWav = regexp.MustCompile(`^[0-9a-f]{32}\.wav$`)

// removeStale 回收进程中途退出时遗留的临时文件；只匹配本程序创建的命名，
// 不触碰下载缓存的运行时压缩包与正在使用的运行时。数据目录已由调用方加锁独占。
func (w *Workbench) removeStale() {
	root := w.Store.Root
	remove := func(dir string, match func(os.DirEntry) bool) {
		entries, err := os.ReadDir(dir)
		if err != nil {
			return
		}
		for _, entry := range entries {
			if match(entry) {
				_ = os.RemoveAll(filepath.Join(dir, entry.Name()))
			}
		}
	}
	remove(root, func(e os.DirEntry) bool {
		return (e.IsDir() && strings.HasPrefix(e.Name(), ".project-")) || (!e.IsDir() && strings.HasPrefix(e.Name(), ".state-"))
	})
	remove(filepath.Join(root, "downloads"), func(e os.DirEntry) bool {
		name := e.Name()
		return (e.IsDir() && strings.HasPrefix(name, "audio-")) ||
			(!e.IsDir() && (strings.HasPrefix(name, "upload-") || strings.HasPrefix(name, "api-upload-") || strings.HasPrefix(name, exportPrefix) || temporaryWav.MatchString(name)))
	})
	// Kokoro 发音库安装中途退出时遗留的临时目录。
	remove(filepath.Join(root, "runtime"), func(e os.DirEntry) bool { return e.IsDir() && strings.HasPrefix(e.Name(), "kokoro-") })
	w.removeStaleRuntimes()
}

// removeStaleRuntimes 删除当前运行时与各后端已登记内核以外的安装目录。
func (w *Workbench) removeStaleRuntimes() {
	s := w.Store.Read()
	used := []string{}
	if s.RuntimePath != nil {
		used = append(used, filepath.Clean(*s.RuntimePath))
	}
	for _, r := range s.Runtimes {
		used = append(used, filepath.Clean(r.Path))
	}
	dir := filepath.Join(w.Store.Root, "runtime")
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		path := filepath.Join(dir, entry.Name())
		if !entry.IsDir() || !runtimeDir.MatchString(entry.Name()) || slices.ContainsFunc(used, func(p string) bool { return p == path || strings.HasPrefix(p, path+string(filepath.Separator)) }) {
			continue
		}
		_ = os.RemoveAll(path)
	}
}

// deletingSuffix 标记移除模型时改名待删的文件，进程在删除前退出时由清理回收。
const deletingSuffix = ".deleting"

// stagingSuffixes 是下载与更新模型时写在目标文件旁的临时文件：续传片段及其来源记录、更新时的新文件、待删除的旧文件。
var stagingSuffixes = []string{".part", ".part.meta", ".new", ".new.part", ".new.part.meta", deletingSuffix}

// stagingFiles 返回某个模型文件旁可能存在的全部临时文件路径（不含待删除标记）。
func stagingFiles(target string) []string {
	var files []string
	for _, suffix := range stagingSuffixes {
		if suffix != deletingSuffix {
			files = append(files, target+suffix)
		}
	}
	return files
}

// stagingTarget 由临时文件名还原它所属的模型文件路径；不是临时文件时返回空串。
func stagingTarget(path string) string {
	for _, suffix := range []string{deletingSuffix, ".new.part.meta", ".new.part", ".new", ".part.meta", ".part"} {
		if target, ok := strings.CutSuffix(path, suffix); ok {
			return stagingTargetOrSelf(target)
		}
	}
	return ""
}

// stagingTargetOrSelf 继续剥掉叠加的后缀（如 weights.gguf.part.deleting），直到得到模型文件本身。
func stagingTargetOrSelf(path string) string {
	if inner := stagingTarget(path); inner != "" {
		return inner
	}
	return path
}

// liveModelPaths 返回临时文件仍有用处的模型位置：已登记的模型（更新用的 .new 稍后替换）与
// 最近一次下载的模型（暂停后可续传）。
func liveModelPaths(s schema.State, root string) []string {
	var live []string
	for _, m := range s.Models {
		if m.Path != "" {
			live = append(live, filepath.Clean(m.Path))
		}
	}
	if a := s.ModelActivity; a != nil && a.ModelID != nil {
		if m, e := catalog.Lookup(*a.ModelID); e == nil {
			live = append(live, modelDestination(s, root, m))
		}
	}
	return live
}

// removeStaleStaging 删除模型目录里不再属于任何有效模型、且超过保留期的临时文件。
// 移除模型时改名待删的文件或目录（多文件模型整个目录改名，里面的文件不带后缀）不会再被任何人使用，直接整体回收。
func removeStaleStaging(dir string, cutoff time.Time, live []string, report *CleanupReport) {
	_ = filepath.WalkDir(dir, func(path string, entry fs.DirEntry, err error) error {
		if err != nil || path == dir {
			return nil
		}
		if strings.HasSuffix(path, deletingSuffix) {
			size := int64(0)
			if entry.IsDir() {
				size = dirSize(path)
			} else if info, e := entry.Info(); e == nil {
				size = info.Size()
			}
			if os.RemoveAll(path) == nil {
				report.CleanedCount++
				report.FreedBytes += size
			}
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.IsDir() {
			return nil
		}
		target := stagingTarget(path)
		if target == "" {
			return nil
		}
		if slices.ContainsFunc(live, func(p string) bool { return store.Within(p, target) }) {
			return nil
		}
		info, err := entry.Info()
		if err != nil || !info.ModTime().Before(cutoff) {
			return nil
		}
		if os.Remove(path) == nil {
			report.CleanedCount++
			report.FreedBytes += info.Size()
		}
		return nil
	})
}

// CleanupReport 记录清理残留的结果统计。
type CleanupReport struct {
	CleanedCount int   `json:"cleanedCount"`
	FreedBytes   int64 `json:"freedBytes"`
}

// orphanHistoryGrace 是孤儿历史的保留期：接口生成不建作品，远程客户端可能稍后才下载音频。
const orphanHistoryGrace = 24 * time.Hour

// timelineGenerations 返回各作品时间线片段仍在使用的生成版本，skipDraft 对应的作品不计入。
// 已采纳记录（AcceptedGenerations）只表示版本曾被放上时间线，不算使用。
func timelineGenerations(s schema.State, skipDraft string) map[string]bool {
	ids := map[string]bool{}
	for _, d := range s.Drafts {
		if d.ID == skipDraft || d.Timeline == nil {
			continue
		}
		for _, track := range d.Timeline.Tracks {
			for _, clip := range track.Clips {
				if clip.GenerationID != "" {
					ids[clip.GenerationID] = true
				}
			}
		}
	}
	return ids
}

// orphanGenerations 返回所属作品已不存在、且没有被任何时间线使用的历史版本，顺序与 History 一致（新到旧）。
func orphanGenerations(s schema.State) []schema.Generation {
	alive := map[string]bool{}
	for _, d := range s.Drafts {
		alive[d.ID] = true
	}
	used := timelineGenerations(s, "")
	var orphans []schema.Generation
	for _, g := range s.History {
		if !alive[g.Settings.ID] && !used[g.ID] {
			orphans = append(orphans, g)
		}
	}
	return orphans
}

// deleteUnreferenced 物理删除 names 中已不被任何记录引用的 kind 目录文件，引用以 State.MediaRefs 为唯一依据。
// 调用方需持有编辑锁，并且已提交移除记录的状态修改。
func (w *Workbench) deleteUnreferenced(kind string, names []string, report *CleanupReport) {
	active := w.Store.Read().MediaRefs()[kind]
	for _, name := range names {
		if name == "" || active[name] {
			continue
		}
		path, err := w.Store.MediaPath(kind, name)
		if err != nil {
			continue
		}
		if info, err := os.Stat(path); err == nil && os.Remove(path) == nil && report != nil {
			report.CleanedCount++
			report.FreedBytes += info.Size()
		}
	}
}

// removeGenerations 删除指定历史版本，并物理删除不再被任何记录使用的音频；调用方需持有编辑锁。
func (w *Workbench) removeGenerations(ids map[string]bool, report *CleanupReport) error {
	if len(ids) == 0 {
		return nil
	}
	var files []string
	for _, g := range w.Store.Read().History {
		if ids[g.ID] && g.FileName != "" {
			files = append(files, g.FileName)
		}
	}
	if err := w.Store.Update(func(state *schema.State) {
		state.History = slices.DeleteFunc(state.History, func(g schema.Generation) bool { return ids[g.ID] })
	}, true); err != nil {
		return err
	}
	w.deleteUnreferenced("outputs", files, report)
	return nil
}

// removeStaleFiles 删除目录中未被引用且超过保留期的普通文件。
func removeStaleFiles(dir string, cutoff time.Time, keep func(name string) bool, report *CleanupReport) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || strings.HasPrefix(name, ".") || keep(name) {
			continue
		}
		info, err := entry.Info()
		if err != nil || !info.ModTime().Before(cutoff) {
			continue
		}
		if os.Remove(filepath.Join(dir, name)) == nil {
			report.CleanedCount++
			report.FreedBytes += info.Size()
		}
	}
}

// supersededTakes 返回故事作品中已采纳、但已不在任何时间线上的逐句版本；作品需在 cutoff 之前就没有再编辑。
func supersededTakes(s schema.State, cutoff time.Time) []schema.Generation {
	used := timelineGenerations(s, "")
	idle := map[string]map[string]bool{}
	for _, d := range s.Drafts {
		if d.Timeline == nil || (d.UpdatedAt != nil && !d.UpdatedAt.Before(cutoff)) {
			continue
		}
		accepted := map[string]bool{}
		for _, id := range d.Timeline.AcceptedGenerations {
			accepted[id] = true
		}
		idle[d.ID] = accepted
	}
	var takes []schema.Generation
	for _, g := range s.History {
		if g.Segment == nil || used[g.ID] || !g.CreatedAt.Before(cutoff) {
			continue
		}
		if accepted, ok := idle[g.Settings.ID]; ok && accepted[g.ID] {
			takes = append(takes, g)
		}
	}
	return takes
}

// CleanupResiduals 回收超过 24 小时的孤儿历史版本与未引用的磁盘文件。
func (w *Workbench) CleanupResiduals() (CleanupReport, error) {
	w.edit.Lock()
	defer w.edit.Unlock()

	var report CleanupReport
	cutoff := time.Now().Add(-orphanHistoryGrace)

	// 1. 孤儿历史：所属作品已删除且没有时间线使用；接口刚生成的结果保留 24 小时供客户端下载。
	stale := map[string]bool{}
	for _, g := range orphanGenerations(w.Store.Read()) {
		if g.CreatedAt.Before(cutoff) {
			stale[g.ID] = true
		}
	}
	// 2. 故事作品中已被替换的旧句子版本：已放上时间线（已采纳）但现在没有任何片段使用。
	// 历史列表不展示逐句版本，用户无法手动删除；只处理 24 小时内未编辑的作品，避免撤销操作找不回刚替换的版本。
	for _, g := range supersededTakes(w.Store.Read(), cutoff) {
		stale[g.ID] = true
	}
	if err := w.removeGenerations(stale, &report); err != nil {
		return report, err
	}
	if len(stale) > 0 {
		if err := w.Store.Update(func(state *schema.State) {
			for i := range state.Drafts {
				if t := state.Drafts[i].Timeline; t != nil {
					t.AcceptedGenerations = slices.DeleteFunc(t.AcceptedGenerations, func(id string) bool { return stale[id] })
				}
			}
		}, true); err != nil {
			return report, err
		}
	}

	// 3. 未被引用的磁盘文件：只清理超过 24 小时的，避免误删正在写入的结果。
	refs := w.Store.Read().MediaRefs()
	for _, kind := range []string{"outputs", "voices"} {
		removeStaleFiles(filepath.Join(w.Store.Root, kind), cutoff, func(name string) bool { return refs[kind][name] }, &report)
	}

	// 4. downloads/ 只存放临时文件与内核安装包缓存，超过 24 小时的全部回收（内核已解压到 runtime/）。
	//    续传片段只在没有后台操作时、持 mu 删除：此刻不可能有下载正要接着写它。
	downloads := filepath.Join(w.Store.Root, "downloads")
	removeStaleFiles(downloads, cutoff, func(name string) bool { return stagingTarget(name) != "" }, &report)
	w.mu.Lock()
	if w.cancel == nil && w.installCancel == nil {
		removeStaleFiles(downloads, cutoff, func(name string) bool { return stagingTarget(name) == "" }, &report)
	}
	// 5. 模型目录里下载或更新中途留下的临时文件：仍属于已登记模型或最近一次下载的保留，其余超过 24 小时的回收。
	//    有模型下载在进行时整体跳过，不与它写入的文件赛跑。
	if w.installCancel == nil {
		s := w.Store.Read()
		live := liveModelPaths(s, w.Store.Root)
		dirs := []string{filepath.Join(w.Store.Root, "models")}
		if dir := modelDirectory(s, w.Store.Root); !store.SamePath(dir, dirs[0]) {
			dirs = append(dirs, dir)
		}
		for _, dir := range dirs {
			removeStaleStaging(dir, cutoff, live, &report)
		}
	}
	w.mu.Unlock()

	return report, nil
}
