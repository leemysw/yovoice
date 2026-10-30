package audio

import (
	"math"
	"math/rand"
	"path/filepath"
	"testing"
	"yovoice/internal/schema"
)

func sine(rate int, seconds, freq, amplitude, phase float64) []float32 {
	out := make([]float32, int(float64(rate)*seconds))
	for i := range out {
		out[i] = float32(amplitude * math.Sin(2*math.Pi*freq*float64(i)/float64(rate)+phase))
	}
	return out
}

// speechLike 合成像说话的信号：0.25 秒的元音（140 Hz 谐波、汉宁包络）接 0.08 秒字间隙，每 2 秒停 0.4 秒。
func speechLike(rate int, seconds, amplitude float64, seed int64) []float32 {
	out := make([]float32, int(float64(rate)*seconds))
	r := rand.New(rand.NewSource(seed))
	syllable, gap := int(0.25*float64(rate)), int(0.08*float64(rate))
	for at, n := 0, 0; at+syllable < len(out); n++ {
		f0 := 120 + 40*r.Float64()
		for i := 0; i < syllable; i++ {
			env := 0.5 - 0.5*math.Cos(2*math.Pi*float64(i)/float64(syllable))
			v := 0.0
			for k := 1; k <= 20; k++ {
				v += math.Sin(2*math.Pi*f0*float64(k)*float64(i)/float64(rate)) / float64(k)
			}
			out[at+i] = float32(amplitude * env * v / 2)
		}
		at += syllable + gap
		if n%6 == 5 {
			at += int(0.4 * float64(rate))
		}
	}
	return out
}

func write(t *testing.T, samples []float32, rate int) string {
	path := filepath.Join(t.TempDir(), "a.wav")
	must(t, WriteMono(path, samples, rate))
	return path
}

func codes(c schema.AudioCheck) map[string]schema.AudioIssue {
	out := map[string]schema.AudioIssue{}
	for _, issue := range c.Issues {
		out[issue.Code] = issue
	}
	return out
}

// BS.1770 的基准：单声道 997 Hz、-20 dBFS 的正弦为 -23.01 LUFS，与采样率无关；静音段被门限排除。
func TestLoudnessMatchesReference(t *testing.T) {
	for _, rate := range []int{48000, 44100, 24000, 16000} {
		m := NewMeter(rate, 1)
		m.Write(sine(rate, 3, 997, 0.1, 0))
		if got := m.Loudness(); math.Abs(got+23.01) > 0.1 {
			t.Fatalf("%d Hz: %.2f LUFS", rate, got)
		}
		gated := NewMeter(rate, 1)
		gated.Write(sine(rate, 3, 997, 0.1, 0))
		gated.Write(make([]float32, rate*3))
		// 跨在正弦与静音交界的块只含部分信号，按标准也计入，结果略低。
		if got := gated.Loudness(); math.Abs(got+23.01) > 0.3 {
			t.Fatalf("%d Hz 带静音: %.2f LUFS", rate, got)
		}
	}
	// 两个声道相同的立体声比单声道响 3 dB。
	stereo := NewMeter(48000, 2)
	mono := sine(48000, 2, 997, 0.1, 0)
	interleaved := make([]float32, 0, 2*len(mono))
	for _, v := range mono {
		interleaved = append(interleaved, v, v)
	}
	stereo.Write(interleaved)
	if got := stereo.Loudness(); math.Abs(got+20) > 0.1 {
		t.Fatalf("立体声 %.2f", got)
	}
	if got := NewMeter(48000, 1).Loudness(); got != Silence {
		t.Fatal(got)
	}
}

// 四分之一采样率、相位 45° 的正弦，采样点只到峰值的 0.707：真峰值要找回被采样漏掉的 3 dB。
func TestTruePeakFindsInterSamplePeaks(t *testing.T) {
	m := NewMeter(48000, 1)
	m.Write(sine(48000, 1, 12000, 0.5, math.Pi/4))
	if got := m.TruePeak(); got < -6.5 || got > -5.6 {
		t.Fatalf("真峰值 %.2f dBTP，应接近 -6.02", got)
	}
}

// 归一化只乘一个增益：能提到目标就到目标，峰值不够时停在峰值上限并标记 Limited。
func TestNormalize(t *testing.T) {
	path := write(t, sine(24000, 3, 997, 0.0316, 0), 24000) // 约 -33 LUFS
	result, e := Normalize(path, -16, -1)
	must(t, e)
	loudness, peak, e := Measure(path)
	must(t, e)
	if result.Limited || math.Abs(loudness+16) > 0.15 || math.Abs(result.After+16) > 0.01 || peak > -1 {
		t.Fatalf("%+v，实测 %.2f LUFS %.2f dBTP", result, loudness, peak)
	}
	loud := write(t, sine(24000, 3, 997, 0.316, 0), 24000) // 约 -13 LUFS，峰值 -10 dBFS
	result, e = Normalize(loud, -1, -1)
	must(t, e)
	loudness, peak, e = Measure(loud)
	must(t, e)
	if !result.Limited || peak > -0.9 || math.Abs(loudness-result.After) > 0.15 || loudness > -3.5 {
		t.Fatalf("%+v，实测 %.2f LUFS %.2f dBTP", result, loudness, peak)
	}
	silent := write(t, make([]float32, 24000), 24000)
	if result, e = Normalize(silent, -16, -1); e != nil || result.Gain != 0 {
		t.Fatal(result, e)
	}
}

// 正常的人声不报问题；削波、截断、长静音、咔哒声、无声和音量过小各自被找到，时间位置正确。
func TestInspectFindsIssues(t *testing.T) {
	const rate = 24000
	clean := speechLike(rate, 4, 0.3, 1)
	check, e := Inspect(write(t, clean, rate), true)
	must(t, e)
	if len(check.Issues) != 0 || check.Loudness > -10 || check.Loudness < -40 {
		t.Fatalf("干净人声被报告：%+v", check)
	}

	loud := make([]float32, len(clean))
	for i, v := range clean {
		loud[i] = max(-1, min(1, v*6))
	}
	check, e = Inspect(write(t, loud, rate), true)
	must(t, e)
	if issue, ok := codes(check)["clipping"]; !ok || issue.Count < 5 || issue.At > 0.3 {
		t.Fatalf("没找到削波：%+v", check)
	}

	// 截在一个元音中间。
	cut := append(append([]float32{}, clean[:3*rate]...), speechLike(rate, 0.6, 0.3, 2)[:int(0.12*rate)]...)
	check, e = Inspect(write(t, cut, rate), true)
	must(t, e)
	if _, ok := codes(check)["cutoff"]; !ok {
		t.Fatalf("没找到截断：%+v", check)
	}

	gapped := append(append(append([]float32{}, clean[:2*rate]...), make([]float32, 3*rate)...), clean[2*rate:]...)
	check, e = Inspect(write(t, gapped, rate), true)
	must(t, e)
	if issue, ok := codes(check)["silence"]; !ok || issue.At < 1.9 || issue.At > 2.6 || issue.End < 4.9 || issue.End > 5.6 {
		t.Fatalf("没找到长静音：%+v", check)
	}

	clicked := append([]float32{}, clean...)
	clicked[int(1.5*rate)] += 0.6
	check, e = Inspect(write(t, clicked, rate), true)
	must(t, e)
	if issue, ok := codes(check)["clicks"]; !ok || issue.Count != 1 || math.Abs(issue.At-1.5) > 0.01 {
		t.Fatalf("没找到咔哒声：%+v", check)
	}

	check, e = Inspect(write(t, make([]float32, 2*rate), rate), true)
	must(t, e)
	if _, ok := codes(check)["silent"]; !ok || len(check.Issues) != 1 || check.Loudness != Silence {
		t.Fatalf("无声：%+v", check)
	}

	quiet := make([]float32, len(clean))
	for i, v := range clean {
		quiet[i] = v * 0.03
	}
	check, e = Inspect(write(t, quiet, rate), true)
	must(t, e)
	if _, ok := codes(check)["quiet"]; !ok {
		t.Fatalf("没报音量过小：%+v", check)
	}

	// 音乐不检查截断与静音。
	check, e = Inspect(write(t, cut, rate), false)
	must(t, e)
	if len(check.Issues) != 0 {
		t.Fatalf("音乐被按人声检查：%+v", check)
	}
}

// 带噪声的随机信号（像擦音）不会被当成咔哒声。
func TestClicksIgnoreNoiseBursts(t *testing.T) {
	const rate = 24000
	r := rand.New(rand.NewSource(3))
	signal := speechLike(rate, 3, 0.3, 4)
	for burst := 0; burst < 6; burst++ {
		at := int((0.2 + 0.45*float64(burst)) * rate)
		for i := 0; i < int(0.04*rate); i++ {
			signal[at+i] += float32(0.3 * (r.Float64()*2 - 1))
		}
	}
	if at, count := clicks(signal, rate); count != 0 {
		t.Fatalf("擦音被当成咔哒声：%d 处，第一处 %.2f 秒", count, at)
	}
}

// 长录音里挑参考片段：避开嘈杂和削波的部分，选中干净连贯的一段，起止落在停顿上。
func TestPickSpeech(t *testing.T) {
	const rate = 16000
	r := rand.New(rand.NewSource(5))
	recording := make([]float32, 50*rate)
	for i := range recording {
		recording[i] = float32(0.003 * (r.Float64()*2 - 1))
	}
	put := func(at float64, samples []float32) {
		for i, v := range samples {
			recording[int(at*rate)+i] += v
		}
	}
	noisy := speechLike(rate, 12, 0.3, 6)
	for i := range noisy {
		noisy[i] += float32(0.1 * (r.Float64()*2 - 1))
	}
	put(1, noisy)
	clipped := speechLike(rate, 12, 0.3, 7)
	for i, v := range clipped {
		clipped[i] = max(-1, min(1, v*5))
	}
	put(15, clipped)
	put(30, speechLike(rate, 12, 0.3, 8))
	span := PickSpeech(recording, rate)
	if span.Start < 29.7 || span.End > 42.5 || span.End-span.Start < referenceShortest || span.End-span.Start > referenceLongest {
		t.Fatalf("选中了 %.2f–%.2f 秒", span.Start, span.End)
	}
	// 起点前与终点后各 0.1 秒内不应是正在说话的元音中部。
	levels := frames(recording, rate)
	mask, _, _ := voiced(levels)
	if mask[int(span.Start/frameSeconds)-1] && mask[int(span.Start/frameSeconds)] {
		t.Fatalf("起点切在字中间：%.2f", span.Start)
	}
	short := speechLike(rate, 8, 0.3, 9)
	if got := PickSpeech(short, rate); got.Start != 0 || math.Abs(got.End-8) > 0.01 {
		t.Fatal(got)
	}
}

// 就地归一化按原格式写回：24 位整数与 32 位浮点编码后解码不失真。
func TestPCMEncodeRoundTrip(t *testing.T) {
	in := []float32{0, 0.5, -0.5, 0.999, -1, 0.123456}
	for _, p := range []pcm{{format: 1, channels: 1, bits: 16}, {format: 1, channels: 1, bits: 24}, {format: 1, channels: 1, bits: 32}, {format: 3, channels: 1, bits: 32}} {
		raw := make([]byte, len(in)*int(p.bits/8))
		p.encode(in, raw)
		out := make([]float32, len(in))
		p.decode(raw, out)
		for i := range in {
			if math.Abs(float64(out[i]-in[i])) > 1/math.Pow(2, float64(min(p.bits, 24)-1)) {
				t.Fatalf("%d 位格式 %d：%v → %v", p.bits, p.format, in[i], out[i])
			}
		}
	}
}

// Measure 测量 WAV 文件的整体响度（LUFS）与真峰值（dBTP），分块读取，长音频也只占固定内存。只有测试在用。
func Measure(path string) (loudness, peak float64, err error) {
	f, p, e := openPCM(path, 0)
	if e != nil {
		return 0, 0, e
	}
	defer f.Close()
	m := NewMeter(p.rate, int(p.channels))
	if e = p.scan(f, m.Write); e != nil {
		return 0, 0, e
	}
	return m.Loudness(), m.TruePeak(), nil
}
