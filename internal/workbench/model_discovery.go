package workbench

import (
	"context"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"yovoice/internal/catalog"
	"yovoice/internal/download"
	"yovoice/internal/engine"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
)

type LocalModelSource struct {
	Path    string   `json:"path"`
	Models  []string `json:"models"`
	Convert bool     `json:"convert,omitempty"`
	Manual  bool     `json:"manual,omitempty"`
}

type LocalModelScan struct {
	Directory string             `json:"directory"`
	Sources   []LocalModelSource `json:"sources"`
	Limited   bool               `json:"limited,omitempty"`
}

type LocalModelMapping struct {
	ID   string `json:"id"`
	Path string `json:"path"`
}

// ScanLocalModels 只读指定目录的模型头和清单，用户确认后才登记。
func (w *Workbench) ScanLocalModels(ctx context.Context, path string) (LocalModelScan, error) {
	result := LocalModelScan{Directory: path, Sources: []LocalModelSource{}}
	if !filepath.IsAbs(path) {
		return result, msg.Err(msg.ErrModelDirAbsolute, nil)
	}
	root, err := filepath.EvalSymlinks(path)
	if err != nil {
		return result, err
	}
	info, err := os.Stat(root)
	if err != nil {
		return result, err
	}
	if !info.IsDir() {
		return result, msg.Err(msg.ErrRequestInvalid, nil)
	}
	state := w.Store.Read()
	available := func(id string) bool { return localModelSlot(state, id) == nil }
	visited := 0
	err = filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err != nil {
			if path == root {
				return err
			}
			return nil
		}
		visited++
		if visited > 5000 || len(result.Sources) >= 100 {
			result.Limited = true
			return fs.SkipAll
		}
		if entry.IsDir() {
			relative, _ := filepath.Rel(root, path)
			if path != root && ((strings.HasPrefix(entry.Name(), ".") && !modelTransferDirectory.MatchString(entry.Name())) || strings.Count(relative, string(filepath.Separator)) >= 3) {
				return fs.SkipDir
			}
			if version := indexCheckpointVersion(path); version != "" {
				var matches []string
				for _, model := range catalog.Models {
					if available(model.ID) && model.Family == "index_tts2" && indexModelVersion(model) == version && (model.Precision == "Q8" || model.Precision == "F16") {
						matches = append(matches, model.ID)
					}
				}
				if len(matches) > 0 {
					result.Sources = append(result.Sources, LocalModelSource{Path: path, Models: matches, Convert: true})
				}
			}
			return nil
		}
		if !entry.Type().IsRegular() {
			return nil
		}
		matches := localModelMatches(ctx, path, catalog.Models)
		manual := len(matches) > 1
		matches = slices.DeleteFunc(matches, func(id string) bool { return !available(id) })
		if len(matches) > 0 {
			result.Sources = append(result.Sources, LocalModelSource{Path: path, Models: matches, Manual: manual})
		}
		return nil
	})
	if err == nil {
		err = ctx.Err()
	}
	return result, err
}

func localModelMatches(ctx context.Context, path string, models []catalog.ModelPackage) []string {
	ext := strings.ToLower(filepath.Ext(path))
	if ext != ".gguf" && ext != ".sf2" {
		return nil
	}
	var metadata []string
	if ext == ".gguf" {
		if identity, err := engine.ReadGGUFIdentity(path); err == nil {
			precision := strings.ToUpper(strings.TrimSuffix(identity.WeightType, "_0"))
			for _, model := range models {
				if len(model.Files) > 0 || model.Family != identity.Family ||
					precision != "" && precision != model.Precision {
					continue
				}
				if model.Family == "index_tts2" && identity.IndexVersion != indexModelVersion(model) {
					continue
				}
				metadata = append(metadata, model.ID)
			}
		}
	}
	if len(metadata) == 1 {
		return metadata
	}
	size := download.FileSize(path)
	var digest string
	var exact []string
	for _, model := range models {
		main, legacy := model.MainFile(), catalog.LegacyModelFiles[model.ID]
		knownSize := main.Size == size || legacy.Size > 0 && legacy.Size == size
		for _, old := range model.History {
			if len(old.Files) == 0 {
				knownSize = knownSize || old.Size == size
			} else {
				for _, file := range old.Files {
					knownSize = knownSize || file.Path == model.RemotePath && file.Size == size
				}
			}
		}
		if !knownSize {
			continue
		}
		if digest == "" {
			var err error
			digest, err = download.Hash(ctx, path)
			if err != nil {
				break
			}
		}
		// 旧版单文件摘要也可能来自尚未进入 History 的目录。
		_, knownErr := model.At(digest)
		if knownErr == nil || len(model.Files) == 0 && digest == legacy.SHA256 {
			exact = append(exact, model.ID)
		}
	}
	if len(exact) > 0 {
		return exact
	}
	return metadata
}

func (w *Workbench) ImportLocalModels(mappings []LocalModelMapping) error {
	if len(mappings) == 0 || len(mappings) > 100 {
		return msg.Err(msg.ErrRequestInvalid, nil)
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	state := w.Store.Read()
	seen := make(map[string]bool)
	for _, mapping := range mappings {
		model, err := catalog.Lookup(mapping.ID)
		if err != nil {
			return err
		}
		if seen[mapping.ID] {
			return msg.Err(msg.ErrRequestInvalid, nil)
		}
		seen[mapping.ID] = true
		if err := localModelSlot(state, mapping.ID); err != nil {
			return err
		}
		if err := checkLocalModelFile(model, mapping.Path); err != nil {
			return err
		}
	}
	_, err := w.startLocked("import", msg.ActivityVerifying, nil, nil, func(ctx context.Context) error {
		var installed []schema.InstalledModel
		for _, mapping := range mappings {
			model, _ := catalog.Lookup(mapping.ID)
			result, err := w.verifyLocalModel(ctx, model, mapping.Path)
			if err != nil {
				return err
			}
			installed = append(installed, result)
		}
		w.mu.Lock()
		defer w.mu.Unlock()
		if err := ctx.Err(); err != nil {
			return err
		}
		return w.commitLocalModels(installed)
	}, func(s *schema.State) { s.Activity.Task = "local-model-import" })
	return err
}

// 调用方持有 mu；校验耗时较长，提交前须对全部型号重新检查，避免覆盖后来登记的模型或下载任务。
func (w *Workbench) commitLocalModels(models []schema.InstalledModel) error {
	state := w.Store.Read()
	for _, model := range models {
		if err := localModelSlot(state, model.ID); err != nil {
			return err
		}
	}
	return w.Store.Update(func(s *schema.State) {
		for _, model := range models {
			putInstalledModel(s, model)
		}
	}, true)
}

func localModelSlot(state schema.State, id string) error {
	if _, pending := state.ModelDownloads[id]; pending {
		return msg.Err(msg.ErrBusy, nil)
	}
	if _, installed := installedModel(state, id); installed {
		return msg.Err(msg.ErrLocalModelProtected, nil)
	}
	return nil
}

func indexCheckpointVersion(dir string) string {
	for _, name := range []string{"gpt.pth", "s2mel.pth", "config.yaml"} {
		if !existsPath(filepath.Join(dir, name)) {
			return ""
		}
	}
	if existsPath(filepath.Join(dir, "codec.pth")) && existsPath(filepath.Join(dir, "multilingual_zh_ja_yue_char_del.tiktoken")) {
		return "2.5"
	}
	if existsPath(filepath.Join(dir, "bpe.model")) {
		return "2.0"
	}
	return ""
}

func indexModelVersion(model catalog.ModelPackage) string {
	if model.Version == "2" {
		return "2.0"
	}
	return model.Version
}
