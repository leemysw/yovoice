package schema

import (
	"math"
	"slices"
	"strconv"
	"strings"
	"unicode/utf16"
	"yovoice/internal/catalog"
	"yovoice/internal/msg"
)

func TextLen(s string) int { return len(utf16.Encode([]rune(s))) }

// ValidKind 判断作品类型是否合法；空串表示旧数据的默认语音作品。
func ValidKind(kind string) bool {
	return slices.Contains([]string{"", "text", "story", "subtitle", "music", "sfx", "score"}, kind)
}

// TruncateRunes 按字符数截断文本，不加省略号。
func TruncateRunes(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n])
	}
	return s
}

// Clip 按字符数截断文本并在末尾加省略号，用于日志与提示词里的长文本。
func Clip(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n]) + "…"
	}
	return s
}

// Deref 返回字符串指针指向的值；空指针返回空串。
func Deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
func Validate(d Draft) error {
	if d.Kind == "score" {
		return validateScoreDraft(d)
	}
	if d.Kind == "sfx" {
		m, e := catalog.Lookup(d.ModelID)
		if e != nil {
			return e
		}
		if m.Family != "stable_audio" || m.Variant != "sfx" && m.Variant != "medium" {
			return msg.Err(msg.ErrModelUnsupported, nil)
		}
	}
	if m, e := catalog.Lookup(d.ModelID); e == nil && catalog.IsMusic(m.Family) {
		return validateMusic(d, m.Family)
	}
	if strings.TrimSpace(d.Text) == "" || TextLen(d.Text) > 12000 {
		return msg.Err(msg.ErrTextRequired, nil)
	}
	if strings.TrimSpace(d.Title) == "" || TextLen(d.Title) > 120 {
		return msg.Err(msg.ErrTitleLength, nil)
	}
	m, e := catalog.Lookup(d.ModelID)
	if e != nil {
		return e
	}
	// SheetSage2 只用于从歌曲扒旋律谱、歌词对齐模型只用于播放页对齐歌词，都不能作为作品的生成模型。
	if m.Family == "sheetsage2" || m.Family == "lyric_align" {
		return msg.Err(msg.ErrModelUnsupported, nil)
	}
	if _, e := d.GenerationOptions(m.Family); e != nil {
		return e
	}
	if m.Family == "kokoro_tts" {
		primary, ok := kokoroPrimaryVoice(d.KokoroSpeaker(m), m.Voices)
		if !ok {
			return msg.Err(msg.ErrSpeakerInvalid, nil)
		}
		if d.SynthesisLanguage != "" && d.SynthesisLanguage != "auto" && d.SynthesisLanguage != KokoroLanguage(primary) {
			return msg.Err(msg.ErrLanguageUnsupported, nil)
		}
		if d.Seed != nil && (*d.Seed < 0 || *d.Seed > 2147483647) {
			return msg.Err(msg.ErrParamsOutOfRange, nil)
		}
		return nil
	}
	if m.Family == "voxtral_tts" {
		if d.Speaker != "" && !slices.Contains(m.Voices, d.Speaker) {
			return msg.Err(msg.ErrSpeakerInvalid, nil)
		}
		if d.Seed != nil && (*d.Seed < 0 || *d.Seed > 2147483647) {
			return msg.Err(msg.ErrParamsOutOfRange, nil)
		}
		return nil
	}
	if m.Family == "plapre" {
		if d.VoiceMode != "" && d.VoiceMode != "design" && d.VoiceMode != "clone" {
			return msg.Err(msg.ErrModeInvalid, nil)
		}
		if d.VoiceMode != "clone" && d.Speaker != "" && !slices.Contains(m.Voices, d.Speaker) {
			return msg.Err(msg.ErrSpeakerInvalid, nil)
		}
		if TextLen(d.ReferenceText) > 2000 {
			return msg.Err(msg.ErrDraftLimits, nil)
		}
		if d.Seed != nil && (*d.Seed < 0 || *d.Seed > 2147483647) {
			return msg.Err(msg.ErrParamsOutOfRange, nil)
		}
		return nil
	}
	if m.Family == "xtts_v2" {
		if !slices.Contains([]string{"", "auto", "en", "es", "fr", "de", "it", "pt", "pl", "tr", "ru", "nl", "cs", "ar", "zh-cn", "hu", "ko", "ja", "hi"}, d.SynthesisLanguage) {
			return msg.Err(msg.ErrLanguageUnsupported, nil)
		}
		if d.Seed != nil && (*d.Seed < 0 || int64(*d.Seed) > 4294967295) {
			return msg.Err(msg.ErrParamsOutOfRange, nil)
		}
		return nil
	}
	if m.Family == "gradium_phonon" {
		if !slices.Contains([]string{"", "auto", "en"}, d.SynthesisLanguage) {
			return msg.Err(msg.ErrLanguageUnsupported, nil)
		}
		if d.Seed != nil && (*d.Seed < 0 || int64(*d.Seed) > 4294967295) {
			return msg.Err(msg.ErrParamsOutOfRange, nil)
		}
		return nil
	}
	if m.Family == "fish_drama3" {
		if d.VoiceMode != "" && d.VoiceMode != "design" && d.VoiceMode != "clone" {
			return msg.Err(msg.ErrModeInvalid, nil)
		}
		if TextLen(d.ReferenceText) > 2000 {
			return msg.Err(msg.ErrDraftLimits, nil)
		}
		if d.VoiceMode == "clone" && strings.TrimSpace(d.ReferenceText) == "" {
			return msg.Err(msg.ErrReferenceTextRequired, msg.Params{"model": m.Name})
		}
		if d.Seed != nil && (*d.Seed < 0 || *d.Seed > 2147483647) {
			return msg.Err(msg.ErrParamsOutOfRange, nil)
		}
		return nil
	}
	if m.Family == "omnivoice" || m.Family == "qwen3_tts" {
		if TextLen(d.VoiceDescription) > 500 || TextLen(d.ReferenceText) > 2000 {
			return msg.Err(msg.ErrDraftLimits, nil)
		}
		if d.Seed != nil && (*d.Seed < 0 || *d.Seed > 2147483647) {
			return msg.Err(msg.ErrParamsOutOfRange, nil)
		}
		if m.Family == "omnivoice" && d.VoiceMode != "" && d.VoiceMode != "design" && d.VoiceMode != "clone" {
			return msg.Err(msg.ErrModeInvalid, nil)
		}
		if m.Family == "qwen3_tts" {
			if !slices.Contains([]string{"", "auto", "zh", "en", "ja", "ko", "de", "fr", "ru", "pt", "es", "it"}, d.SynthesisLanguage) {
				return msg.Err(msg.ErrLanguageUnsupported, nil)
			}
			if m.Variant == "customvoice" && d.Speaker != "" && !slices.Contains(catalog.QwenSpeakers, d.Speaker) {
				return msg.Err(msg.ErrSpeakerInvalid, nil)
			}
			if m.Variant == "voicedesign" && strings.TrimSpace(d.VoiceDescription) == "" {
				return msg.Err(msg.ErrVoiceDescriptionRequired, nil)
			}
		} else {
			if d.VoiceMode == "clone" && strings.TrimSpace(d.ReferenceText) == "" {
				return msg.Err(msg.ErrOmniReferenceRequired, nil)
			}
			if d.VoiceMode != "clone" {
				if err := validateOmniDescription(d.VoiceDescription); err != nil {
					return err
				}
			}
			if d.OmniSpeed != 0 && !InRange(d.OmniSpeed, .5, 2) {
				return msg.Err(msg.ErrParamsOutOfRange, nil)
			}
			if TextLen(d.SynthesisLanguage) > 32 {
				return msg.Err(msg.ErrLanguageUnsupported, nil)
			}
		}
		return nil
	}
	if m.Family == "ming3_tts" {
		if d.VoiceMode != "" && d.VoiceMode != "design" && d.VoiceMode != "clone" {
			return msg.Err(msg.ErrModeInvalid, nil)
		}
		if TextLen(d.VoiceDescription) > 500 || TextLen(d.ReferenceText) > 2000 {
			return msg.Err(msg.ErrDraftLimits, nil)
		}
		if !slices.Contains([]string{"", "auto", "zh", "en", "ja", "ko", "de", "fr", "es"}, d.SynthesisLanguage) {
			return msg.Err(msg.ErrLanguageUnsupported, nil)
		}
		if d.Seed != nil && (*d.Seed < 0 || *d.Seed > 2147483647) {
			return msg.Err(msg.ErrParamsOutOfRange, nil)
		}
		return nil
	}
	if m.Family == "breeze_tts" {
		if d.VoiceMode != "" && d.VoiceMode != "design" && d.VoiceMode != "clone" {
			return msg.Err(msg.ErrModeInvalid, nil)
		}
		if TextLen(d.VoiceDescription) > 500 || TextLen(d.ReferenceText) > 2000 {
			return msg.Err(msg.ErrDraftLimits, nil)
		}
		// 官方克隆模板要求参考音频的完整原文；原文缺失或不符时容易把参考内容续进正文、拖音或串词。
		if d.VoiceMode == "clone" && strings.TrimSpace(d.ReferenceText) == "" {
			return msg.Err(msg.ErrReferenceTextRequired, msg.Params{"model": m.Name})
		}
		if d.Seed != nil && (*d.Seed < 0 || *d.Seed > 2147483647) {
			return msg.Err(msg.ErrParamsOutOfRange, nil)
		}
		return nil
	}
	if m.Family == "voxcpm2" {
		if d.VoxMode != "" && d.VoxMode != "design" && d.VoxMode != "clone" && d.VoxMode != "continuation" {
			return msg.Err(msg.ErrVoxModeInvalid, nil)
		}
		if TextLen(d.VoiceDescription) > 500 || TextLen(d.ReferenceText) > 2000 {
			return msg.Err(msg.ErrVoxTextLimits, nil)
		}
		if d.VoxMode == "continuation" && strings.TrimSpace(d.ReferenceText) == "" {
			return msg.Err(msg.ErrVoxReferenceRequired, nil)
		}
		if (d.GuidanceScale != 0 && !InRange(d.GuidanceScale, .5, 5)) || d.InferenceSteps < 0 || d.InferenceSteps > 50 || (d.Seed != nil && (*d.Seed < 0 || *d.Seed > 2147483647)) {
			return msg.Err(msg.ErrVoxParams, nil)
		}
		return nil
	}
	languages := []string{"zh", "en"}
	if m.Version != "2" {
		languages = append(languages, "ja", "es", "ar")
	}
	ok := false
	for _, l := range languages {
		ok = ok || l == d.Language
	}
	if !ok {
		return msg.Err(msg.ErrLanguageUnsupported, nil)
	}
	switch d.Mode {
	case "speaker", "reference", "vector", "text":
	default:
		return msg.Err(msg.ErrModeInvalid, nil)
	}
	if TextLen(d.EmotionText) > 500 || len(d.Emotions) != 8 {
		return msg.Err(msg.ErrEmotionInvalid, nil)
	}
	for _, v := range d.Emotions {
		if !InRange(v, 0, 1) {
			return msg.Err(msg.ErrEmotionStrength, nil)
		}
	}
	for _, v := range [][3]float64{{d.Speed, .5, 2}, {d.EmotionStrength, 0, 1}, {d.Temperature, .05, 2}, {d.TopP, .01, 1}, {d.RepetitionPenalty, .1, 20}, {d.LengthPenalty, -2, 2}} {
		if !InRange(v[0], v[1], v[2]) {
			return msg.Err(msg.ErrParamsOutOfRange, nil)
		}
	}
	if d.TopK < 1 || d.TopK > 200 || d.MaxTokens < 50 || d.MaxTokens > 4000 || d.NumBeams < 1 || d.NumBeams > 10 || d.IntervalSilenceMs < 0 || d.IntervalSilenceMs > 2000 || (d.Seed != nil && (*d.Seed < 0 || *d.Seed > 2147483647)) {
		return msg.Err(msg.ErrParamsOutOfRange, nil)
	}
	return nil
}

// MusicLanguages 是 ACE-Step 规划器接受的演唱语言；unknown 交给模型判断。
var MusicLanguages = []string{"ar", "az", "bg", "bn", "ca", "cs", "da", "de", "el", "en", "es", "fa", "fi", "fr", "he", "hi", "hr", "ht", "hu", "id", "is", "it", "ja", "ko", "la", "lt", "ms", "ne", "nl", "no", "pa", "pl", "pt", "ro", "ru", "sa", "sk", "sr", "sv", "sw", "ta", "te", "th", "tl", "tr", "uk", "ur", "vi", "yue", "zh", "unknown"}

func validateMusic(d Draft, family string) error {
	if strings.TrimSpace(d.Title) == "" || TextLen(d.Title) > 120 {
		return msg.Err(msg.ErrTitleLength, nil)
	}
	if strings.TrimSpace(d.Text) == "" || TextLen(d.Text) > 512 {
		return msg.Err(msg.ErrMusicStyle, nil)
	}
	if TextLen(d.Lyrics) > 4000 {
		return msg.Err(msg.ErrMusicLyrics, nil)
	}
	// 谱面方言由 score.ParseABC 在生成前校验，这里只限制长度，避免作品状态被超长文本撑大。
	if len(d.Abc) > 64<<10 {
		return msg.Err(msg.ErrMelodyInvalid, msg.Params{"code": "length"})
	}
	if d.SynthesisLanguage != "" && !slices.Contains(MusicLanguages, d.SynthesisLanguage) {
		return msg.Err(msg.ErrLanguageUnsupported, nil)
	}
	// YuE2 按歌词逐段生成，歌词长度决定歌曲长度；纯音乐先出谱、把人声旋律交给器乐，歌词可留空。
	if family == "yue2" {
		if !d.Instrumental && strings.TrimSpace(d.Lyrics) == "" {
			return msg.Err(msg.ErrMusicLyricsRequired, nil)
		}
		if _, err := d.GenerationOptions("yue2"); err != nil {
			return err
		}
		if d.Seed != nil && (*d.Seed < 0 || *d.Seed > 2147483647) {
			return msg.Err(msg.ErrParamsOutOfRange, nil)
		}
		return nil
	}
	if family == "stable_audio" {
		return validateStableAudio(d)
	}
	o, err := d.GenerationOptions("ace_step")
	if err != nil {
		return err
	}
	// 0 表示交给规划器决定；指定时需落在规划器可采样的范围内。
	if v, ok := o["duration_seconds"].(float64); ok && v < 10 {
		return msg.Err(msg.ErrMusicParams, nil)
	}
	if v, ok := o["bpm"].(float64); ok && v < 30 {
		return msg.Err(msg.ErrMusicParams, nil)
	}
	if d.Seed != nil && (*d.Seed < 0 || *d.Seed > 2147483647) {
		return msg.Err(msg.ErrParamsOutOfRange, nil)
	}
	return nil
}

// validateStableAudio 校验 Stable Audio：只用英文描述生成音乐或音效，不演唱歌词；
// 改编需要选定起点版本；局部重绘的区间须落在模型最长时长内。
func validateStableAudio(d Draft) error {
	m, _ := catalog.Lookup(d.ModelID)
	o, err := d.GenerationOptions("stable_audio")
	if err != nil {
		return err
	}
	limit := float64(m.MaxDuration)
	if v, ok := o["duration_seconds"].(float64); ok && limit > 0 && v > limit {
		return msg.Err(msg.ErrMusicParams, nil)
	}
	switch o["edit"] {
	case "init_audio":
		if d.SourceGenerationID == "" {
			return msg.Err(msg.ErrMusicSourceRequired, nil)
		}
	case "inpaint_audio":
		if d.SourceGenerationID == "" {
			return msg.Err(msg.ErrMusicSourceRequired, nil)
		}
		start, _ := o["inpaint_start"].(float64)
		end, _ := o["inpaint_end"].(float64)
		if end <= start || (limit > 0 && end > limit) {
			return msg.Err(msg.ErrMusicParams, nil)
		}
	}
	if d.Seed != nil && (*d.Seed < 0 || *d.Seed > 2147483647) {
		return msg.Err(msg.ErrParamsOutOfRange, nil)
	}
	return nil
}

func InRange(v, min, max float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0) && v >= min && v <= max
}

func (d Draft) RequiresVoice() bool {
	m, err := catalog.Lookup(d.ModelID)
	if err == nil && (m.Family == "kokoro_tts" || m.Family == "voxtral_tts" || m.Family == "gradium_phonon" || catalog.IsMusic(m.Family)) {
		return false
	}
	if err == nil && (m.Family == "omnivoice" || m.Family == "breeze_tts" || m.Family == "ming3_tts" || m.Family == "plapre" || m.Family == "fish_drama3") {
		return d.VoiceMode == "clone"
	}
	if err == nil && m.Family == "qwen3_tts" {
		return m.Variant == "" || m.Variant == "base"
	}
	return err != nil || m.Family != "voxcpm2" || d.VoxMode == "clone" || d.VoxMode == "continuation"
}

func (d Draft) KokoroSpeaker(m catalog.ModelPackage) string {
	if d.Speaker != "" {
		return d.Speaker
	}
	for _, voice := range m.Voices {
		if strings.HasPrefix(voice, "zf_") {
			return voice
		}
	}
	return ""
}

func kokoroPrimaryVoice(speaker string, voices []string) (string, bool) {
	if !strings.Contains(speaker, "(") {
		return speaker, slices.Contains(voices, speaker)
	}
	parts := strings.Split(speaker, "+")
	if len(parts) != 2 {
		return "", false
	}
	ids := [2]string{}
	for i, part := range parts {
		open := strings.IndexByte(part, '(')
		if open <= 0 || !strings.HasSuffix(part, ")") {
			return "", false
		}
		ids[i] = part[:open]
		weight, err := strconv.ParseFloat(part[open+1:len(part)-1], 64)
		if err != nil || math.IsNaN(weight) || math.IsInf(weight, 0) || weight <= 0 || !slices.Contains(voices, ids[i]) {
			return "", false
		}
	}
	if KokoroLanguage(ids[0]) != KokoroLanguage(ids[1]) {
		return "", false
	}
	return ids[0], true
}

func KokoroLanguage(voice string) string {
	if voice == "" {
		return ""
	}
	return map[byte]string{'a': "en-us", 'b': "en-gb", 'e': "es", 'f': "fr-fr", 'h': "hi", 'i': "it", 'j': "ja", 'p': "pt-br", 'z': "zh"}[voice[0]]
}
