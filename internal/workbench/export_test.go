package workbench

import (
	"bytes"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"yovoice/internal/audio"
)

// 导出的音频写成临时文件，只保留最近一份；不是 WAV 的内容不落盘。
func TestSaveExport(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	wav := append([]byte("RIFF\x00\x00\x00\x00WAVE"), bytes.Repeat([]byte{1}, 64<<20)...)
	first, _, err := w.SaveExport(bytes.NewReader(wav), 0)
	must(t, err)
	second, _, err := w.SaveExport(bytes.NewReader(wav), 0)
	must(t, err)
	if _, err = w.ExportPath(first); err == nil {
		t.Fatal("上一份导出文件应在新导出时删除")
	}
	path, err := w.ExportPath(second)
	must(t, err)
	if info, e := os.Stat(path); e != nil || info.Size() != int64(len(wav)) {
		t.Fatalf("导出文件不完整：%v %v", info, e)
	}
	if _, _, err = w.SaveExport(strings.NewReader("not a wave file"), 0); err == nil {
		t.Fatal("非 WAV 内容应被拒绝")
	}
	if _, err = w.ExportPath("../" + second); err == nil {
		t.Fatal("无效 ID 应被拒绝")
	}
}

// 选了目标响度时，导出文件就地调整到该响度，峰值不超过 -1 dBTP；不在可选列表里的目标被拒绝。
func TestSaveExportNormalizesLoudness(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	samples := make([]float32, 24000*3)
	for i := range samples {
		samples[i] = float32(0.03 * math.Sin(2*math.Pi*440*float64(i)/24000))
	}
	source := filepath.Join(t.TempDir(), "mix.wav")
	must(t, audio.WriteMono(source, samples, 24000))
	wav, err := os.ReadFile(source)
	must(t, err)
	id, result, err := w.SaveExport(bytes.NewReader(wav), -16)
	must(t, err)
	path, err := w.ExportPath(id)
	must(t, err)
	check, err := audio.Inspect(path, false)
	must(t, err)
	if result == nil || result.Limited || math.Abs(check.Loudness+16) > 0.2 || check.Peak > -1 || result.Before > -30 {
		t.Fatalf("%+v，实测 %.2f LUFS %.2f dBTP", result, check.Loudness, check.Peak)
	}
	if _, _, err = w.SaveExport(bytes.NewReader(wav), -3); err == nil {
		t.Fatal("不在可选列表里的目标响度应被拒绝")
	}
}
