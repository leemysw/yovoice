package workbench

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"yovoice/internal/catalog"
	"yovoice/internal/diag"
	"yovoice/internal/engine"
	"yovoice/internal/msg"
	"yovoice/internal/platform"
	"yovoice/internal/schema"
	"yovoice/internal/store"
)

//go:embed converters/index_tts.py
var indexConversionScript []byte

var conversionRecordName = regexp.MustCompile(`^\.conversion-([0-9a-f]{32})\.json$`)

// 暂存放在成品所在的磁盘；在应用数据目录记录位置，重启时即使已换模型目录也能找到。
func (w *Workbench) newConversionWorkspace(target string) (string, func(), error) {
	id := schema.NewID()
	record := filepath.Join(w.Store.Root, "downloads", ".conversion-"+id+".json")
	data, err := json.Marshal(target)
	if err != nil {
		return "", nil, err
	}
	if err := platform.WriteFileAtomic(record, data, 0600); err != nil {
		return "", nil, err
	}
	temp := conversionWorkspacePath(target, id)
	if err := os.Mkdir(temp, 0700); err != nil {
		_ = os.Remove(record)
		return "", nil, err
	}
	return temp, func() { w.removeConversionWorkspace(temp, record, nil) }, nil
}

func conversionWorkspacePath(target, id string) string {
	return filepath.Join(target, ".yovoice-convert-"+id)
}

func (w *Workbench) removeConversionWorkspace(temp, record string, report *CleanupReport) {
	// 模型目录可能在暂时离线的磁盘上。保留记录，等磁盘重新挂载再清理。
	parent := filepath.Dir(temp)
	if _, err := os.Stat(parent); err != nil {
		return
	}
	var size int64
	var existed bool
	if report != nil {
		if _, err := os.Lstat(temp); err == nil {
			existed = true
			size = dirSize(temp)
		}
	}
	if err := os.RemoveAll(temp); err != nil {
		diag.Log(w.Store.Root, "model.conversion_cleanup_failed", "path", temp, "error", diag.Error(err))
		return
	}
	if existed {
		report.CleanedCount++
		report.FreedBytes += size
	}
	platform.SyncDir(parent)
	if err := os.Remove(record); err != nil && !os.IsNotExist(err) {
		diag.Log(w.Store.Root, "model.conversion_record_remove_failed", "path", record, "error", diag.Error(err))
	}
}

// 调用方须确保本数据目录没有正在运行的转换任务。
func (w *Workbench) removeStaleConversions(report *CleanupReport) {
	dir := filepath.Join(w.Store.Root, "downloads")
	entries, _ := os.ReadDir(dir)
	for _, entry := range entries {
		match := conversionRecordName.FindStringSubmatch(entry.Name())
		if match == nil || !entry.Type().IsRegular() {
			continue
		}
		record := filepath.Join(dir, entry.Name())
		data, err := os.ReadFile(record)
		var target string
		if err == nil && json.Unmarshal(data, &target) == nil && filepath.IsAbs(target) {
			w.removeConversionWorkspace(conversionWorkspacePath(target, match[1]), record, report)
		}
	}
}

type LocalModelConversion struct {
	ID        string `json:"id"`
	Path      string `json:"path"`
	Python    string `json:"python"`
	Converter string `json:"converter"`
}

func (w *Workbench) ConvertLocalModel(input LocalModelConversion) error {
	model, err := catalog.Lookup(input.ID)
	if err != nil || model.Family != "index_tts2" || (model.Precision != "Q8" && model.Precision != "F16") {
		return msg.Err(msg.ErrModelUnsupported, nil)
	}
	if !filepath.IsAbs(input.Path) || indexCheckpointVersion(input.Path) != indexModelVersion(model) {
		return msg.Err(msg.ErrLocalModelInvalid, nil)
	}
	for _, path := range []string{input.Python, input.Converter} {
		info, err := os.Stat(path)
		if !filepath.IsAbs(path) || err != nil || !info.Mode().IsRegular() {
			return msg.Err(msg.ErrModelConversion, msg.Params{"detail": path})
		}
	}
	precision := "q8_0"
	if model.Precision == "F16" {
		precision = "f16"
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	state := w.Store.Read()
	if err := localModelSlot(state, input.ID); err != nil {
		return err
	}
	target := modelDirectory(state, w.Store.Root)
	source, err := filepath.EvalSymlinks(input.Path)
	if err != nil {
		return err
	}
	target, err = filepath.EvalSymlinks(target)
	if err != nil {
		return err
	}
	if store.Within(source, target) {
		return msg.Err(msg.ErrRequestInvalid, nil)
	}
	_, err = w.startLocked("import", msg.ActivityModelConverting, nil, &model.ID, func(ctx context.Context) error {
		return w.convertIndexModel(ctx, input, source, target, precision, model)
	}, func(s *schema.State) { s.Activity.Task = "local-model-import" })
	return err
}

func (w *Workbench) convertIndexModel(ctx context.Context, input LocalModelConversion, source, target, precision string, model catalog.ModelPackage) error {
	space, err := platform.FreeSpace(target)
	if err != nil {
		return err
	}
	// 转换期间原盘同时保留 Safetensors 暂存和成品。
	if space < uint64(2*model.Size+(100<<20)) {
		return msg.Err(msg.ErrModelDirSpace, nil)
	}
	temp, cleanup, err := w.newConversionWorkspace(target)
	if err != nil {
		return err
	}
	defer cleanup()
	script := filepath.Join(temp, "index_tts.py")
	stage, output := filepath.Join(temp, "stage"), filepath.Join(temp, "model.gguf")
	if err := platform.WriteFileAtomic(script, indexConversionScript, 0600); err != nil {
		return err
	}
	if err := runLocalConverter(ctx, temp, input.Python, "-E", script, source, stage, output, input.Converter, indexModelVersion(model), precision, "--stage-only"); err != nil {
		return err
	}
	command, err := os.ReadFile(filepath.Join(stage, "command.json"))
	if err != nil {
		return err
	}
	var args []string
	if err := json.Unmarshal(command, &args); err != nil {
		return err
	}
	if err := runLocalConverter(ctx, temp, input.Converter, args...); err != nil {
		return err
	}
	identity, err := engine.ReadGGUFIdentity(output)
	if err != nil || identity.Family != model.Family || identity.IndexVersion != indexModelVersion(model) || identity.WeightType != precision {
		return msg.Err(msg.ErrLocalModelInvalid, nil)
	}
	result, err := w.verifyLocalModel(ctx, model, output)
	if err != nil {
		return err
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	// 发布到独占目录，现有模型及原始检查点不会被覆盖。
	dest, err := os.MkdirTemp(target, "local-"+model.ID+"-")
	if err != nil {
		return err
	}
	result.Path = filepath.Join(dest, filepath.Base(model.RemotePath))
	if err = os.Rename(output, result.Path); err == nil {
		err = w.register(result.ID, result.Path, false, result.SHA256, false)
	}
	if err != nil {
		_ = os.RemoveAll(dest)
	}
	return err
}

func runLocalConverter(ctx context.Context, dir, executable string, args ...string) error {
	cmd := exec.CommandContext(ctx, executable, args...)
	cmd.Dir = dir
	platform.ConfigureProcess(cmd)
	cmd.Cancel = func() error {
		platform.KillProcess(cmd)
		return nil
	}
	_, err := cmd.Output()
	if err == nil {
		return nil
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	detail := err.Error()
	var exit *exec.ExitError
	if errors.As(err, &exit) && len(exit.Stderr) > 0 {
		line := strings.TrimSpace(string(exit.Stderr))
		if i := strings.LastIndexByte(line, '\n'); i >= 0 {
			line = line[i+1:]
		}
		runes := []rune(line)
		detail = string(runes[:min(500, len(runes))])
	}
	return msg.Err(msg.ErrModelConversion, msg.Params{"detail": detail})
}
