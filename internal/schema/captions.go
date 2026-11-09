package schema

import (
	"fmt"
	"math"
	"regexp"
	"strings"
	"unicode"
	"yovoice/internal/msg"
)

// Caption 是导出用的一行字幕，时间以秒计；Speaker 只在故事配音按说话人导出时使用。
type Caption struct {
	Start   float64 `json:"start"`
	End     float64 `json:"end"`
	Text    string  `json:"text"`
	Speaker string  `json:"speaker,omitempty"`
}

// CaptionRules 是逐词时间分成字幕行的规则：每行最大宽度（中日韩一字算 1，其他字符算半个）、最长秒数与换行停顿。
type CaptionRules struct {
	Width   float64
	Seconds float64
	Pause   float64
}

// DefaultCaptionRules 是语音版本导出字幕与转写的默认断句规则。
var DefaultCaptionRules = CaptionRules{Width: TranscribeLineCharsDefault, Seconds: TranscribeLineSecondsDefault, Pause: TranscribeLinePauseDefault}

// CaptionRules 返回设置里的转写断句规则，未设置的项用默认值。
func (t *TranscribeSettings) CaptionRules() CaptionRules {
	r := DefaultCaptionRules
	if t == nil {
		return r
	}
	if t.LineChars != 0 {
		r.Width = float64(t.LineChars)
	}
	if t.LineSeconds != 0 {
		r.Seconds = t.LineSeconds
	}
	if t.LinePause != 0 {
		r.Pause = t.LinePause
	}
	return r
}

// markupTag 是正文里给模型的方括号标记（如 [laugh]、[breath]），不念出来，也不进字幕。
var markupTag = regexp.MustCompile(`\[[^\[\]\n]{1,40}\]`)

// SpokenText 返回正文实际念出的部分：去掉给模型的方括号标记，与对齐时用的文字一致。
func SpokenText(text string) string {
	return strings.TrimSpace(markupTag.ReplaceAllString(text, ""))
}

var (
	sentenceEnd = regexp.MustCompile(`[。！？!?；;…]|\.(\s|$)`)
	clauseEnd   = regexp.MustCompile(`[，,、：:—]`)
	captionTail = regexp.MustCompile(`^[^\p{L}\p{N}\n]*`)
	tidySpace   = regexp.MustCompile(`[\s\p{Zs}]+`)
	tidyHead    = regexp.MustCompile(`^[\s，,、。.；;：:！!？?]+`)
	tidyEnd     = regexp.MustCompile(`[\s，,、。；;：:]+$`)
	tidyPeriod  = regexp.MustCompile(`([^.\s])\.$`)
)

func wideRune(r rune) bool {
	return unicode.In(r, unicode.Han, unicode.Hiragana, unicode.Katakana, unicode.Hangul)
}

func captionWidth(text string) float64 {
	sum := 0.0
	for _, r := range text {
		switch {
		case wideRune(r):
			sum++
		case unicode.IsSpace(r):
			sum += .25
		default:
			sum += .5
		}
	}
	return sum
}

// tidyCaption 合并空白，行首去掉标点，行尾只保留问号、感叹号、省略号和引号括号。
func tidyCaption(text string) string {
	text = strings.TrimSpace(tidySpace.ReplaceAllString(text, " "))
	text = tidyHead.ReplaceAllString(text, "")
	text = tidyEnd.ReplaceAllString(text, "")
	return tidyPeriod.ReplaceAllString(text, "$1")
}

// WordCaptions 把逐词时间分成字幕行：识别与对齐给出的词不带标点，按顺序在原文里找到每个词的位置，字幕文字取原文（保留标点），
// 在句末标点、过长、过久或较长停顿处换行。因过长、过久或停顿换行时，若这一句只剩一两个字（如“事情”的“情”），并进当前行，不单独成行。
// 原文里找不到这些词时直接拼接词本身。相邻两行不重叠。
func WordCaptions(text string, words []LyricWord, rules CaptionRules) []Caption {
	if len(words) == 0 {
		return []Caption{}
	}
	source := []rune(text)
	lower := make([]rune, len(source))
	for i, r := range source {
		lower[i] = unicode.ToLower(r)
	}
	// 每个词在原文里的范围；找不到（识别或对齐改了写法）或离上一个词太远时沿用上一个词的结尾。
	cursor := 0
	spans := make([][2]int, len(words))
	located := false
	for i, w := range words {
		at := -1
		if w.Word != "" {
			at = indexRunes(lower, []rune(strings.ToLower(w.Word)), cursor)
		}
		if at < 0 || at-cursor > 40 {
			spans[i] = [2]int{cursor, cursor}
			continue
		}
		cursor = at + len([]rune(w.Word))
		spans[i] = [2]int{at, cursor}
		located = true
	}
	// 每个词之后到下一个词之前的原文（标点、空白）。
	gaps := make([]string, len(words))
	for i := range words {
		end := len(source)
		if i+1 < len(words) {
			end = spans[i+1][0]
		}
		if from := spans[i][1]; from < end {
			gaps[i] = string(source[from:end])
		}
	}
	join := func(from, to int) string {
		if located {
			if spans[from][0] >= spans[to][1] {
				return ""
			}
			return string(source[spans[from][0]:spans[to][1]])
		}
		parts := make([]string, 0, to-from+1)
		for _, w := range words[from : to+1] {
			parts = append(parts, w.Word)
		}
		separator := " "
		if strings.IndexFunc(words[from].Word, wideRune) >= 0 {
			separator = ""
		}
		return strings.Join(parts, separator)
	}
	// 从 j 起这一句（到标点、换行或较长停顿为止）的最后一个词。
	phraseEnd := func(j int) int {
		for j+1 < len(words) && !sentenceEnd.MatchString(gaps[j]) && !clauseEnd.MatchString(gaps[j]) && !strings.Contains(gaps[j], "\n") && words[j+1].Start-words[j].End <= rules.Pause {
			j++
		}
		return j
	}
	captions := []Caption{}
	first := 0
	for i := range words {
		between := gaps[i]
		last := i+1 >= len(words)
		current := captionWidth(join(first, i))
		if !(last || sentenceEnd.MatchString(between) || strings.Contains(between, "\n") || (clauseEnd.MatchString(between) && current >= rules.Width*.4)) {
			next := i + 1
			soft := captionWidth(join(first, next)) > rules.Width || words[next].End-words[first].Start > rules.Seconds || words[next].Start-words[i].End > rules.Pause
			if !soft {
				continue
			}
			rest := phraseEnd(next)
			if captionWidth(join(next, rest)) <= 2 && words[rest].End-words[first].Start <= rules.Seconds+4 {
				continue
			}
		}
		// 行尾带上紧跟的标点（问号、引号等），整理后为空的行（只有标点）并入时间但不出字幕。
		tail := ""
		if located {
			tail = captionTail.FindString(between)
		}
		if line := tidyCaption(join(first, i) + tail); line != "" {
			captions = append(captions, Caption{Start: words[first].Start, End: math.Max(words[i].End, words[first].Start+.2), Text: line})
		}
		first = i + 1
	}
	for i := 0; i+1 < len(captions); i++ {
		captions[i].End = math.Min(captions[i].End, captions[i+1].Start)
	}
	return captions
}

func indexRunes(haystack, needle []rune, from int) int {
	if len(needle) == 0 {
		return -1
	}
	for i := from; i+len(needle) <= len(haystack); i++ {
		match := true
		for j, r := range needle {
			if haystack[i+j] != r {
				match = false
				break
			}
		}
		if match {
			return i
		}
	}
	return -1
}

// captionClock 把秒数写成 时:分:秒 加毫秒，统一取整到毫秒，避免 59.9996 秒进位后出现 60 秒。
func captionClock(seconds float64, separator string) string {
	total := int64(math.Max(0, math.Round(seconds*1000)))
	return fmt.Sprintf("%02d:%02d:%02d%s%03d", total/3600000, total/60000%60, total/1000%60, separator, total%1000)
}

var (
	cueBreaks = regexp.MustCompile(`\r\n?`)
	cueBlank  = regexp.MustCompile(`\n\s*\n+`)
	vttEscape = strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;")
)

// cueText 把空行合并为单个换行，空行会提前结束字幕块。
func cueText(text string) string {
	return cueBlank.ReplaceAllString(cueBreaks.ReplaceAllString(text, "\n"), "\n")
}

// FormatCaptions 把字幕写成 srt、vtt 或 txt（每行一句）。withSpeaker 时 SRT 在行首写“名字: ”，WebVTT 用 <v 名字> 标出说话人。
func FormatCaptions(captions []Caption, format string, withSpeaker bool) (string, error) {
	var b strings.Builder
	switch format {
	case "srt":
		for i, c := range captions {
			if i > 0 {
				b.WriteString("\n")
			}
			speaker := ""
			if withSpeaker && c.Speaker != "" {
				speaker = c.Speaker + ": "
			}
			fmt.Fprintf(&b, "%d\n%s --> %s\n%s%s\n", i+1, captionClock(c.Start, ","), captionClock(c.End, ","), speaker, cueText(c.Text))
		}
	case "vtt":
		b.WriteString("WEBVTT\n")
		for _, c := range captions {
			speaker := ""
			if withSpeaker && c.Speaker != "" {
				speaker = "<v " + strings.Join(strings.Fields(vttEscape.Replace(c.Speaker)), " ") + ">"
			}
			fmt.Fprintf(&b, "\n%s --> %s\n%s%s\n", captionClock(c.Start, "."), captionClock(c.End, "."), speaker, vttEscape.Replace(cueText(c.Text)))
		}
	case "txt":
		for _, c := range captions {
			b.WriteString(strings.TrimSpace(cueText(c.Text)) + "\n")
		}
	default:
		return "", msg.Err(msg.ErrRequestInvalid, nil)
	}
	return b.String(), nil
}
