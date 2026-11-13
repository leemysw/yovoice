package workbench

import (
	"context"
	"math"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
	"unicode"
	"yovoice/internal/audio"
	"yovoice/internal/catalog"
	"yovoice/internal/diag"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
)

// 逐字对齐：Qwen3 Forced Aligner 的音频编码器最多 1500 个位置，每秒约 13 个，一次只能对齐约 115 秒；
// 每段人声控制在 alignChunkSeconds 以内，留出余量。整首长度设上限，避免误传超长音频。
const alignChunkSeconds, maxAlignSeconds = 100.0, 1200.0

// BS-RoFormer 只接受 44.1 kHz 输入；对齐模型使用 16 kHz。
const separateRate, alignRate = 44100, 16000

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

// AlignLyrics 用可选下载的歌词对齐模型给一个生成版本做逐字对齐：先取得人声（分轨里的人声轨、缓存，或用 BS-RoFormer 现分离），
// 再按行顺序分段，逐段用 Qwen3 Forced Aligner 把歌词对到人声上，最后把落在静音里的字头字尾收到有声处。
// 结果写进 LyricWords 并替换手动校准。
func (w *Workbench) AlignLyrics(id string) error {
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
	lyrics := sungLyrics(generation.Settings)
	if lyrics == "" {
		return msg.Err(msg.ErrAlignLyrics, nil)
	}
	if generation.Duration > maxAlignSeconds {
		return msg.Err(msg.ErrAudioDuration, nil)
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
		began := time.Now()
		voice, source, e := w.separatedVocals(ctx, s, model, id, path, dir)
		if e != nil {
			return e
		}
		separated := time.Since(began)
		a := w.newAligner(ctx, s, model, voice, alignLanguage(lyrics), dir, msg.ActivityAlignLyrics)
		words, e := a.sequential(strings.Split(lyrics, "\n"))
		if e != nil {
			return e
		}
		if len(words) == 0 {
			return msg.Err(msg.ErrAlignEmpty, nil)
		}
		tidyWords(words, voicedFrames(voice, alignRate))
		diag.Log(w.Store.Root, "lyrics.aligned", "generation_id", id, "words", len(words), "language", a.language, "vocals", source, "requests", a.requests,
			"separate_ms", separated.Milliseconds(), "align_ms", (time.Since(began) - separated).Milliseconds())
		return w.Store.Update(func(s *schema.State) {
			for i := range s.History {
				if s.History[i].ID == id {
					s.History[i].LyricWords, s.History[i].LyricTimes = words, nil
				}
			}
		}, true)
	}, "", generation.Settings.ID)
	if e == nil {
		w.tagActivity("align")
	}
	return e
}

// wordAligner 是一次逐字对齐（歌词或语音正文）的上下文：16 kHz 音频、其中有声的区间和对齐语言；
// code 是带 done/total 的进度消息，requests 记下发给对齐模型的次数。
type wordAligner struct {
	w        *Workbench
	ctx      context.Context
	s        schema.State
	model    schema.InstalledModel
	voice    []float32
	spans    [][2]int
	language string
	dir      string
	code     msg.Code
	requests int
	// done、total 用于进度：total 是预计的请求次数。
	done, total int
}

// newAligner 准备一次对齐；进度按预计的请求次数算，每段约 3/4 上限的有声音频。
func (w *Workbench) newAligner(ctx context.Context, s schema.State, model schema.InstalledModel, voice []float32, language, dir string, code msg.Code) *wordAligner {
	spans := voicedSpans(voice, alignRate)
	total := max(1, int(math.Ceil(float64(spanLength(spans, 0, len(voice)))/(.75*alignChunkSeconds*alignRate))))
	return &wordAligner{w: w, ctx: ctx, s: s, model: model, voice: voice, spans: spans, language: language, dir: dir, code: code, total: total}
}

// align 把 text 对到音频 [from, to)（样本）里有声的部分：间奏和长停顿去掉后再送去对齐，字不会被对到没声音的地方；
// 返回整段音频上的时间。有声部分太短时整段送去，超过上限时只送前面一段。
func (a *wordAligner) align(text string, from, to int) ([]schema.LyricWord, error) {
	a.done++
	a.w.progress(a.code, msg.Params{"done": min(a.done, a.total), "total": a.total}, int64(min(a.done, a.total)-1), int64(a.total))
	from, to = max(0, from), min(len(a.voice), to)
	pieces := clipSpans(a.spans, from, to)
	if spanLength(pieces, from, to) < alignRate/2 {
		pieces = [][2]int{{from, min(to, from+int(alignChunkSeconds*alignRate))}}
	}
	pieces = trimSpans(pieces, int(alignChunkSeconds*alignRate))
	var joined []float32
	for _, p := range pieces {
		joined = append(joined, a.voice[p[0]:p[1]]...)
	}
	if len(joined) < alignRate/10 {
		return nil, nil
	}
	part := filepath.Join(a.dir, "part.wav")
	if e := audio.WriteMono(part, joined, alignRate); e != nil {
		return nil, e
	}
	a.requests++
	aligned, e := a.w.engine.AlignWords(a.ctx, *a.s.RuntimePath, a.model, a.s.Preferences.Backend, part, alignText(text, a.language), a.language, func(msg.Code, msg.Params) {})
	if e != nil {
		return nil, e
	}
	words := make([]schema.LyricWord, 0, len(aligned))
	for _, w := range aligned {
		start, end := sourceTime(pieces, w.Start, false), sourceTime(pieces, max(w.Start, w.End), true)
		words = append(words, schema.LyricWord{Word: w.Word, Start: round3(start), End: round3(max(start, end))})
	}
	return words, nil
}

// sequential 按顺序一段一段对齐 texts（每项一行歌词或一句话）。有声部分整体不超过上限时一次对齐；更长时，每段放下估计约 3/4 上限
// 有声音频的几行，音频再多留 1/4 余量，对齐后只收下除最后一行外的各行（最后一行可能被挤压或拉长），下一段从收下的最后一行结束处接着对齐。
// 切点来自上一段的对齐结果，不靠按字数估算的时间，前面唱快唱慢、间奏长短都不会让后面的行错位。
func (a *wordAligner) sequential(texts []string) ([]schema.LyricWord, error) {
	limit, total := int(alignChunkSeconds*alignRate), len(a.voice)
	weights := lineWeights(texts)
	var words []schema.LyricWord
	for k, anchor := 0, 0; k < len(texts); {
		rest := spanLength(a.spans, anchor, total)
		m, to, last := len(texts), total, rest <= limit
		if !last {
			// 剩下的人声按音节数分给剩下的各行，估计每行唱多久；至少放两行，最后一行才能丢掉重来。
			remaining := 0.0
			for _, v := range weights[k:] {
				remaining += v
			}
			per, sum := float64(rest)/remaining, 0.0
			for m = k; m < len(texts) && (m < k+2 || sum+weights[m]*per <= .75*float64(limit)); m++ {
				sum += weights[m] * per
			}
			to = voicedAt(a.spans, anchor, min(limit, int(sum*1.25)+3*alignRate), total)
		}
		text := strings.Join(texts[k:m], "\n")
		got, e := a.align(text, anchor, to)
		if e != nil {
			return nil, e
		}
		own := lineOwners(texts[k:m], got)
		accept := m
		if !last && m-k > 1 {
			accept = m - 1
		}
		lastEnd, nextStart := -1.0, -1.0
		for j, w := range got {
			if o := own[j] + k; o < accept {
				words = append(words, w)
				lastEnd = max(lastEnd, w.End)
			} else if nextStart < 0 {
				nextStart = w.Start
			}
		}
		if accept >= len(texts) {
			break
		}
		switch {
		case lastEnd < 0:
			// 这一段一个字也没对上：从这段音频之后接着来。
			anchor = to
		case nextStart > lastEnd:
			anchor = int((lastEnd + nextStart) / 2 * alignRate)
		default:
			anchor = int(lastEnd * alignRate)
		}
		k = accept
	}
	return words, nil
}

// voicedAt 返回从 from 起累计 n 个有声样本时所在的样本位置；人声不够时返回 total。
func voicedAt(spans [][2]int, from, n, total int) int {
	for _, s := range clipSpans(spans, from, total) {
		if length := s[1] - s[0]; n <= length {
			return s[0] + n
		} else {
			n -= length
		}
	}
	return total
}

// lineWeights 估计每行唱的长短：中日韩每字一个音节，拉丁文按元音组数，至少 1。
func lineWeights(texts []string) []float64 {
	weights := make([]float64, len(texts))
	for i, t := range texts {
		n := 0
		for _, word := range strings.FieldsFunc(t, func(r rune) bool { return !unicode.IsLetter(r) && r != '\'' }) {
			cjk, other, vowels, inVowel := 0, 0, 0, false
			for _, r := range strings.ToLower(word) {
				if unicode.In(r, unicode.Han, unicode.Hiragana, unicode.Katakana, unicode.Hangul) {
					cjk, inVowel = cjk+1, false
					continue
				}
				other++
				vowel := strings.ContainsRune("aeiouyàâäéèêëîïôöùûü", r)
				if vowel && !inVowel {
					vowels++
				}
				inVowel = vowel
			}
			n += cjk + max(vowels, min(1, other))
		}
		weights[i] = float64(max(1, n))
	}
	return weights
}

// keptRune 是对齐模型清洗歌词后保留的字符（与界面的 alignedTimeline 一致）：ASCII 字母数字、撇号、拉丁扩展、希腊、西里尔、泰文、
// 假名、中日韩文字与谚文。
func keptRune(r rune) bool {
	return r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '\'' ||
		r >= 0xC0 && r <= 0x2AF || r >= 0x370 && r <= 0x3FF || r >= 0x400 && r <= 0x52F || r >= 0xE00 && r <= 0xE7F ||
		r >= 0x3040 && r <= 0x30FF || r >= 0x3400 && r <= 0x4DBF || r >= 0x4E00 && r <= 0x9FFF || r >= 0xAC00 && r <= 0xD7AF ||
		r >= 0xF900 && r <= 0xFAFF || r >= 0x20000 && r <= 0x2CEAF
}

// lineOwners 按字符顺序把对齐结果里的每个词归到所在的歌词行（下标对应 texts）；两边只数对齐模型保留的字符，
// 字数有出入时按比例对应，不含保留字符的词跟前一个字同行。
func lineOwners(texts []string, words []schema.LyricWord) []int {
	var lineOf []int
	for i, t := range texts {
		for _, r := range strings.ToLower(t) {
			if keptRune(r) {
				lineOf = append(lineOf, i)
			}
		}
	}
	sizes, total := make([]int, len(words)), 0
	for j, w := range words {
		for _, r := range strings.ToLower(w.Word) {
			if keptRune(r) {
				sizes[j]++
			}
		}
		total += sizes[j]
	}
	owner := make([]int, len(words))
	if len(lineOf) == 0 {
		return owner
	}
	for j, at := 0, 0; j < len(words); j++ {
		position := at
		if sizes[j] == 0 && at > 0 {
			// 不含保留字符的词（如标点）跟着前一个字，算在它那一行。
			position = at - 1
		}
		if total != len(lineOf) && total > 0 {
			position = position * len(lineOf) / total
		}
		owner[j] = lineOf[min(position, len(lineOf)-1)]
		at += sizes[j]
	}
	return owner
}

// 收拾字头字尾：字头落在静音里时往后挪到起唱处，字尾落在静音里时往前收到收声处，各最多 tidyReach 秒。
const tidyReach = .4

// voicedFrames 按 20 ms 一帧标出有人声的帧，短于 0.1 秒的停顿填平；不加前后余量。
func voicedFrames(samples []float32, rate int) []bool {
	levels, threshold := frameLevels(samples, rate)
	voiced := make([]bool, len(levels))
	for i, v := range levels {
		voiced[i] = v >= threshold
	}
	for i := 0; i < len(voiced); {
		if voiced[i] {
			i++
			continue
		}
		j := i
		for j < len(voiced) && !voiced[j] {
			j++
		}
		if i > 0 && j < len(voiced) && j-i <= 5 {
			for k := i; k < j; k++ {
				voiced[k] = true
			}
		}
		i = j
	}
	return voiced
}

// tidyWords 就地调整 words：字头、字尾落在静音里时挪到最近的有声处（不越过本字的另一端）。
func tidyWords(words []schema.LyricWord, voiced []bool) {
	const step = .02
	reach := int(tidyReach / step)
	at := func(f int) bool { return f >= 0 && f < len(voiced) && voiced[f] }
	for i := range words {
		s, e := int(words[i].Start/step), int(math.Ceil(words[i].End/step))-1
		if !at(s) {
			for k := 1; k <= reach && s+k < e; k++ {
				if at(s + k) {
					words[i].Start = round3(float64(s+k) * step)
					break
				}
			}
		}
		s = int(words[i].Start / step)
		if !at(e) {
			for k := 1; k <= reach && e-k > s; k++ {
				if at(e - k) {
					words[i].End = round3(float64(e-k+1) * step)
					break
				}
			}
		}
	}
}

// 分离出的人声缓存在 runtime 下（align-vocals-<版本>.wav），同一版本重新对齐时直接复用；只留最近对齐的 alignCacheKeep 个版本。
const alignCacheKeep = 8

// separatedVocals 返回这首歌 16 kHz 的人声和它的来源（cache、stems 或 separated）。这个版本分过轨时直接用分轨里的人声；
// 否则用 BS-RoFormer 单遍分离，送入原曲的立体声（人声多在声像正中，双声道分得更干净）。分离最耗时，结果按版本缓存。
func (w *Workbench) separatedVocals(ctx context.Context, s schema.State, model schema.InstalledModel, id, path, dir string) ([]float32, string, error) {
	runtimeDir := filepath.Join(w.Store.Root, "runtime")
	cache := filepath.Join(runtimeDir, "align-vocals-"+id+".wav")
	if samples, rate, e := audio.ReadMono(cache); e == nil && rate == alignRate {
		now := time.Now()
		_ = os.Chtimes(cache, now, now)
		return samples, "cache", nil
	}
	voice, source, e := w.extractVocals(ctx, s, model, id, path, dir)
	if e != nil {
		return nil, "", e
	}
	if e = audio.WriteMono(cache, voice, alignRate); e != nil {
		// 缓存只是加速，写不进去就不留半个文件，下次重新分离。
		_ = os.Remove(cache)
		diag.Log(w.Store.Root, "align.cache_write_failed", "error", diag.Error(e))
	}
	pruneAlignCache(runtimeDir)
	return voice, source, nil
}

// extractVocals 取得人声：优先用这个版本分轨得到的人声轨，没有时现分离。
func (w *Workbench) extractVocals(ctx context.Context, s schema.State, model schema.InstalledModel, id, path, dir string) ([]float32, string, error) {
	if i := slices.IndexFunc(s.History, func(g schema.Generation) bool { return g.StemOf == id && g.Stem == "vocals" }); i >= 0 {
		if stem, e := w.Store.MediaPath("outputs", s.History[i].FileName); e == nil {
			if samples, rate, e := audio.ReadMono(stem); e == nil {
				return audio.Resample(samples, rate, alignRate), "stems", nil
			}
		}
	}
	progress := func(code msg.Code, params msg.Params) { w.progress(code, params, 0, 1) }
	channels, rate, e := audio.Read(path)
	if e != nil {
		return nil, "", e
	}
	for c := range channels {
		channels[c] = audio.Resample(channels[c], rate, separateRate)
	}
	mix, vocals := filepath.Join(dir, "mix.wav"), filepath.Join(dir, "vocals.wav")
	if e = audio.Write(mix, channels, separateRate); e != nil {
		return nil, "", e
	}
	if e = w.engine.SeparateVocals(ctx, *s.RuntimePath, model, s.Preferences.Backend, mix, vocals, progress); e != nil {
		return nil, "", e
	}
	samples, rate, e := audio.ReadMono(vocals)
	if e != nil {
		return nil, "", e
	}
	return audio.Resample(samples, rate, alignRate), "separated", nil
}

// pruneAlignCache 只留最近用过的 alignCacheKeep 个人声缓存。
func pruneAlignCache(dir string) {
	files, _ := filepath.Glob(filepath.Join(dir, "align-vocals-*.wav"))
	if len(files) <= alignCacheKeep {
		return
	}
	modified := func(f string) time.Time {
		info, e := os.Stat(f)
		if e != nil {
			return time.Time{}
		}
		return info.ModTime()
	}
	slices.SortFunc(files, func(a, b string) int { return modified(b).Compare(modified(a)) })
	for _, f := range files[alignCacheKeep:] {
		_ = os.Remove(f)
	}
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

// round3 保留到毫秒，状态文件里不写无意义的长小数。
func round3(v float64) float64 { return math.Round(v*1000) / 1000 }

// frameLevels 按 20 ms 一帧算响度，返回各帧响度和人声门限：低于全曲较响部分 30 dB 的算空白。音频不足一帧时返回空。
func frameLevels(samples []float32, rate int) ([]float64, float64) {
	frame := rate / 50
	if frame <= 0 || len(samples) < frame {
		return nil, 0
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
	return levels, max(sorted[len(sorted)*95/100]*.03, 1e-4)
}

// 人声区间：短于 voicedGap 的停顿并入演唱，每段前后各留 voicedPad 余量，避免切掉字头和尾音。
const voicedGap, voicedPad = .8, .3

// voicedSpans 返回有人声的样本区间。
func voicedSpans(samples []float32, rate int) [][2]int {
	levels, threshold := frameLevels(samples, rate)
	frame := rate / 50
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
