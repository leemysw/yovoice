package schema

import (
	"math"
	"slices"
	"strings"
	"unicode/utf16"
	"yovoice/internal/catalog"
	"yovoice/internal/msg"
)

func TextLen(s string) int { return len(utf16.Encode([]rune(s))) }
func Validate(d Draft) error {
	if d.Kind == "score" {
		return validateScoreDraft(d)
	}
	if m, e := catalog.Lookup(d.ModelID); e == nil && m.Family == "ace_step" {
		return validateMusic(d)
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
	if _, e := d.GenerationOptions(m.Family); e != nil {
		return e
	}
	if m.Family == "kokoro_tts" {
		if !slices.Contains(m.Voices, d.KokoroSpeaker(m)) {
			return msg.Err(msg.ErrSpeakerInvalid, nil)
		}
		if d.SynthesisLanguage != "" && d.SynthesisLanguage != "auto" && d.SynthesisLanguage != KokoroLanguage(d.KokoroSpeaker(m)) {
			return msg.Err(msg.ErrLanguageUnsupported, nil)
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

func validateMusic(d Draft) error {
	if strings.TrimSpace(d.Title) == "" || TextLen(d.Title) > 120 {
		return msg.Err(msg.ErrTitleLength, nil)
	}
	if strings.TrimSpace(d.Text) == "" || TextLen(d.Text) > 512 {
		return msg.Err(msg.ErrMusicStyle, nil)
	}
	if TextLen(d.Lyrics) > 4000 {
		return msg.Err(msg.ErrMusicLyrics, nil)
	}
	if d.SynthesisLanguage != "" && !slices.Contains(MusicLanguages, d.SynthesisLanguage) {
		return msg.Err(msg.ErrLanguageUnsupported, nil)
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

func InRange(v, min, max float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0) && v >= min && v <= max
}

func (d Draft) RequiresVoice() bool {
	m, err := catalog.Lookup(d.ModelID)
	if err == nil && (m.Family == "kokoro_tts" || m.Family == "ace_step") {
		return false
	}
	if err == nil && m.Family == "omnivoice" {
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

func KokoroLanguage(voice string) string {
	if voice == "" {
		return ""
	}
	return map[byte]string{'a': "en-us", 'b': "en-gb", 'e': "es", 'f': "fr-fr", 'h': "hi", 'i': "it", 'j': "ja", 'p': "pt-br", 'z': "zh"}[voice[0]]
}
