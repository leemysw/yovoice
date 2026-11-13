package schema

import (
	"regexp"
	"slices"
	"yovoice/internal/msg"
)

// HotkeySettings 是界面快捷键的设置（设置 › 快捷键），只记录与默认不同的部分。
// 命令表与默认按键都在界面里（web/src/shared/hotkeys），这里只检查格式，不认具体命令，旧版本不认识的命令原样保留。
type HotkeySettings struct {
	// Disabled 停用全部可修改的快捷键；输入框里的编辑键不受影响。
	Disabled bool `json:"disabled,omitempty"`
	// Off 是停用快捷键的功能区（设置页一级分类的 id，如 "music"）。
	Off []string `json:"off,omitempty"`
	// Bindings 是改过的按键：命令 id → 按键（如 "mod+shift+K"），空字符串表示清除这条快捷键。
	Bindings map[string]string `json:"bindings,omitempty"`
}

const (
	hotkeyAreasMax    = 32
	hotkeyBindingsMax = 512
)

var (
	hotkeyID = regexp.MustCompile(`^[a-z][A-Za-z0-9.]{0,63}$`)
	// 按键由修饰键（mod/ctrl/alt/shift）加一个键组成，键是大写字母、数字、# （1–9 的一组数字）、符号或 enter、f1 这类键名，
	// 与 web/src/shared/hotkeys/keys.ts 的写法一致；写法不对的按键永远匹配不上，保存时就拒绝。
	hotkeyBinding = regexp.MustCompile("^((mod|ctrl|alt|shift)\\+){0,4}([A-Z0-9#]|f([1-9]|1[0-2])|enter|space|tab|esc|backspace|delete|up|down|left|right|home|end|pageup|pagedown|[=,./;'\\[\\]\\\\`-])$")
)

// Validate 检查功能区与命令 id、按键的写法和数量。
func (h HotkeySettings) Validate() error {
	if len(h.Off) > hotkeyAreasMax || len(h.Bindings) > hotkeyBindingsMax {
		return msg.Err(msg.ErrRequestInvalid, nil)
	}
	for i, area := range h.Off {
		if !hotkeyID.MatchString(area) || slices.Contains(h.Off[:i], area) {
			return msg.Err(msg.ErrRequestInvalid, nil)
		}
	}
	for id, binding := range h.Bindings {
		if !hotkeyID.MatchString(id) || (binding != "" && !hotkeyBinding.MatchString(binding)) {
			return msg.Err(msg.ErrRequestInvalid, nil)
		}
	}
	return nil
}

// Empty 表示全部沿用默认值，保存时不必写入。
func (h HotkeySettings) Empty() bool {
	return !h.Disabled && len(h.Off) == 0 && len(h.Bindings) == 0
}
