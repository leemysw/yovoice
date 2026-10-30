package score

import (
	"fmt"
	"regexp"
	"strings"
)

// YuE2 的旋律谱是受限的 ABC 方言（见 YuE2 官方 yue2-music skill 的 abc-editing.md）：
// 固定表头、Vocal/Ins 两个单声部、每组 1–4 小节先 Vocal 后 Ins、`% verse` 注释分段、和弦只写在 Vocal。
// 这里按官方 abc_tools.py 的规则解析，遇到方言之外的写法直接报错，不猜测时值。

// ABCTicksPerWhole 是内部时间单位：一个全音符 4096 tick，L:1/1024 也能整除。
const ABCTicksPerWhole = 4096

const abcQuarter = ABCTicksPerWhole / 4

// ABCMaxLength 是旋律谱文本的长度上限；YuE2 规划阶段最多 4096 个 token，正常谱远小于此。
const ABCMaxLength = 64 << 10

var (
	abcVoices      = [2]string{"Vocal", "Ins"}
	abcVoiceHeader = [2]string{`V: Vocal clef=treble name="Vocal Melody" snm="Vocal"`, `V: Ins clef=treble name="Ins Melody" snm="Inst."`}
	abcDurations   = []int{1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48}
	abcNatural     = map[byte]int{'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
	// abcQualities 是官方方言允许的和弦性质及其音程，空串为大三和弦。
	abcQualities = map[string][]int{
		"": {0, 4, 7}, "m": {0, 3, 7}, "dim": {0, 3, 6}, "aug": {0, 4, 8}, "7": {0, 4, 7, 10}, "maj7": {0, 4, 7, 11},
		"m7": {0, 3, 7, 10}, "dim7": {0, 3, 6, 9}, "m7b5": {0, 3, 6, 10}, "sus4": {0, 5, 7}, "sus2": {0, 2, 7},
		"6": {0, 4, 7, 9}, "m6": {0, 3, 7, 9}, "7sus4": {0, 5, 7, 10}, "m(maj7)": {0, 3, 7, 11},
	}
	abcChord = regexp.MustCompile(`^([A-G](?:bb|##|b|#)?)(maj7|m\(maj7\)|m7b5|7sus4|dim7|dim|aug|sus4|sus2|m7|m6|m|7|6)?(?:/([A-G](?:bb|##|b|#)?))?$`)
	abcToken = regexp.MustCompile(`^(?:"([^"\n]*)"|\[K:([^\]\n]+)\]|(\^\^|__|\^|_|=)?([A-Ga-gz])([,']*)([0-9]*)(-?))`)
	abcMeter = regexp.MustCompile(`^([1-9][0-9]*)/([1-9][0-9]*)$`)
	abcRests = regexp.MustCompile(`^Z([2-4])?$`)
	abcKeys  = func() map[string]int {
		keys := map[string]int{}
		for i, k := range []string{"Cb", "Gb", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#"} {
			keys[k] = i - 7
		}
		for i, k := range []string{"Abm", "Ebm", "Bbm", "Fm", "Cm", "Gm", "Dm", "Am", "Em", "Bm", "F#m", "C#m", "G#m", "D#m", "A#m"} {
			keys[k] = i - 7
		}
		return keys
	}()
)

// ABCIssue 是谱面问题：Code 供界面本地化，Line 是 1 起的行号，Bar 是 1 起的小节号，Detail 用英文写给模型修正。
type ABCIssue struct {
	Code   string `json:"code"`
	Line   int    `json:"line,omitempty"`
	Bar    int    `json:"bar,omitempty"`
	Voice  string `json:"voice,omitempty"`
	Detail string `json:"detail"`
}

func (i *ABCIssue) Error() string {
	where := ""
	if i.Line > 0 {
		where += fmt.Sprintf("line %d", i.Line)
	}
	if i.Voice != "" {
		where += ", " + i.Voice
	}
	if i.Bar > 0 {
		where += fmt.Sprintf(", bar %d", i.Bar)
	}
	if where = strings.TrimPrefix(where, ", "); where != "" {
		return where + ": " + i.Detail
	}
	return i.Detail
}

type ABCNote struct {
	Start  int `json:"start"`
	Length int `json:"length"`
	Pitch  int `json:"pitch"`
}

type ABCChord struct {
	At   int    `json:"at"`
	Name string `json:"name"`
}

type ABCBar struct {
	Start  int    `json:"start"`
	Length int    `json:"length"`
	Meter  [2]int `json:"meter"`
}

type ABCVoice struct {
	Notes  []ABCNote  `json:"notes"`
	Chords []ABCChord `json:"chords,omitempty"`
	Bars   []ABCBar   `json:"bars"`
	keys   []string
	meter  [2]int
	key    string
	time   int
	// pending 是连音线等待接续的音：实际音高与书写音高。
	pending *[2]int
}

// ABCSection 记录 `% name` 注释开始的段落，Bar 是该段第一个小节（1 起）。
type ABCSection struct {
	Name string `json:"name"`
	Bar  int    `json:"bar"`
}

// ABCScore 是解析后的旋律谱，时间均以 tick 计。
type ABCScore struct {
	Tempo    int          `json:"tempo"`
	Meter    [2]int       `json:"meter"`
	Key      string       `json:"key"`
	Unit     int          `json:"unit"`
	Voices   [2]*ABCVoice `json:"-"`
	Sections []ABCSection `json:"sections,omitempty"`
	// musicLines 是音符行的下标（0 起）到声部名的映射，供去和弦等文本改写使用。
	musicLines map[int]string
}

func (s *ABCScore) Vocal() *ABCVoice { return s.Voices[0] }
func (s *ABCScore) Ins() *ABCVoice   { return s.Voices[1] }

// Bars 是小节数，两个声部相同。
func (s *ABCScore) Bars() int { return len(s.Voices[0].Bars) }

// Seconds 是谱面时长；YuE2 实际演唱会有出入。
func (s *ABCScore) Seconds() float64 {
	return float64(s.Voices[0].time) / abcQuarter * 60 / float64(s.Tempo)
}

// HasChords 决定按谱生成时用 full（带和弦）还是 melody（伴奏自由发挥）。
func (s *ABCScore) HasChords() bool { return len(s.Voices[0].Chords) > 0 }

func issue(code string, line int, format string, args ...any) *ABCIssue {
	return &ABCIssue{Code: code, Line: line, Detail: fmt.Sprintf(format, args...)}
}
