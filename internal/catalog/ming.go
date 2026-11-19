package catalog

import (
	_ "embed"
	"encoding/json"
)

// ming_voices.json 是 Ming 3.0 TTS 内置音色与副语言标签的唯一来源，界面和后端共用。
// 取自上游 cookbook 的推荐音色；影视、动画角色音色不收录。
//
//go:embed ming_voices.json
var mingVoicesJSON []byte

// MingVoice 是一个内置音色。带 Emotions 的音色必须选一种情感，调用名称为“音色_情感”（见 MingVoiceID）。
type MingVoice struct {
	ID       string   `json:"id"`
	Language string   `json:"language"`
	Gender   string   `json:"gender"`
	Emotions []string `json:"emotions,omitempty"`
}

// mingEmotionSuffix 是带情感音色调用名称里的情感后缀，与上游一致（生气，而不是情感控制里的愤怒）。
var mingEmotionSuffix = map[string]string{
	"neutral": "中性", "happy": "高兴", "sad": "悲伤", "angry": "生气", "fearful": "恐惧", "disgusted": "厌恶", "surprised": "惊讶",
}

var MingVoices, MingTags = func() ([]MingVoice, []string) {
	var data struct {
		Voices []MingVoice `json:"voices"`
		Tags   []string    `json:"tags"`
	}
	if err := json.Unmarshal(mingVoicesJSON, &data); err != nil {
		panic(err)
	}
	return data.Voices, data.Tags
}()

// mingVoiceIDs 是全部可用的调用名称（即请求里的 voice_id）。
var mingVoiceIDs = func() map[string]bool {
	ids := map[string]bool{}
	for _, v := range MingVoices {
		if len(v.Emotions) == 0 {
			ids[v.ID] = true
		}
		for _, emotion := range v.Emotions {
			ids[MingVoiceID(v.ID, emotion)] = true
		}
	}
	return ids
}()

// MingVoiceID 给出音色在某种情感下的调用名称；不带情感变体的音色传空情感。
func MingVoiceID(voice, emotion string) string {
	if emotion == "" {
		return voice
	}
	return voice + "_" + mingEmotionSuffix[emotion]
}

// IsMingVoice 判断调用名称是不是收录的内置音色。
func IsMingVoice(id string) bool { return mingVoiceIDs[id] }
