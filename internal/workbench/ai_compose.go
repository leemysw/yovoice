package workbench

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"yovoice/internal/llm"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
)

// ScoreBrief 是“AI 写谱”的输入：一句话描述、目标时长（秒，0 表示由模型决定）和界面语言。
type ScoreBrief struct {
	Brief   string          `json:"brief"`
	Seconds int             `json:"seconds"`
	Locale  schema.UiLocale `json:"locale"`
}

const scorePrompt = `You are a film and video composer who writes arrangements as JSON for yovoice. yovoice renders every track with a General MIDI sound font and mixes tracks by role.

Return ONLY one JSON object, no prose, no Markdown:
{"tempo":100,"timeSignature":[4,4],"key":"D minor","sections":[{"name":"Intro","start":1,"end":4}],
 "tracks":[{"id":"piano","name":"Piano","role":"piano","program":0,"reverb":0.3,"pan":-0.1,
   "humanize":{"velocity":8,"timingMs":6},"dynamics":[{"start":1,"end":4,"from":0.5,"to":1}],
   "notes":[[1,1,62,1,80],[1,2,65,0.5,72]]}]}

Rules:
- notes are arrays [bar, beat, pitch, length, velocity]. bar and beat start at 1; beat may be fractional (1.5 = the off-beat of beat 1); beats are quarter notes (6/8 has 3 beats per bar); length is in beats; pitch is MIDI (60 = C4); velocity 1-127.
- program is a General MIDI number: 0 piano, 4 electric piano, 24 nylon guitar, 32 acoustic bass, 33 finger bass, 40 violin, 41 viola, 42 cello, 46 harp, 48 string ensemble, 52 choir, 56 trumpet, 60 french horn, 71 clarinet, 73 flute, 81 saw lead, 88 new age pad, 89 warm pad, 95 sweep pad. For drums set "drums":true and use pitches 36 kick, 38 snare, 37 side stick, 42 closed hat, 46 open hat, 49 crash, 51 ride.
- role is one of melody, piano, strings, bass, drums, pad, arp, other; it sets the default level (melody and piano in front, pad and arp behind). Do not set level unless needed.
- One instrument per track, 3-8 tracks, unique ids. Optional: pan -1..1, reverb 0..1, humanize {velocity 0-40, timingMs 0-50}, dynamics ramps {start bar, end bar, from 0-1, to 0-1}. Sections may set their own tempo for a slowdown.
- Plan a chord progression first, then write bass, pad, melody and rhythm parts that follow it. Shape the piece with sections: introduce and drop parts, use dynamics for builds.
- Keep it compact: at most 1500 notes in total. Sustained pads and long notes are cheaper than many short ones.
- Seconds = bars x beats per bar x 60 / tempo. Match the requested length within about 10%%.
- Write section and track names in %s.`

func scoreLanguage(locale schema.UiLocale) string {
	if locale == schema.UiLocaleZhCN {
		return "Simplified Chinese"
	}
	return "English"
}

// aiScore 接受紧凑的数组音符和完整的对象音符两种写法。
type aiScore struct {
	schema.Score
	Tracks []struct {
		schema.ScoreTrack
		Notes []json.RawMessage `json:"notes"`
	} `json:"tracks"`
}

func decodeScore(text string) (schema.Score, error) {
	raw := llm.ExtractJSON(text)
	if raw == "" {
		return schema.Score{}, errors.New("no JSON object found")
	}
	var v aiScore
	if e := json.Unmarshal([]byte(raw), &v); e != nil {
		return schema.Score{}, fmt.Errorf("invalid JSON: %v", e)
	}
	s := v.Score
	s.Tracks = nil
	for _, t := range v.Tracks {
		track := t.ScoreTrack
		track.Notes = make([]schema.ScoreNote, 0, len(t.Notes))
		for _, n := range t.Notes {
			var note schema.ScoreNote
			var values []float64
			if json.Unmarshal(n, &values) == nil {
				if len(values) != 5 {
					return schema.Score{}, fmt.Errorf("track %q: each note array needs exactly 5 numbers [bar, beat, pitch, length, velocity]", track.ID)
				}
				note = schema.ScoreNote{Bar: int(values[0]), Beat: values[1], Pitch: int(values[2]), Length: values[3], Velocity: int(values[4])}
			} else if e := json.Unmarshal(n, &note); e != nil {
				return schema.Score{}, fmt.Errorf("track %q: invalid note %s", track.ID, string(n))
			}
			track.Notes = append(track.Notes, note)
		}
		s.Tracks = append(s.Tracks, track)
	}
	if issue := schema.ScoreIssue(&s); issue != "" {
		return schema.Score{}, errors.New(issue)
	}
	return s, nil
}

// ComposeScore 让模型写出乐谱并校验；不合规时把问题发回让模型修正一次。
func (w *Workbench) ComposeScore(ctx context.Context, in ScoreBrief) (schema.Score, error) {
	brief := strings.TrimSpace(in.Brief)
	if brief == "" || schema.TextLen(brief) > 2000 || in.Seconds < 0 || in.Seconds > int(schema.ScoreMaxSeconds) {
		return schema.Score{}, msg.Err(msg.ErrRequestInvalid, nil)
	}
	ask := "Brief: " + brief
	if in.Seconds > 0 {
		ask += fmt.Sprintf("\nTarget length: about %d seconds.", in.Seconds)
	}
	request := llm.Request{System: fmt.Sprintf(scorePrompt, scoreLanguage(in.Locale)), Messages: []llm.Message{{Role: "user", Content: ask}}, MaxTokens: 16000, Temperature: 0.7}
	var issue string
	for attempt := 0; attempt < 2; attempt++ {
		result, e := w.complete(ctx, request)
		if e != nil {
			return schema.Score{}, e
		}
		var s schema.Score
		if result.Truncated {
			e = errors.New("output was cut off by the length limit")
		} else {
			s, e = decodeScore(result.Text)
		}
		if e == nil {
			return s, nil
		}
		issue = e.Error()
		fix := "Your score is invalid: " + issue + ". Return the complete corrected JSON only."
		if result.Truncated {
			fix = "Your output was cut off. Write a shorter score with fewer notes (use longer notes and fewer bars) and return complete JSON only."
		}
		request.Messages = append(request.Messages, llm.Message{Role: "assistant", Content: result.Text}, llm.Message{Role: "user", Content: fix})
	}
	return schema.Score{}, msg.Err(msg.ErrAIResultInvalid, msg.Params{"detail": issue})
}

// LyricsBrief 是“AI 写歌词”的输入。
type LyricsBrief struct {
	Brief        string          `json:"brief"`
	Instrumental bool            `json:"instrumental"`
	Language     string          `json:"language"`
	Locale       schema.UiLocale `json:"locale"`
}

// Lyrics 是写给音乐作品的风格描述与带段落标记的歌词。
type Lyrics struct {
	Title    string `json:"title"`
	Style    string `json:"style"`
	Lyrics   string `json:"lyrics"`
	Language string `json:"language"`
}

const lyricsPrompt = `You write songs for ACE-Step, a music generation model. Return ONLY one JSON object, no prose, no Markdown:
{"title":"...","style":"...","lyrics":"...","language":"zh"}

- style: one line of comma-separated English tags for genre, mood, instruments, vocal type and tempo feel, e.g. "city pop, nostalgic, warm synths, slap bass, female vocals, 100 bpm". At most 300 characters.
- lyrics: lines grouped under section markers on their own line: [intro], [verse], [pre-chorus], [chorus], [bridge], [outro]. Keep it singable: short lines, a memorable repeated chorus. At most 2500 characters.%s
- language: the ISO code of the sung language, one of zh, en, yue, ja, ko, es, fr, de, pt, ru, it.
- title in the sung language.`

// WriteLyrics 让模型写出风格描述与歌词；纯音乐只写风格与段落结构。
func (w *Workbench) WriteLyrics(ctx context.Context, in LyricsBrief) (Lyrics, error) {
	brief := strings.TrimSpace(in.Brief)
	if brief == "" || schema.TextLen(brief) > 2000 {
		return Lyrics{}, msg.Err(msg.ErrRequestInvalid, nil)
	}
	extra := ""
	if in.Instrumental {
		extra = "\n- This is an instrumental: leave lyrics empty except section markers describing the arrangement, e.g. [intro]\\n[verse]\\n[chorus]."
	}
	ask := "Song idea: " + brief
	if in.Language != "" && slices.Contains(schema.MusicLanguages, in.Language) {
		ask += "\nSung language: " + in.Language
	}
	result, e := w.complete(ctx, llm.Request{System: fmt.Sprintf(lyricsPrompt, extra), Messages: []llm.Message{{Role: "user", Content: ask}}, MaxTokens: 4000, Temperature: 0.9})
	if e != nil {
		return Lyrics{}, e
	}
	var l Lyrics
	if e = json.Unmarshal([]byte(llm.ExtractJSON(result.Text)), &l); e != nil || strings.TrimSpace(l.Style) == "" {
		return Lyrics{}, msg.Err(msg.ErrAIResultInvalid, msg.Params{"detail": "missing style"})
	}
	l.Title = truncateRunes(strings.TrimSpace(l.Title), 120)
	l.Style = truncateRunes(strings.TrimSpace(l.Style), 512)
	l.Lyrics = truncateRunes(strings.TrimSpace(l.Lyrics), 4000)
	if !slices.Contains(schema.MusicLanguages, l.Language) {
		l.Language = ""
	}
	return l, nil
}

func truncateRunes(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n])
	}
	return s
}
