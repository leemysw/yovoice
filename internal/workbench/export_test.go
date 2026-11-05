package workbench

import (
	"bytes"
	"context"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"yovoice/internal/audio"
	"yovoice/internal/schema"
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

// 转码导出的参数校验与 WAV 路径：版本按所选响度复制成临时文件，上传的临时文件原样交回；
// 不支持的格式、响度、来源和非 JPEG 之外的乱码封面都被拒绝。FLAC / M4A 的编码见 audio.TestEncode。
func TestEncodeExport(t *testing.T) {
	w, err := New(t.TempDir())
	must(t, err)
	defer w.Close()
	samples := make([]float32, 24000*2)
	for i := range samples {
		samples[i] = float32(0.03 * math.Sin(2*math.Pi*440*float64(i)/24000))
	}
	id := schema.NewID()
	path, err := w.Store.MediaPath("outputs", id+".wav")
	must(t, err)
	must(t, audio.WriteMono(path, samples, 24000))
	must(t, w.Store.Update(func(s *schema.State) {
		s.History = append(s.History, schema.Generation{ID: id, Title: "夜航", FileName: id + ".wav", Duration: 2})
	}, true))
	ctx := context.Background()
	exported, result, err := w.EncodeExport(ctx, ExportRequest{Kind: "outputs", ID: id, Format: "wav", Loudness: -16})
	must(t, err)
	if result == nil {
		t.Fatal("选了目标响度应返回调整结果")
	}
	if p, e := w.ExportPath(exported); e != nil || filepath.Ext(p) != ".wav" {
		t.Fatal(p, e)
	}
	again, _, err := w.EncodeExport(ctx, ExportRequest{Kind: "export", ID: exported, Format: "wav"})
	must(t, err)
	if again != exported {
		t.Fatal("上传的临时文件导出 WAV 应原样交回", again, exported)
	}
	for name, r := range map[string]ExportRequest{
		"格式":   {Kind: "outputs", ID: id, Format: "ogg"},
		"响度":   {Kind: "outputs", ID: id, Format: "wav", Loudness: -20},
		"来源":   {Kind: "voices", ID: id, Format: "wav"},
		"临时响度": {Kind: "export", ID: exported, Format: "wav", Loudness: -16},
		"封面":   {Kind: "outputs", ID: id, Format: "flac", Cover: "不是 base64"},
		"缺失":   {Kind: "export", ID: schema.NewID(), Format: "flac"},
	} {
		if _, _, e := w.EncodeExport(ctx, r); e == nil {
			t.Fatalf("%s无效时应被拒绝", name)
		}
	}
}
