package workbench

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"yovoice/internal/catalog"
	"yovoice/internal/engine"
	"yovoice/internal/msg"
	"yovoice/internal/platform"
	"yovoice/internal/schema"
	"yovoice/internal/store"
)

//go:embed converters/index_tts.py
var indexConversionScript []byte

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
	temp, err := os.MkdirTemp(target, ".yovoice-convert-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(temp)
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
