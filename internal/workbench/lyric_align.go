package workbench

import (
	"context"
	"math"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"unicode"
	"yovoice/internal/audio"
	"yovoice/internal/catalog"
	"yovoice/internal/diag"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
)

// 逐字对齐：Qwen3 Forced Aligner 的音频编码器最多 1500 个位置，每秒约 13 个，一次只能对齐约 115 秒；
// 每段人声控制在 alignChunkSeconds 以内，留出余量。整首长度和歌词行数设上限，避免误传超长音频。
const alignChunkSeconds, maxAlignSeconds, maxAlignLines = 100.0, 1200.0, 2000

// BS-RoFormer 只接受 44.1 kHz 输入；对齐模型使用 16 kHz。
const separateRate, alignRate = 44100, 16000

// LyricLine 是一行要唱的歌词和它在歌曲里的大致范围（秒），来自界面现有的逐行时间（自动定位、校准或估算）。
// 后端按这些范围把歌词分组切段，切点落在人声的空隙里。
type LyricLine struct {
	Text  string  `json:"text"`
	Start float64 `json:"start"`
	End   float64 `json:"end"`
}

// sungLyrics 去掉段落标记行，返回要唱的歌词，每行一句。
func sungLyrics(d schema.Draft) string {
	if d.Instrumental {
		return ""
	}
	var lines []string
	for _, line := range strings.Split(d.Lyrics, "\n") {
		line = strings.TrimSpace(line)
		if line != "" && !(strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]")) {
			lines = append(lines, line)
		}
	}
	return strings.Join(lines, "\n")
}

// alignLanguage 按歌词文字选对齐语言：有假名算日语，有谚文算韩语，有汉字算中文，西里尔字母算俄语，其余按英语。
func alignLanguage(text string) string {
	han := false
	for _, r := range text {
		switch {
		case unicode.In(r, unicode.Hiragana, unicode.Katakana):
			return "Japanese"
		case unicode.Is(unicode.Hangul, r):
			return "Korean"
		case unicode.Is(unicode.Han, r):
			han = true
		case unicode.Is(unicode.Cyrillic, r) && !han:
			return "Russian"
		}
	}
	if han {
		return "Chinese"
	}
	return "English"
}

// AlignLyrics 用可选下载的歌词对齐模型给一个生成版本做逐字对齐：先用 BS-RoFormer 分出人声，再按句分组、
// 逐段用 Qwen3 Forced Aligner 把歌词对到人声上。结果写进 LyricWords 并替换手动校准；lines 为空时整首歌词作为一行。
func (w *Workbench) AlignLyrics(id string, lines []LyricLine) error {
	path, e := w.MediaFile("outputs", id)
	if e != nil {
		return e
	}
	w.edit.Lock()
	defer w.edit.Unlock()
	s := w.Store.Read()
	i := slices.IndexFunc(s.History, func(g schema.Generation) bool { return g.ID == id })
	if i < 0 {
		return msg.Err(msg.ErrAudioMissing, nil)
	}
	generation := s.History[i]
	lyrics, duration := sungLyrics(generation.Settings), generation.Duration
	if lyrics == "" {
		return msg.Err(msg.ErrAlignLyrics, nil)
	}
	if len(lines) == 0 {
		lines = []LyricLine{{Text: lyrics, Start: 0, End: duration}}
	}
	if len(lines) > maxAlignLines || duration > maxAlignSeconds {
		return msg.Err(msg.ErrAudioDuration, nil)
	}
	size := 0
	for j, c := range lines {
		size += schema.TextLen(c.Text)
		if strings.TrimSpace(c.Text) == "" || size > 12000 || math.IsNaN(c.Start) || math.IsNaN(c.End) || c.Start < 0 || c.End < c.Start || c.End > duration+1 ||
			(j > 0 && c.Start < lines[j-1].Start) {
			return msg.Err(msg.ErrRequestInvalid, nil)
		}
	}
	m := slices.IndexFunc(s.Models, func(m schema.InstalledModel) bool {
		p, e := catalog.Lookup(m.ID)
		return e == nil && p.Family == "lyric_align"
	})
	if m < 0 {
		return msg.Err(msg.ErrAlignModelRequired, nil)
	}
	model, e := w.engineModel(s, s.Models[m].ID)
	if e != nil {
		return e
	}
	_, e = w.start("generate", msg.ActivitySeparateVocals, nil, &model.ID, func(ctx context.Context) error {
		runtimeDir := filepath.Join(w.Store.Root, "runtime")
		if e := os.MkdirAll(runtimeDir, 0700); e != nil {
			return e
		}
		dir, e := os.MkdirTemp(runtimeDir, "align-")
		if e != nil {
			return e
		}
		defer os.RemoveAll(dir)
		voice, e := w.separatedVocals(ctx, s, model, id, path, dir)
		if e != nil {
			return e
		}
		language := alignLanguage(lyrics)
		spans := voicedSpans(voice, alignRate)
		groups := groupLines(lines, spans, len(voice))
		var words []schema.LyricWord
		for j, g := range groups {
			w.progress(msg.ActivityAlignLyrics, msg.Params{"done": j + 1, "total": len(groups)}, int64(j), int64(len(groups)))
			// 只把有人声的部分接起来送去对齐：间奏和长停顿去掉后，字不会被对到没人唱的地方，音频也更短。
			pieces := clipSpans(spans, g.from, g.to)
			if spanLength(pieces, g.from, g.to) < alignRate/2 {
				pieces = [][2]int{{g.from, min(g.to, g.from+int(alignChunkSeconds*alignRate))}}
			}
			// 一行本身就超过上限（极少见）时只送前面一段，避免整次对齐被模型拒绝。
			pieces = trimSpans(pieces, int(alignChunkSeconds*alignRate))
			var joined []float32
			for _, p := range pieces {
				joined = append(joined, voice[p[0]:p[1]]...)
			}
			if len(joined) < alignRate/10 {
				continue
			}
			part := filepath.Join(dir, "part.wav")
			if e = audio.WriteMono(part, joined, alignRate); e != nil {
				return e
			}
			aligned, e := w.engine.AlignWords(ctx, *s.RuntimePath, model, s.Preferences.Backend, part, alignText(g.text, language), language, func(code msg.Code, params msg.Params) {})
			if e != nil {
				return e
			}
			for _, a := range aligned {
				start, end := sourceTime(pieces, a.Start, false), sourceTime(pieces, max(a.Start, a.End), true)
				words = append(words, schema.LyricWord{Word: a.Word, Start: round3(start), End: round3(max(start, end))})
			}
		}
		if len(words) == 0 {
			return msg.Err(msg.ErrAlignEmpty, nil)
		}
		diag.Log(w.Store.Root, "lyrics.aligned", "generation_id", id, "chunks", len(groups), "words", len(words), "language", language)
		return w.Store.Update(func(s *schema.State) {
			for i := range s.History {
				if s.History[i].ID == id {
					s.History[i].LyricWords, s.History[i].LyricTimes = words, nil
				}
			}
		}, true)
	}, "", generation.Settings.ID)
	if e == nil {
		_ = w.Store.Update(func(s *schema.State) {
			if s.Activity != nil {
				s.Activity.Task = "align"
			}
		}, false)
	}
	return e
}

// separatedVocals 返回这首歌 16 kHz 的人声。分离最耗时，结果缓存在 runtime 下，同一版本重新对齐时直接复用；
// 只保留最近一首的缓存，换一首时删掉旧的。
func (w *Workbench) separatedVocals(ctx context.Context, s schema.State, model schema.InstalledModel, id, path, dir string) ([]float32, error) {
	runtimeDir := filepath.Join(w.Store.Root, "runtime")
	cache := filepath.Join(runtimeDir, "align-vocals-"+id+".wav")
	if samples, rate, e := audio.ReadMono(cache); e == nil && rate == alignRate {
		return samples, nil
	}
	old, _ := filepath.Glob(filepath.Join(runtimeDir, "align-vocals-*.wav"))
	for _, f := range old {
		_ = os.Remove(f)
	}
	progress := func(code msg.Code, params msg.Params) { w.progress(code, params, 0, 1) }
	samples, rate, e := audio.ReadMono(path)
	if e != nil {
		return nil, e
	}
	mix, vocals := filepath.Join(dir, "mix.wav"), filepath.Join(dir, "vocals.wav")
	if e = audio.WriteMono(mix, audio.Resample(samples, rate, separateRate), separateRate); e != nil {
		return nil, e
	}
	if e = w.engine.SeparateVocals(ctx, *s.RuntimePath, model, s.Preferences.Backend, mix, vocals, progress); e != nil {
		return nil, e
	}
	if samples, rate, e = audio.ReadMono(vocals); e != nil {
		return nil, e
	}
	voice := audio.Resample(samples, rate, alignRate)
	if e = audio.WriteMono(cache, voice, alignRate); e != nil {
		// 缓存只是加速，写不进去就不留半个文件，下次重新分离。
		_ = os.Remove(cache)
		diag.Log(w.Store.Root, "align.cache_write_failed", "error", diag.Error(e))
	}
	return voice, nil
}

// alignGroup 是一次送去对齐的几行歌词和对应的人声样本范围。
type alignGroup struct {
	text     string
	from, to int
}

// groupLines 把歌词行按顺序分组，每组的人声（去掉长空白后）不超过 alignChunkSeconds。组与组的切点取两行之间、
// 离估计位置最近的人声空隙，估计的行时间稍有偏差也不会把一个字切成两半。唱的部分整首都不超过上限时只有一组。
func groupLines(lines []LyricLine, spans [][2]int, total int) []alignGroup {
	limit := int(alignChunkSeconds * alignRate)
	whole := func() []alignGroup {
		texts := make([]string, len(lines))
		for i, l := range lines {
			texts[i] = l.Text
		}
		return []alignGroup{{strings.Join(texts, "\n"), 0, total}}
	}
	if spanLength(spans, 0, total) <= limit || len(lines) < 2 {
		return whole()
	}
	// cuts[i] 是第 i 行和第 i+1 行之间的切点（样本）。
	cuts := make([]int, len(lines)-1)
	for i := range cuts {
		at := (lines[i].End + lines[i+1].Start) / 2
		cuts[i] = snapToGap(spans, min(total, max(0, int(at*alignRate))), 4*alignRate)
		if i > 0 {
			cuts[i] = max(cuts[i], cuts[i-1])
		}
	}
	var groups []alignGroup
	first, from := 0, 0
	for i := range lines {
		end := total
		if i < len(cuts) {
			end = cuts[i]
		}
		// 加上下一行就超过上限时，在这一行后面切开。
		next := total
		if i+1 < len(cuts) {
			next = cuts[i+1]
		}
		if i == len(lines)-1 || spanLength(spans, from, next) > limit {
			texts := make([]string, 0, i-first+1)
			for _, l := range lines[first : i+1] {
				texts = append(texts, l.Text)
			}
			groups = append(groups, alignGroup{strings.Join(texts, "\n"), from, end})
			first, from = i+1, end
		}
	}
	return groups
}

// snapToGap 把切点挪到 window 范围内最近的人声空隙中点；附近没有空隙时保持原位。
func snapToGap(spans [][2]int, at, window int) int {
	best, distance := at, window+1
	for k := 0; k+1 < len(spans); k++ {
		if mid := (spans[k][1] + spans[k+1][0]) / 2; abs(mid-at) < distance {
			best, distance = mid, abs(mid-at)
		}
	}
	return best
}

// trimSpans 截掉总长超过 limit 个样本的部分。
func trimSpans(spans [][2]int, limit int) [][2]int {
	var out [][2]int
	for _, sp := range spans {
		if limit <= 0 {
			break
		}
		n := min(sp[1]-sp[0], limit)
		out = append(out, [2]int{sp[0], sp[0] + n})
		limit -= n
	}
	return out
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

// round3 保留到毫秒，状态文件里不写无意义的长小数。
func round3(v float64) float64 { return math.Round(v*1000) / 1000 }

// 人声检测：20 ms 一帧，响度低于全曲较响部分 30 dB 的算空白；短于 voicedGap 的停顿并入演唱，
// 每段前后各留 voicedPad 余量，避免切掉字头和尾音。返回有人声的样本区间。
const voicedGap, voicedPad = .8, .3

func voicedSpans(samples []float32, rate int) [][2]int {
	frame := rate / 50
	if frame <= 0 || len(samples) < frame {
		return nil
	}
	levels := make([]float64, len(samples)/frame)
	for i := range levels {
		var sum float64
		for _, v := range samples[i*frame : (i+1)*frame] {
			sum += float64(v) * float64(v)
		}
		levels[i] = math.Sqrt(sum / float64(frame))
	}
	sorted := slices.Clone(levels)
	slices.Sort(sorted)
	threshold := max(sorted[len(sorted)*95/100]*.03, 1e-4)
	var spans [][2]int
	gap, pad := int(voicedGap*float64(rate)), int(voicedPad*float64(rate))
	for i := 0; i < len(levels); {
		if levels[i] < threshold {
			i++
			continue
		}
		j := i
		for j < len(levels) && levels[j] >= threshold {
			j++
		}
		start, end := max(0, i*frame-pad), min(len(samples), j*frame+pad)
		if n := len(spans); n > 0 && start-spans[n-1][1] < gap {
			spans[n-1][1] = end
		} else {
			spans = append(spans, [2]int{start, end})
		}
		i = j
	}
	return spans
}

// clipSpans 取出落在 [from, to) 里的人声区间。
func clipSpans(spans [][2]int, from, to int) [][2]int {
	var out [][2]int
	for _, s := range spans {
		if a, b := max(s[0], from), min(s[1], to); b > a {
			out = append(out, [2]int{a, b})
		}
	}
	return out
}

// spanLength 是 [from, to) 里人声区间的总样本数。
func spanLength(spans [][2]int, from, to int) int {
	n := 0
	for _, s := range clipSpans(spans, from, to) {
		n += s[1] - s[0]
	}
	return n
}

// sourceTime 把拼接后音频里的时间（秒）换回原曲时间。正好落在两段交界时，开始时间算后一段，结束时间算前一段。
func sourceTime(pieces [][2]int, seconds float64, end bool) float64 {
	at := int(math.Round(seconds * alignRate))
	for _, p := range pieces {
		n := p[1] - p[0]
		if at < n || (end && at == n) {
			return float64(p[0]+max(0, at)) / alignRate
		}
		at -= n
	}
	last := pieces[len(pieces)-1]
	return float64(last[1]) / alignRate
}

// alignText 整理送去对齐的歌词。对齐模型除中文外按空格分词，日文歌词通常不带空格，整句会被当成一个词，
// 所以日文在每个假名和汉字之间加空格，逐字给出时间。
func alignText(text, language string) string {
	if language != "Japanese" {
		return text
	}
	var b strings.Builder
	for _, r := range text {
		if unicode.In(r, unicode.Hiragana, unicode.Katakana, unicode.Han) {
			b.WriteRune(' ')
			b.WriteRune(r)
			b.WriteRune(' ')
		} else {
			b.WriteRune(r)
		}
	}
	return b.String()
}
