package workbench

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestVoxReferenceEncoderCapacity(t *testing.T) {
	root := t.TempDir()
	_, err := NewStore(root)
	must(t, err)
	engine := NewEngine(root)
	defer engine.Stop()
	executable, err := os.Executable()
	must(t, err)
	model := InstalledModel{ID: "voxcpm2-q8", Path: filepath.Join(root, "model.gguf")}
	must(t, os.WriteFile(model.Path, []byte("test"), 0600))
	draft := DefaultDraft()
	draft.ModelID, draft.VoxMode = model.ID, "clone"
	voice := filepath.Join(root, "reference.wav")
	output := filepath.Join(root, "output.wav")
	previousPID := 0
	for _, item := range []struct{ seconds, rate, capacity int }{{5, 16000, 240000}, {15, 16000, 240640}, {28, 24000, 448000}, {60, 48000, 960000}} {
		// 同一时长在不同采样率下，都按引擎重采样后的 16 kHz 容量计算。
		data := append(wav()[:44:44], make([]byte, item.seconds*item.rate*2)...)
		binary.LittleEndian.PutUint32(data[4:], uint32(len(data)-8))
		binary.LittleEndian.PutUint32(data[24:], uint32(item.rate))
		binary.LittleEndian.PutUint32(data[28:], uint32(item.rate*2))
		binary.LittleEndian.PutUint32(data[40:], uint32(len(data)-44))
		must(t, os.WriteFile(voice, data, 0600))
		must(t, engine.Generate(context.Background(), executable, model, "cpu", draft, voice, "", output, func(MessageCode, MessageParams) {}))
		var config struct {
			Models []struct {
				Options map[string]int `json:"session_options"`
			} `json:"models"`
		}
		data, err := os.ReadFile(filepath.Join(root, "runtime", "server.json"))
		must(t, err)
		must(t, json.Unmarshal(data, &config))
		if got := config.Models[0].Options["voxcpm2.audiovae_encoder_sample_capacity"]; got != item.capacity {
			t.Fatalf("%d 秒参考音频的容量为 %d，期望 %d", item.seconds, got, item.capacity)
		}
		pid := engine.process.Process.Pid
		if pid == previousPID {
			t.Fatal("容量变化后必须重建引擎会话")
		}
		must(t, engine.Generate(context.Background(), executable, model, "cpu", draft, voice, "", output, func(MessageCode, MessageParams) {}))
		if engine.process.Process.Pid != pid {
			t.Fatal("容量不变时应复用引擎")
		}
		previousPID = pid
	}
}
