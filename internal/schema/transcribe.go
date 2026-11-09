package schema

import (
	"fmt"
	"yovoice/internal/msg"
)

// TranscribeSettings 是语音转写的限制与字幕断句参数（设置 › 常规 › 语音转写），0 表示用默认值。
// 上传上限与时长上限在服务端生效；断句参数由界面把逐词时间分成字幕行时使用。
type TranscribeSettings struct {
	MaxFileMB   int     `json:"maxFileMB,omitempty"`
	MaxMinutes  int     `json:"maxMinutes,omitempty"`
	LineChars   int     `json:"lineChars,omitempty"`
	LineSeconds float64 `json:"lineSeconds,omitempty"`
	LinePause   float64 `json:"linePause,omitempty"`
}

// 各项的默认值与允许范围。时长上限受内存约束：整段音频解码后常驻内存，3 小时约占 1 GB。
const (
	TranscribeFileMBDefault, TranscribeFileMBMin, TranscribeFileMBMax          = 4096, 20, 16384
	TranscribeMinutesDefault, TranscribeMinutesMin, TranscribeMinutesMax       = 60, 1, 180
	TranscribeLineCharsDefault, TranscribeLineCharsMin, TranscribeLineCharsMax = 20, 6, 80
)

const (
	TranscribeLineSecondsDefault, TranscribeLineSecondsMin, TranscribeLineSecondsMax = 6.0, 1.0, 20.0
	TranscribeLinePauseDefault, TranscribeLinePauseMin, TranscribeLinePauseMax       = 0.8, 0.2, 5.0
)

// Validate 检查各项在允许范围内；0 表示默认值，总是有效。
func (t TranscribeSettings) Validate() error {
	ints := []struct{ v, lo, hi int }{{t.MaxFileMB, TranscribeFileMBMin, TranscribeFileMBMax}, {t.MaxMinutes, TranscribeMinutesMin, TranscribeMinutesMax}, {t.LineChars, TranscribeLineCharsMin, TranscribeLineCharsMax}}
	for _, r := range ints {
		if r.v != 0 && (r.v < r.lo || r.v > r.hi) {
			return msg.Err(msg.ErrRequestInvalid, nil)
		}
	}
	floats := []struct{ v, lo, hi float64 }{{t.LineSeconds, TranscribeLineSecondsMin, TranscribeLineSecondsMax}, {t.LinePause, TranscribeLinePauseMin, TranscribeLinePauseMax}}
	for _, r := range floats {
		if r.v != 0 && (r.v < r.lo || r.v > r.hi) {
			return msg.Err(msg.ErrRequestInvalid, nil)
		}
	}
	return nil
}

// Empty 表示全部沿用默认值，保存时不必写入。
func (t TranscribeSettings) Empty() bool { return t == TranscribeSettings{} }

// FileLimit 返回上传上限（字节）与给人看的写法（如 4 GB、500 MB）。
func (t *TranscribeSettings) FileLimit() (int64, string) {
	mb := TranscribeFileMBDefault
	if t != nil && t.MaxFileMB != 0 {
		mb = t.MaxFileMB
	}
	label := fmt.Sprintf("%d MB", mb)
	if mb%1024 == 0 {
		label = fmt.Sprintf("%d GB", mb/1024)
	}
	return int64(mb) << 20, label
}

// Minutes 返回时长上限（分钟）。
func (t *TranscribeSettings) Minutes() int {
	if t != nil && t.MaxMinutes != 0 {
		return t.MaxMinutes
	}
	return TranscribeMinutesDefault
}
