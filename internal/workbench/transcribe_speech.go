package workbench

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"time"
	"yovoice/internal/audio"
	"yovoice/internal/diag"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
)

// 每段最多 30 秒；识别和逐词对齐都在同一段里完成。
const transcribeChunk = 30.0

// startTranscribeSpeech 接管上传文件；只有任务成功提交时才把所选音轨移入转写记录。
// video 不为空时（见 transcribeTracks）上传的原视频以该扩展名一并移入 outputs 供预览，失败或取消时照常删除。
func (w *Workbench) startTranscribeSpeech(original, upload, converter string, track int, video string) (err error) {
	defer func() {
		if err != nil {
			_ = os.Remove(upload)
		}
	}()
	w.edit.Lock()
	defer w.edit.Unlock()
	s := w.Store.Read()
	model, err := w.toolModel(s, "qwen3_asr")
	if err != nil {
		return err
	}
	settings := schema.TranscribeSettings{}
	if s.Preferences.Transcribe != nil {
		settings = *s.Preferences.Transcribe
	}
	var splitter schema.InstalledModel
	if settings.IsolateVocals {
		splitter, err = w.toolModel(s, "bs_roformer", "lyric_align")
		if err != nil {
			return toolMissing(err, msg.ErrTranscribeVocalModel)
		}
		if converter == "" {
			converter, err = audio.Converter()
			if err != nil {
				return err
			}
		}
	}
	seconds := settings.Minutes() * 60
	_, err = w.start("generate", msg.ActivityRecognize, nil, &model.ID, func(ctx context.Context) error {
		defer os.Remove(upload)
		dir, err := w.workDir("transcribe-")
		if err != nil {
			return err
		}
		defer os.RemoveAll(dir)
		wav := upload
		if converter != "" {
			wav = filepath.Join(dir, "source.wav")
			channels, rate := 1, 24000
			if settings.IsolateVocals {
				channels, rate = 2, separateRate
			}
			if err := audio.ConvertTrack(ctx, converter, upload, wav, track-1, channels, rate, seconds+1); err != nil {
				return err
			}
		}
		duration, err := audio.Duration(wav)
		if err != nil {
			return err
		}
		if duration > float64(seconds) {
			return msg.Err(msg.ErrTranscribeDuration, msg.Params{"minutes": seconds / 60})
		}
		var speech []float32
		if settings.IsolateVocals {
			speech, err = w.transcribeVocals(ctx, s, splitter, converter, wav, dir, duration)
		} else {
			var samples []float32
			var rate int
			samples, rate, err = audio.ReadMono(wav)
			if err == nil {
				speech = audio.Resample(samples, rate, recognizeRate)
			}
		}
		if err != nil {
			return err
		}
		if settings.NormalizeLoudness {
			if err := audio.NormalizeMono(ctx, speech, recognizeRate, -18, -1); err != nil {
				return err
			}
		}
		chunks := speechChunks(speech, recognizeRate, int(transcribeChunk*recognizeRate))
		var text, language string
		var words []schema.LyricWord
		for j, c := range chunks {
			part := filepath.Join(dir, "part.wav")
			if e := audio.WriteMono(part, speech[c[0]:c[1]], recognizeRate); e != nil {
				return e
			}
			// 引擎就绪后报告的“正在识别”换成带段数的进度；启动引擎等其他消息照常显示。
			progress := func(code msg.Code, params msg.Params) {
				if code == msg.ActivityRecognize {
					code, params = msg.ActivityTranscribeSpeech, msg.Params{"done": j + 1, "total": len(chunks)}
				}
				w.progress(code, params, int64(j), int64(len(chunks)))
			}
			result, e := w.engine.Recognize(ctx, *s.RuntimePath, model, s.Preferences.Backend, part, true, progress)
			if e != nil {
				return e
			}
			text = joinSpeech(text, result.Text)
			if language == "" {
				language = result.Language
			}
			offset := float64(c[0]) / recognizeRate
			for _, a := range result.Words {
				start := offset + a.Start
				words = append(words, schema.LyricWord{Word: a.Word, Start: round3(start), End: round3(max(start, offset+a.End))})
			}
		}
		if strings.TrimSpace(text) == "" {
			return msg.Err(msg.ErrTranscribeEmpty, nil)
		}
		diag.Log(w.Store.Root, "speech.transcribed", "seconds", round3(duration), "chunks", len(chunks), "chars", schema.TextLen(text), "words", len(words), "language", language)
		if words == nil {
			words = []schema.LyricWord{}
		}
		record := schema.Transcript{ID: schema.NewID(), Name: transcriptName(original), Language: language, Duration: round3(duration), CreatedAt: time.Now().UTC()}
		record.AudioFile = record.ID + ".wav"
		source := ""
		// 直接送去识别的 WAV 本身就是上传文件，不会带视频；只有转换过的上传才可能另存原视频。
		if video != "" && wav != upload {
			record.VideoFile, source = record.ID+video, upload
		}
		if settings.IsolateVocals {
			// 双声道原音轨只供分离使用，试听保留未处理的原音轨，但统一转成 24 kHz 单声道。
			playback := filepath.Join(dir, "playback.wav")
			if err := audio.ConvertWithLimit(ctx, converter, wav, playback, seconds); err != nil {
				return err
			}
			wav = playback
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		return w.saveTranscript(record, schema.TranscriptContent{Text: text, Words: words}, wav, source)
	})
	if err == nil {
		w.tagActivity("transcribe")
	}
	return err
}

// 每分钟分别分离人声，长录音不会一次性占用分轨模型的内存。
// 各段前后多取两秒供模型处理边界，只保留对应原时间轴的中间部分。
func (w *Workbench) transcribeVocals(ctx context.Context, s schema.State, model schema.InstalledModel, converter, wav, dir string, duration float64) ([]float32, error) {
	const segmentSeconds, contextSeconds = 60, 2
	total := int(duration * recognizeRate)
	speech := make([]float32, total)
	part, vocals := filepath.Join(dir, "vocal-input.wav"), filepath.Join(dir, "vocals.wav")
	segments := (total + segmentSeconds*recognizeRate - 1) / (segmentSeconds * recognizeRate)
	for i := range segments {
		start := i * segmentSeconds
		windowStart := max(0, start-contextSeconds)
		windowLength := start - windowStart + segmentSeconds + contextSeconds
		if err := audio.StereoSegment(ctx, converter, wav, part, separateRate, windowStart, windowLength); err != nil {
			return nil, err
		}
		progress := func(code msg.Code, params msg.Params) { w.progress(code, params, int64(i), int64(segments)) }
		if err := w.engine.SeparateVocals(ctx, *s.RuntimePath, model, s.Preferences.Backend, part, vocals, progress); err != nil {
			return nil, err
		}
		voice, rate, err := audio.ReadMono(vocals)
		if err != nil {
			return nil, err
		}
		samples := audio.Resample(voice, rate, recognizeRate)
		offset := (start - windowStart) * recognizeRate
		// 分离结果较短时，未覆盖的区间保留静音，后续片段的时间不变。
		end := min(total, (start+segmentSeconds)*recognizeRate)
		copy(speech[start*recognizeRate:end], samples[min(len(samples), offset):])
		_ = os.Remove(vocals)
	}
	return speech, nil
}
