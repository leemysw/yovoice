package workbench

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"yovoice/internal/llm"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
)

// 分角色的特殊说话人：旁白（含第一人称“我”）与无法判断的对白。
const (
	castNarrator = "@narrator"
	castUnknown  = "@unknown"
)

// CastLine 是书稿中的一句：Quote 为引号内对白，Speaker 是界面按规则给出的初判。
type CastLine struct {
	Text    string `json:"text"`
	Quote   bool   `json:"quote"`
	Speaker string `json:"speaker"`
}

type CastChapter struct {
	Title string     `json:"title"`
	Lines []CastLine `json:"lines"`
}

// CastVoice 是声音库里可供选角的角色。
type CastVoice struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

// CastBrief 是“AI 分角色”的输入：已拆好的章节与句子，以及可用的声音。
type CastBrief struct {
	Title    string          `json:"title"`
	Chapters []CastChapter   `json:"chapters"`
	Voices   []CastVoice     `json:"voices"`
	Locale   schema.UiLocale `json:"locale"`
}

// CastRole 是识别出的角色及其声音特征。
type CastRole struct {
	Name        string `json:"name"`
	Gender      string `json:"gender"`
	Age         string `json:"age"`
	Description string `json:"description"`
}

// Cast 是分角色结果：Lines 与输入逐句对应（旁白为空），Voices 把角色名映射到声音库角色。
type Cast struct {
	Lines  [][]string        `json:"lines"`
	Roles  []CastRole        `json:"roles"`
	Voices map[string]string `json:"voices"`
	// Failed 是模型输出无法使用、保留规则初判的段数。
	Failed int `json:"failed"`
}

// 每次请求发送的正文字数；整本书按句切成多段依次识别，并把已知角色带到下一段。
const castChunkRunes = 6000
const castMaxRunes = 1500000

const castPrompt = `You cast multi-voice audiobooks. You receive part of a book as numbered lines. Lines marked N are narration; lines marked Q are quoted speech. For every Q line decide which character speaks it, using the narration around it, dialogue turn-taking, and how characters address each other. A rule-based guess may follow "=>"; correct it when wrong.

Return ONLY one JSON object, no prose, no Markdown:
{"speakers":{"12":"Alice","13":"Bob"},"characters":[{"name":"Alice","gender":"female","age":"child","description":"curious, bright"}]}

- speakers: one entry for every Q line number.
- Use "@narrator" when the narrator speaks (the "I" of a first-person book), and "@unknown" only when the speaker truly cannot be inferred.
- One consistent name per character: reuse the known character names exactly, otherwise use the name the text uses most. Never invent names for unnamed passers-by; describe them briefly instead (e.g. "Old man").
- characters: every character who speaks in this part. gender: male, female or unknown. age: child, teen, young, adult or elder. description: voice and personality in %s, at most 20 characters.
- Write character names in the language of the book.`

const voicePrompt = `You cast voices for an audiobook. Match each book character to the best voice from the user's voice library, judging by gender, age and personality from the voice names and descriptions.

Return ONLY one JSON object, no prose, no Markdown: {"cast":{"@narrator":"<voice id>","Alice":"<voice id>"}}

- Use only the voice ids given. Give the main characters (listed first) different voices; minor characters may share. Leave a character out when no voice fits at all.
- "@narrator" reads all narration: prefer a calm, clear voice.`

func (in CastBrief) valid() bool {
	total, lines := 0, 0
	for _, c := range in.Chapters {
		lines += len(c.Lines)
		for _, l := range c.Lines {
			total += schema.TextLen(l.Text)
		}
	}
	return total > 0 && total <= castMaxRunes && lines <= 200000 && len(in.Voices) <= 500
}

// StartCast 在后台为整本书分角色，立即返回任务。
func (w *Workbench) StartCast(in CastBrief) (schema.AITask, error) {
	if !in.valid() {
		return schema.AITask{}, msg.Err(msg.ErrRequestInvalid, nil)
	}
	return w.startAI("cast", "", schema.TruncateRunes(strings.TrimSpace(in.Title), 120), func(ctx context.Context) (any, error) { return w.CastBook(ctx, in) })
}

type castRef struct{ chapter, line int }

// CastBook 分段识别每句对白的说话人并汇总角色，最后按角色特征从声音库选角。
// 单段输出无法使用时保留该段的规则初判，不让整本书失败。
func (w *Workbench) CastBook(ctx context.Context, in CastBrief) (Cast, error) {
	if !in.valid() {
		return Cast{}, msg.Err(msg.ErrRequestInvalid, nil)
	}
	result := Cast{Lines: make([][]string, len(in.Chapters)), Voices: map[string]string{}}
	var chunks [][]castRef
	var current []castRef
	size, quotes := 0, false
	for ci, c := range in.Chapters {
		result.Lines[ci] = make([]string, len(c.Lines))
		for li, l := range c.Lines {
			if l.Quote {
				result.Lines[ci][li] = l.Speaker
				if l.Speaker == "" {
					result.Lines[ci][li] = castNarrator
				}
			}
			current = append(current, castRef{ci, li})
			size += schema.TextLen(l.Text)
			quotes = quotes || l.Quote
			// 在段落边界附近切分：攒够字数后遇到旁白再断开，避免把一来一回的对话切开。
			if size >= castChunkRunes && !l.Quote {
				if quotes {
					chunks = append(chunks, current)
				}
				current, size, quotes = nil, 0, false
			}
		}
	}
	if quotes {
		chunks = append(chunks, current)
	}
	roles := map[string]*CastRole{}
	var order []string
	counts := map[string]int{}
	for i, chunk := range chunks {
		w.setAIProgress(i, len(chunks))
		speakers, characters, e := w.castChunk(ctx, in, chunk, order)
		if e != nil {
			if ctx.Err() != nil {
				return Cast{}, e
			}
			// 服务本身不可用时直接报错；只有输出格式问题才跳过这一段。
			var ce *msg.CallError
			if !(errors.As(e, &ce) && ce.Code == msg.ErrAIResultInvalid) {
				return Cast{}, e
			}
			result.Failed++
			continue
		}
		for _, ref := range chunk {
			if name, ok := speakers[ref]; ok {
				result.Lines[ref.chapter][ref.line] = name
			}
		}
		for _, c := range characters {
			if roles[c.Name] == nil {
				roles[c.Name] = &CastRole{Name: c.Name}
				order = append(order, c.Name)
			}
			r := roles[c.Name]
			r.Gender, r.Age, r.Description = cmpOr(c.Gender, r.Gender), cmpOr(c.Age, r.Age), cmpOr(c.Description, r.Description)
		}
	}
	if len(chunks) > 0 && result.Failed == len(chunks) {
		return Cast{}, msg.Err(msg.ErrAIResultInvalid, msg.Params{"detail": "no usable output"})
	}
	for ci := range result.Lines {
		for li, name := range result.Lines[ci] {
			if name == castNarrator {
				result.Lines[ci][li] = ""
			} else if name != "" {
				counts[name]++
			}
		}
	}
	// 角色按台词数排序，只保留确实说过话的；规则初判出的名字也补进角色表。
	for name := range counts {
		if roles[name] == nil && name != castUnknown {
			roles[name] = &CastRole{Name: name}
		}
	}
	for name, r := range roles {
		if counts[name] > 0 {
			result.Roles = append(result.Roles, *r)
		}
	}
	slices.SortStableFunc(result.Roles, func(a, b CastRole) int {
		if counts[a.Name] != counts[b.Name] {
			return counts[b.Name] - counts[a.Name]
		}
		return strings.Compare(a.Name, b.Name)
	})
	w.setAIProgress(len(chunks), len(chunks))
	if len(in.Voices) > 0 {
		voices, e := w.castVoices(ctx, in, result.Roles)
		if e != nil && ctx.Err() != nil {
			return Cast{}, e
		}
		// 选角失败不影响分角色结果，界面会按规则自动分配。
		if e == nil {
			result.Voices = voices
		}
	}
	return result, nil
}

func cmpOr(a, b string) string {
	if strings.TrimSpace(a) != "" {
		return strings.TrimSpace(a)
	}
	return b
}

type castReply struct {
	Speakers   map[string]string `json:"speakers"`
	Characters []CastRole        `json:"characters"`
}

// castChunk 识别一段的说话人；输出不合规时把问题发回让模型修正一次。
func (w *Workbench) castChunk(ctx context.Context, in CastBrief, chunk []castRef, known []string) (map[castRef]string, []CastRole, error) {
	var b strings.Builder
	if len(known) > 0 {
		fmt.Fprintf(&b, "Known characters: %s\n\n", strings.Join(known, ", "))
	}
	chapter := -1
	need := map[string]castRef{}
	for i, ref := range chunk {
		if ref.chapter != chapter {
			chapter = ref.chapter
			if t := strings.TrimSpace(in.Chapters[chapter].Title); t != "" {
				fmt.Fprintf(&b, "## %s\n", t)
			}
		}
		l := in.Chapters[ref.chapter].Lines[ref.line]
		text := strings.ReplaceAll(l.Text, "\n", " ")
		if !l.Quote {
			fmt.Fprintf(&b, "[%d] N: %s\n", i+1, text)
			continue
		}
		need[strconv.Itoa(i+1)] = ref
		guess := l.Speaker
		if guess == "" {
			guess = castNarrator
		}
		if guess == castUnknown {
			fmt.Fprintf(&b, "[%d] Q: %s\n", i+1, text)
		} else {
			fmt.Fprintf(&b, "[%d] Q: %s => %s\n", i+1, text, guess)
		}
	}
	request := llm.Request{System: fmt.Sprintf(castPrompt, scoreLanguage(in.Locale)), Messages: []llm.Message{{Role: "user", Content: b.String()}}, MaxTokens: 8000, Temperature: 0.2}
	var issue string
	for attempt := 0; attempt < 2; attempt++ {
		result, e := w.complete(ctx, request)
		if e != nil {
			return nil, nil, e
		}
		var reply castReply
		if result.Truncated {
			issue = "output was cut off"
		} else if e = json.Unmarshal([]byte(llm.ExtractJSON(result.Text)), &reply); e != nil || reply.Speakers == nil {
			issue = "missing speakers"
		} else {
			speakers := map[castRef]string{}
			for key, name := range reply.Speakers {
				ref, ok := need[strings.Trim(key, "[] ")]
				name = schema.TruncateRunes(strings.TrimSpace(name), 60)
				if ok && name != "" {
					speakers[ref] = name
				}
			}
			var roles []CastRole
			for _, c := range reply.Characters {
				c.Name = schema.TruncateRunes(strings.TrimSpace(c.Name), 60)
				if c.Name == "" || c.Name == castNarrator || c.Name == castUnknown {
					continue
				}
				c.Gender, c.Age, c.Description = schema.TruncateRunes(c.Gender, 20), schema.TruncateRunes(c.Age, 20), schema.TruncateRunes(strings.TrimSpace(c.Description), 60)
				roles = append(roles, c)
			}
			return speakers, roles, nil
		}
		w.logAIOutput("cast", issue, result.Text)
		if attempt == 0 {
			w.setAIStage("repairing")
		}
		request.Messages = append(request.Messages, llm.Message{Role: "assistant", Content: result.Text}, llm.Message{Role: "user", Content: "Your reply is invalid: " + issue + ". Return the complete JSON object only, keep descriptions short."})
	}
	w.setAIStage("writing")
	return nil, nil, msg.Err(msg.ErrAIResultInvalid, msg.Params{"detail": issue})
}

// castVoices 让模型按角色特征从声音库中选角，只接受声音库里存在的 ID。
func (w *Workbench) castVoices(ctx context.Context, in CastBrief, roles []CastRole) (map[string]string, error) {
	var b strings.Builder
	b.WriteString("Voice library:\n")
	ids := map[string]bool{}
	for _, v := range in.Voices {
		ids[v.ID] = true
		fmt.Fprintf(&b, "- id %s: %s", v.ID, schema.TruncateRunes(strings.TrimSpace(v.Name), 60))
		if d := strings.TrimSpace(v.Description); d != "" {
			fmt.Fprintf(&b, " (%s)", schema.TruncateRunes(strings.ReplaceAll(d, "\n", " "), 200))
		}
		b.WriteString("\n")
	}
	b.WriteString("\nBook characters, main characters first:\n- @narrator\n")
	for _, r := range roles[:min(len(roles), 60)] {
		fmt.Fprintf(&b, "- %s: %s, %s, %s\n", r.Name, cmpOr(r.Gender, "unknown"), cmpOr(r.Age, "unknown"), r.Description)
	}
	result, e := w.complete(ctx, llm.Request{System: voicePrompt, Messages: []llm.Message{{Role: "user", Content: b.String()}}, MaxTokens: 4000, Temperature: 0.2})
	if e != nil {
		return nil, e
	}
	var reply struct {
		Cast map[string]string `json:"cast"`
	}
	if e = json.Unmarshal([]byte(llm.ExtractJSON(result.Text)), &reply); e != nil {
		w.logAIOutput("cast_voices", "invalid json", result.Text)
		return nil, msg.Err(msg.ErrAIResultInvalid, msg.Params{"detail": "invalid json"})
	}
	voices := map[string]string{}
	for name, id := range reply.Cast {
		if !ids[id] {
			continue
		}
		if name == castNarrator {
			name = ""
		}
		voices[name] = id
	}
	return voices, nil
}
