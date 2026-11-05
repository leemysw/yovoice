package workbench

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
	"yovoice/internal/audio"
	"yovoice/internal/diag"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
	"yovoice/internal/score"
)

// 局部重唱：改了旋律谱或某段歌词后，只把改动的小节换成新唱的，其余部分逐采样保留原版本。
// YuE2 每次都按整份谱从头生成，所以先用改好的谱和原版本的种子整首唱一遍，再把改动的那几个小节截下来换进原版本。
// YuE2 的实际节奏和谱面有出入，接缝位置不按谱面时间硬切：先用色度特征把两版逐帧对齐，再把接缝挪到附近最安静的地方。

// resingMaxCost 是两版对齐后平均代价的上限；超过时两版差别太大，拼接会很突兀，改为提示整首重新生成。
const resingMaxCost = 0.6

// resingSpan 是一段连续要重唱的小节（1 起，含两端）。
type resingSpan struct{ first, last int }

// ResingGeneration 按作品 d 当前的谱和歌词，只重唱版本 id 里改动的小节，结果存成同一作品的新版本。
// bars 不为空时（1 起的首尾小节）也一并重唱，用于只改风格、谱没变的段落。
func (w *Workbench) ResingGeneration(id string, d schema.Draft, bars []int) error {
	if !schema.ValidID(id) {
		return msg.Err(msg.ErrAudioIDInvalid, nil)
	}
	w.edit.Lock()
	defer w.edit.Unlock()
	d.Normalize()
	s := w.Store.Read()
	i := slices.IndexFunc(s.History, func(g schema.Generation) bool { return g.ID == id })
	if i < 0 {
		return msg.Err(msg.ErrAudioMissing, nil)
	}
	source := s.History[i]
	if source.StemOf != "" || source.Segment != nil || !isYuE(source.Settings.ModelID) || !isYuE(d.ModelID) ||
		strings.TrimSpace(source.Settings.Abc) == "" || strings.TrimSpace(d.Abc) == "" || source.Settings.ID != d.ID || yueMode(d) == "off" {
		return msg.Err(msg.ErrResingSource, nil)
	}
	spans, e := resingSpans(source.Settings, d, bars)
	if e != nil {
		return e
	}
	parts, e := w.prepareSynthesis(d, s)
	if e != nil {
		return e
	}
	if !RuntimeReady(s) {
		return msg.Err(msg.ErrRuntimeRequired, nil)
	}
	part := parts[0]
	if e = modelEngineReady(s, part.model.ID); e != nil {
		return e
	}
	if installing(s, part.model.ID) {
		return msg.Err(msg.ErrBusy, nil)
	}
	// 用原版本的种子：整首重唱的结果和原版本越像，对齐越稳，接缝越自然。
	seed := source.Seed
	if seed == nil {
		seed = source.Settings.Seed
	}
	if seed != nil {
		value := *seed
		part.draft.Seed = &value
	}
	original, e := w.MediaFile("outputs", id)
	if e != nil {
		return e
	}
	parsed, e := score.ParseABC(d.Abc)
	if e != nil {
		return msg.Err(msg.ErrMelodyInvalid, nil)
	}
	if e = w.saveDraft(d); e != nil {
		return e
	}
	_, e = w.start("generate", msg.ActivityResing, nil, &part.model.ID, func(ctx context.Context) error {
		dir, e := w.workDir("resing-")
		if e != nil {
			return e
		}
		defer os.RemoveAll(dir)
		take := filepath.Join(dir, "take.wav")
		if _, e = w.engine.Generate(ctx, *s.RuntimePath, part.model, s.Preferences.Backend, performanceFirst(s), part.draft, part.voice, part.emotion, take, func(code msg.Code, params msg.Params) { w.progress(code, params, 0, 1) }); e != nil {
			return e
		}
		if e = ctx.Err(); e != nil {
			return e
		}
		result, e := spliceTake(w.Store.Root, dir, original, take, parsed, spans)
		if e != nil {
			return e
		}
		duration, e := audio.Duration(result)
		if e != nil {
			return e
		}
		newID := schema.NewID()
		file := outputFileName(newID, time.Now(), outputSummary(d.Text, d.Title))
		path, e := w.Store.MediaPath("outputs", file)
		if e != nil {
			return e
		}
		if e = os.Rename(result, path); e != nil {
			return e
		}
		snapshot := d
		snapshot.Timeline = nil
		g := schema.Generation{ID: newID, Title: d.Title, FileName: file, CreatedAt: time.Now().UTC(), Duration: duration, Settings: snapshot, Seed: part.draft.Seed,
			PatchOf: id, PatchBars: []int{spans[0].first, spans[len(spans)-1].last}, Check: w.checkAudio(path, projectKind(d), newID)}
		if e = w.Store.Update(func(s *schema.State) { s.History = append([]schema.Generation{g}, s.History...) }, true); e != nil {
			_ = os.Remove(path)
			return e
		}
		diag.Log(w.Store.Root, "generation.resung", "project_id", d.ID, "source_id", id, "generation_id", newID, "spans", len(spans))
		return nil
	}, "", d.ID)
	return e
}

// spliceTake 把整首重唱 take 里对应 spans 的部分依次换进 original，返回结果文件路径。
func spliceTake(root, dir, original, take string, parsed *score.ABCScore, spans []resingSpan) (string, error) {
	a, rate, e := audio.ReadMono(original)
	if e != nil {
		return "", e
	}
	b, rateB, e := audio.ReadMono(take)
	if e != nil {
		return "", e
	}
	fa, fb := audio.AlignFeatures(a, rate), audio.AlignFeatures(b, rateB)
	path, cost := audio.Align(fa, fb)
	diag.Log(root, "resing.aligned", "cost", cost, "frames", len(fa))
	if path == nil || cost > resingMaxCost {
		return "", msg.Err(msg.ErrResingAlign, nil)
	}
	// 谱面时间按原版本里有声音的部分线性换算成音频时间，再在附近找最安静的地方下刀。
	start, end := audibleRange(fa)
	scale := (end - start) / max(parsed.Seconds(), 1)
	current := original
	// 从后往前换：换后面的段落不会挪动前面段落的时间。
	for k := len(spans) - 1; k >= 0; k-- {
		from, _ := parsed.BarSeconds(spans[k].first)
		_, to := parsed.BarSeconds(spans[k].last)
		t0 := audio.QuietestSecond(fa, start+from*scale-0.8, start+from*scale+0.2)
		t1 := audio.QuietestSecond(fa, start+to*scale-0.2, start+to*scale+0.8)
		if t1 <= t0 {
			return "", msg.Err(msg.ErrResingAlign, nil)
		}
		u0 := audio.QuietestSecond(fb, audio.MapSecond(path, t0)-0.3, audio.MapSecond(path, t0)+0.3)
		u1 := audio.QuietestSecond(fb, audio.MapSecond(path, t1)-0.3, audio.MapSecond(path, t1)+0.3)
		if u1 <= u0 {
			return "", msg.Err(msg.ErrResingAlign, nil)
		}
		next := filepath.Join(dir, "splice-"+string(rune('a'+k))+".wav")
		if e = audio.Splice(current, take, next, audio.SpliceRange{From: t0, To: t1, SourceFrom: u0, SourceTo: u1}, 0.08); e != nil {
			return "", e
		}
		current = next
	}
	return current, nil
}

// audibleRange 是有声音的第一帧和最后一帧的时间（秒）。
func audibleRange(frames []audio.AlignFrame) (float64, float64) {
	first, last := 0, len(frames)-1
	for first < last && frames[first].Level < -45 {
		first++
	}
	for last > first && frames[last].Level < -45 {
		last--
	}
	return float64(first) * audio.AlignSeconds, float64(last+1) * audio.AlignSeconds
}

// resingSpans 比较原版本和当前作品的谱与歌词，得到要重唱的连续小节段；速度、调或小节数变了只能整首重新生成。
func resingSpans(before, after schema.Draft, extra []int) ([]resingSpan, error) {
	old, e := score.ParseABC(before.Abc)
	if e != nil {
		return nil, msg.Err(msg.ErrResingSource, nil)
	}
	cur, e := score.ParseABC(after.Abc)
	if e != nil {
		return nil, msg.Err(msg.ErrMelodyInvalid, nil)
	}
	changes := score.CompareABC(old, cur)
	if changes.Tempo || changes.Key || changes.Bars[0] != changes.Bars[1] || before.Instrumental != after.Instrumental {
		return nil, msg.Err(msg.ErrResingWhole, nil)
	}
	bars := cur.Bars()
	changed := map[int]bool{}
	for _, list := range [][]int{changes.Vocal, changes.Ins, changes.Chords} {
		for _, bar := range list {
			changed[bar] = true
		}
	}
	// 歌词按 [Verse] 这类段落标记分段，和谱里的段落一一对应；改了哪段就重唱那段的全部小节。
	oldLyrics, newLyrics := lyricSections(before.Lyrics), lyricSections(after.Lyrics)
	if !slices.Equal(oldLyrics, newLyrics) {
		if len(oldLyrics) != len(newLyrics) || len(newLyrics) != len(cur.Sections) {
			return nil, msg.Err(msg.ErrResingWhole, nil)
		}
		for k := range newLyrics {
			if oldLyrics[k] == newLyrics[k] {
				continue
			}
			first, last := cur.Sections[k].Bar, bars
			if k+1 < len(cur.Sections) {
				last = cur.Sections[k+1].Bar - 1
			}
			for bar := first; bar <= last; bar++ {
				changed[bar] = true
			}
		}
	}
	if len(extra) == 2 {
		if extra[0] < 1 || extra[1] < extra[0] || extra[1] > bars {
			return nil, msg.Err(msg.ErrRequestInvalid, nil)
		}
		for bar := extra[0]; bar <= extra[1]; bar++ {
			changed[bar] = true
		}
	} else if len(extra) != 0 {
		return nil, msg.Err(msg.ErrRequestInvalid, nil)
	}
	var spans []resingSpan
	for bar := 1; bar <= bars; bar++ {
		if !changed[bar] {
			continue
		}
		// 相隔一个小节以内的改动并成一段，免得接缝太密。
		if n := len(spans); n > 0 && bar-spans[n-1].last <= 2 {
			spans[n-1].last = bar
			continue
		}
		spans = append(spans, resingSpan{bar, bar})
	}
	if len(spans) == 0 {
		return nil, msg.Err(msg.ErrResingNoChange, nil)
	}
	return spans, nil
}

// lyricSections 按独占一行的 [段落] 标记切分歌词，每段去掉首尾空白；标记前的文字算作第一段。
func lyricSections(lyrics string) []string {
	var out []string
	var b strings.Builder
	started := false
	flush := func() {
		if started || strings.TrimSpace(b.String()) != "" {
			out = append(out, strings.TrimSpace(b.String()))
		}
		b.Reset()
	}
	for _, line := range strings.Split(strings.ReplaceAll(lyrics, "\r\n", "\n"), "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "[") && strings.HasSuffix(trimmed, "]") {
			flush()
			started = true
			b.WriteString(trimmed + "\n")
			continue
		}
		b.WriteString(trimmed + "\n")
	}
	flush()
	return out
}

func yueMode(d schema.Draft) string {
	mode, _ := d.ModelOptions["yue2"]["cot"].(string)
	return mode
}
