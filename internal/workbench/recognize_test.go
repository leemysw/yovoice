package workbench

import (
	"bytes"
	"context"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"yovoice/internal/audio"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
	"yovoice/internal/testkit"
)

// recognizeWorkbench 准备两个 24 kHz 的声音样本（一个已有参考文本）；installed 决定是否装好可选的语音识别模型。
func recognizeWorkbench(t *testing.T, installed bool) *Workbench {
	wb, _ := yueWorkbench(t)
	if installed {
		model := filepath.Join(wb.Store.Root, "models", "Qwen3-ASR-GGUF")
		for _, file := range []string{"Qwen3-ASR-0.6B-GGUF/qwen3-asr-0.6b-q8_0.gguf", "Qwen3-ForcedAligner-0.6B-GGUF/qwen3-forced-aligner-0.6b-q8_0.gguf"} {
			must(t, os.MkdirAll(filepath.Dir(filepath.Join(model, file)), 0700))
			must(t, os.WriteFile(filepath.Join(model, file), nil, 0600))
		}
		must(t, wb.Store.Update(func(s *schema.State) {
			s.Models = append(s.Models, schema.InstalledModel{ID: "qwen3-asr-0.6b-q8", Path: model})
		}, true))
	}
	for _, name := range []string{"empty.wav", "typed.wav"} {
		must(t, audio.WriteMono(filepath.Join(wb.Store.Root, "voices", name), make([]float32, 2*24000), 24000))
	}
	must(t, wb.Store.Update(func(s *schema.State) {
		s.Voices = []schema.Voice{
			{ID: "0123456789abcdef0123456789abcdef", Name: "空", FileName: "empty.wav", Duration: 2},
			{ID: "fedcba9876543210fedcba9876543210", Name: "已填", FileName: "typed.wav", Duration: 2, ReferenceText: "手动填写的原文"},
		}
	}, true))
	return wb
}

// 没装识别模型时直接提示下载，不启动任务。
func TestRecognizeVoiceNeedsModel(t *testing.T) {
	wb := recognizeWorkbench(t, false)
	if e := wb.RecognizeVoice("0123456789abcdef0123456789abcdef"); !isCode(e, msg.ErrRecognizeModelRequired) {
		t.Fatalf("%v", e)
	}
	if e := wb.RecognizeVoice("00000000000000000000000000000000"); !isCode(e, msg.ErrAudioMissing) {
		t.Fatalf("%v", e)
	}
}

// 样本转成 16 kHz 送去识别；结果放进会话状态等界面填入。样本原来没有参考文本时顺带保存，已有的不覆盖。
func TestRecognizeVoice(t *testing.T) {
	wb := recognizeWorkbench(t, true)
	must(t, wb.RecognizeVoice("0123456789abcdef0123456789abcdef"))
	<-wb.Done()
	s := wb.Store.Read()
	if s.Activity.Status != "completed" || s.Activity.Task != "recognize" {
		t.Fatalf("%+v", s.Activity)
	}
	if s.Transcript == nil || s.Transcript.VoiceID != "0123456789abcdef0123456789abcdef" || s.Transcript.Text != testkit.RecognizedText || s.Transcript.Language != "Chinese" {
		t.Fatalf("%+v", s.Transcript)
	}
	if s.Voices[0].ReferenceText != testkit.RecognizedText {
		t.Fatalf("%+v", s.Voices[0])
	}
	first := s.Transcript.ID

	must(t, wb.RecognizeVoice("fedcba9876543210fedcba9876543210"))
	<-wb.Done()
	s = wb.Store.Read()
	if s.Transcript == nil || s.Transcript.ID == first || s.Transcript.VoiceID != "fedcba9876543210fedcba9876543210" || s.Voices[1].ReferenceText != "手动填写的原文" {
		t.Fatalf("%+v %+v", s.Transcript, s.Voices[1])
	}
	// 只清除界面已填入的那一次结果。
	must(t, wb.DismissTranscript(first))
	if wb.Store.Read().Transcript == nil {
		t.Fatal("清除了较新的识别结果")
	}
	must(t, wb.DismissTranscript(s.Transcript.ID))
	if wb.Store.Read().Transcript != nil {
		t.Fatal("识别结果未清除")
	}
	// 转换后的临时音频用完即删。
	if left, _ := filepath.Glob(filepath.Join(wb.Store.Root, "runtime", "recognize-*")); len(left) != 0 {
		t.Fatalf("%v", left)
	}
}

// tone 生成 rate 采样率的单声道音频：seconds 秒的 220 Hz 正弦，gaps 里列出的整秒区间静音。
func tone(seconds, rate int, gaps ...[2]int) []float32 {
	out := make([]float32, seconds*rate)
	for i := range out {
		quiet := false
		for _, g := range gaps {
			quiet = quiet || (i >= g[0]*rate && i < g[1]*rate)
		}
		if !quiet {
			out[i] = float32(.3 * math.Sin(2*math.Pi*220*float64(i)/float64(rate)))
		}
	}
	return out
}

// 长音频按停顿切成 30 秒以内的段，切点落在静音里；几乎无声的段不送去识别。
func TestSpeechChunks(t *testing.T) {
	chunks := speechChunks(tone(70, 16000, [2]int{25, 26}, [2]int{50, 51}), 16000, 30*16000)
	if len(chunks) != 3 || chunks[0] != [2]int{0, 25.02 * 16000} || chunks[1][0] != chunks[0][1] || chunks[1][1] != 50.02*16000 || chunks[2][1] != 70*16000 {
		t.Fatalf("%v", chunks)
	}
	if chunks := speechChunks(tone(40, 16000, [2]int{0, 35}), 16000, 30*16000); len(chunks) != 1 || chunks[0][0] < 20*16000 {
		t.Fatalf("%v", chunks)
	}
	if joinSpeech("你好。", "世界") != "你好。世界" || joinSpeech("hello", "world") != "hello world" || joinSpeech("", " a ") != "a" {
		t.Fatal("拼接")
	}
	if transcriptName(`C:\录音\访谈.m4a`) != "访谈" || transcriptName("/tmp/a.b.wav") != "a.b" || transcriptName("") != "" {
		t.Fatal(transcriptName(`C:\录音\访谈.m4a`))
	}
}

// 转写上传的 WAV：逐段识别并带回逐词时间，时间换回整段音频；结果保存为转写记录，原音频移进 outputs，临时文件清理干净。
func TestTranscribeSpeech(t *testing.T) {
	if e := recognizeWorkbench(t, false).TranscribeSpeech("a.wav", bytes.NewReader(nil)); !isCode(e, msg.ErrRecognizeModelRequired) {
		t.Fatalf("%v", e)
	}
	wb := recognizeWorkbench(t, true)
	wav := filepath.Join(t.TempDir(), "talk.wav")
	must(t, audio.WriteMono(wav, tone(70, 24000, [2]int{25, 26}, [2]int{50, 51}), 24000))
	b, e := os.ReadFile(wav)
	must(t, e)
	must(t, wb.TranscribeSpeech("访谈.wav", bytes.NewReader(b)))
	<-wb.Done()
	s := wb.Store.Read()
	if s.Activity.Status != "completed" || s.Activity.Task != "transcribe" || s.Transcript != nil {
		t.Fatalf("%+v %+v", s.Activity, s.Transcript)
	}
	if len(s.Transcripts) != 1 {
		t.Fatalf("%+v", s.Transcripts)
	}
	r := s.Transcripts[0]
	if r.Name != "访谈" || r.Duration != 70 || r.Language != "Chinese" || r.FileName != r.ID+".json" || r.AudioFile != r.ID+".wav" {
		t.Fatalf("%+v", r)
	}
	if saved, e := os.ReadFile(filepath.Join(wb.Store.Root, "outputs", r.AudioFile)); e != nil || !bytes.Equal(saved, b) {
		t.Fatalf("原音频没有保存：%v", e)
	}
	// 还没编辑过的转写读取时按断句规则分好行，每段一句。
	c, e := wb.ReadTranscript(r.ID)
	must(t, e)
	if c.Text != testkit.RecognizedText+testkit.RecognizedText+testkit.RecognizedText || len(c.Words) != 36 || len(c.Captions) != 3 || c.Captions[1].Text != "今天天气真好，我们去散步吧" {
		t.Fatalf("%+v", c)
	}
	// 第二段从 25.02 秒开始，第 13 个字的时间要加上这一段的起点。
	if c.Words[0].Word != "今" || c.Words[1].Start != .25 || c.Words[12].Start != 25.02 || c.Words[13].End != 25.458 {
		t.Fatalf("%+v", c.Words[:14])
	}
	if left, _ := filepath.Glob(filepath.Join(wb.Store.Root, "runtime", "transcribe-*")); len(left) != 0 {
		t.Fatalf("%v", left)
	}
	if left, _ := filepath.Glob(filepath.Join(wb.Store.Root, "downloads", "upload-*")); len(left) != 0 {
		t.Fatalf("%v", left)
	}
}

// 设置里选了 Parakeet 时转写改用它：单文件模型不带对齐模型，逐词时间来自识别本身，词里并入的标点要去掉，断句结果与 Qwen3 一致。
func TestTranscribeSpeechParakeet(t *testing.T) {
	wb := recognizeWorkbench(t, true)
	model := filepath.Join(wb.Store.Root, "models", "parakeet-tdt-0.6b-v3-q8_0.gguf")
	must(t, os.WriteFile(model, nil, 0600))
	must(t, wb.Store.Update(func(s *schema.State) {
		s.Models = append(s.Models, schema.InstalledModel{ID: "parakeet-tdt-0.6b-v3-q8", Path: model})
	}, true))
	p := wb.Store.Read().Preferences
	p.RecognizeModel = "parakeet-tdt-0.6b-v3-q8"
	must(t, wb.SavePreferences(p))
	wav := filepath.Join(t.TempDir(), "talk.wav")
	must(t, audio.WriteMono(wav, tone(70, 24000, [2]int{25, 26}, [2]int{50, 51}), 24000))
	b, e := os.ReadFile(wav)
	must(t, e)
	must(t, wb.TranscribeSpeech("访谈.wav", bytes.NewReader(b)))
	<-wb.Done()
	s := wb.Store.Read()
	if s.Activity.Status != "completed" || len(s.Transcripts) != 1 || s.Activity.ModelID == nil || *s.Activity.ModelID != "parakeet-tdt-0.6b-v3-q8" {
		t.Fatalf("%+v", s.Activity)
	}
	c, e := wb.ReadTranscript(s.Transcripts[0].ID)
	must(t, e)
	if len(c.Words) != 36 || c.Words[3].Word != "气" || c.Words[5].Word != "好" || len(c.Captions) != 3 || c.Captions[1].Text != "今天天气真好，我们去散步吧" {
		t.Fatalf("%+v", c)
	}
	// 选的模型不是语音识别模型时拒绝保存。
	p.RecognizeModel = "index-2.5-q8"
	if e := wb.SavePreferences(p); !isCode(e, msg.ErrRequestInvalid) {
		t.Fatalf("%v", e)
	}
}

// 模拟分离器在每段的 0.5～1 秒、2.5～3 秒返回信号。第二段裁去前两秒，试听仍来自完整原音轨。
func TestTranscribeIsolatedPlaybackAndBoundaries(t *testing.T) {
	converter := os.Getenv("YOVOICE_TEST_FFMPEG")
	if converter == "" {
		var err error
		converter, err = exec.LookPath("ffmpeg")
		if err != nil {
			t.Skip("需要 FFmpeg 执行真实转换")
		}
	}
	wb := recognizeWorkbench(t, true)
	vocalModel := schema.InstalledModel{ID: "bs-roformer-q8", Path: filepath.Join(wb.Store.Root, "models", "vocals.gguf")}
	must(t, os.WriteFile(vocalModel.Path, nil, 0600))
	must(t, wb.Store.Update(func(s *schema.State) {
		s.Models = append(s.Models, vocalModel)
		s.Preferences.Transcribe = &schema.TranscribeSettings{IsolateVocals: true}
	}, true))

	const seconds, playbackRate = 63, 24000
	dir := t.TempDir()
	upload := filepath.Join(dir, "input.wav")
	must(t, audio.WriteMono(upload, tone(seconds, playbackRate), playbackRate))
	stereo := filepath.Join(dir, "stereo.wav")
	ctx := context.Background()
	must(t, audio.ConvertStereo(ctx, converter, upload, stereo, separateRate))
	voice, err := wb.transcribeVocals(ctx, wb.Store.Read(), vocalModel, converter, stereo, dir, seconds)
	must(t, err)
	windowDuration, err := audio.Duration(filepath.Join(dir, "vocal-input.wav"))
	must(t, err)
	if windowDuration != 5 || len(voice) != seconds*recognizeRate {
		t.Fatalf("末段窗口 %.3f 秒，人声长度 %d 样本", windowDuration, len(voice))
	}
	if voice[60*recognizeRate+recognizeRate/4] != 0 ||
		math.Abs(float64(voice[60*recognizeRate+3*recognizeRate/4+1])) < .01 ||
		voice[62*recognizeRate+3*recognizeRate/4+1] != 0 {
		t.Fatal("第二段应裁掉前两秒上下文，保留原时间轴上的人声")
	}

	must(t, wb.startTranscribeSpeech("访谈.wav", upload, converter, 1, ""))
	<-wb.Done()
	state := wb.Store.Read()
	if state.Activity.Status != "completed" || len(state.Transcripts) != 1 {
		t.Fatalf("转写未完成：%+v", state.Activity)
	}
	record := state.Transcripts[0]
	playback := filepath.Join(wb.Store.Root, "outputs", record.AudioFile)
	samples, rate, err := audio.ReadMono(playback)
	must(t, err)
	info, err := os.Stat(playback)
	must(t, err)
	if rate != playbackRate || len(samples) != seconds*rate || info.Size() > int64(seconds*rate*2+1024) {
		t.Fatalf("试听应为 24 kHz 单声道：%d Hz，%d 样本，%d 字节", rate, len(samples), info.Size())
	}
	if math.Abs(float64(samples[62*rate+3*rate/4+1])) < .01 || record.Duration != seconds {
		t.Fatal("试听应保留原音轨和时长")
	}
}

// mediaTools 返回测试用的 FFmpeg 与 ffprobe，缺少时跳过。
func mediaTools(t *testing.T) (string, string) {
	t.Helper()
	tools := [2]string{os.Getenv("YOVOICE_TEST_FFMPEG"), os.Getenv("YOVOICE_TEST_FFPROBE")}
	for i, name := range []string{"ffmpeg", "ffprobe"} {
		if tools[i] == "" {
			path, err := exec.LookPath(name)
			if err != nil {
				t.Skip("需要 FFmpeg 与 ffprobe 执行真实转换")
			}
			tools[i] = path
		}
	}
	return tools[0], tools[1]
}

// 只有界面能播放的容器且带画面时保留原视频：mp4 移进 outputs 供预览，删除记录时一起删；
// mkv、带封面的 m4a 不保留；转换失败时上传照常删除，不会留下视频。
func TestTranscribeKeepsVideo(t *testing.T) {
	converter, prober := mediaTools(t)
	ctx := context.Background()
	dir := t.TempDir()
	media := func(name string, args ...string) string {
		path := filepath.Join(dir, name)
		args = append([]string{"-v", "error", "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=48000",
			"-f", "lavfi", "-i", "color=size=64x64:rate=10", "-t", "3"}, args...)
		if output, err := exec.Command(converter, append(args, path)...).CombinedOutput(); err != nil {
			t.Fatalf("%s: %s: %v", name, output, err)
		}
		return path
	}
	mp4 := media("clip.mp4", "-map", "0:a", "-map", "1:v", "-c:v", "mpeg4", "-c:a", "aac")
	mkv := media("clip.mkv", "-map", "0:a", "-map", "1:v", "-c:v", "mpeg4", "-c:a", "aac")
	cover := media("cover.m4a", "-map", "0:a", "-map", "1:v", "-frames:v", "1", "-c:v", "png", "-disposition:v:0", "attached_pic", "-c:a", "aac")
	for _, tc := range []struct{ name, path, want string }{
		{"访谈.MP4", mp4, ".mp4"}, {"访谈.mov", mp4, ".mov"}, {"访谈.mkv", mkv, ""}, {"访谈.mp4", cover, ""}, {"访谈.m4a", cover, ""},
	} {
		if got := transcribeVideo(ctx, prober, tc.name, tc.path); got != tc.want {
			t.Errorf("%s：%q，应为 %q", tc.name, got, tc.want)
		}
	}

	wb := recognizeWorkbench(t, true)
	original, err := os.ReadFile(mp4)
	must(t, err)
	upload := filepath.Join(wb.Store.Root, "downloads", "upload-video")
	must(t, os.WriteFile(upload, original, 0600))
	must(t, wb.startTranscribeSpeech("访谈.mp4", upload, converter, 1, ".mp4"))
	<-wb.Done()
	s := wb.Store.Read()
	if s.Activity.Status != "completed" || len(s.Transcripts) != 1 {
		t.Fatalf("转写未完成：%+v", s.Activity)
	}
	r := s.Transcripts[0]
	if r.AudioFile != r.ID+".wav" || r.VideoFile != r.ID+".mp4" {
		t.Fatalf("%+v", r)
	}
	outputs := filepath.Join(wb.Store.Root, "outputs")
	if saved, err := os.ReadFile(filepath.Join(outputs, r.VideoFile)); err != nil || !bytes.Equal(saved, original) {
		t.Fatalf("原视频没有保存：%v", err)
	}
	if _, err := audio.Duration(filepath.Join(outputs, r.AudioFile)); err != nil {
		t.Fatalf("试听音轨应为 WAV：%v", err)
	}
	if _, err := os.Stat(upload); !os.IsNotExist(err) {
		t.Fatalf("上传文件应已移走：%v", err)
	}
	must(t, wb.DeleteTranscript(r.ID))
	if _, err := os.Stat(filepath.Join(outputs, r.VideoFile)); !os.IsNotExist(err) {
		t.Fatalf("删除记录后原视频仍在：%v", err)
	}

	must(t, os.WriteFile(upload, []byte("不是视频"), 0600))
	must(t, wb.startTranscribeSpeech("坏.mp4", upload, converter, 1, ".mp4"))
	<-wb.Done()
	if s := wb.Store.Read(); s.Activity.Status != "failed" || len(s.Transcripts) != 0 {
		t.Fatalf("%+v", s.Activity)
	}
	if _, err := os.Stat(upload); !os.IsNotExist(err) {
		t.Fatalf("失败后上传文件应删除：%v", err)
	}
	if left, _ := filepath.Glob(filepath.Join(outputs, "*.mp4")); len(left) != 0 {
		t.Fatalf("失败后不应留下视频：%v", left)
	}
}
