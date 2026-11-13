package workbench

import (
	"testing"
	"yovoice/internal/schema"
)

// 主题只接受 schema.Themes 里的取值；为空表示跟随系统，保存后仍为空。
func TestSavePreferencesTheme(t *testing.T) {
	wb, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	p := wb.Store.Read().Preferences
	for _, theme := range append([]string{""}, schema.Themes...) {
		p.Theme = theme
		if err := wb.SavePreferences(p); err != nil {
			t.Fatalf("拒绝有效主题 %q: %v", theme, err)
		}
		if got := wb.Store.Read().Preferences.Theme; got != theme {
			t.Fatalf("主题保存为 %q，期望 %q", got, theme)
		}
	}
	p.Theme = "neon"
	if err := wb.SavePreferences(p); err == nil {
		t.Fatal("接受了未知主题")
	}
	if got := wb.Store.Read().Preferences.Theme; got != "abyss" {
		t.Fatalf("保存失败不应改动已有主题，实际为 %q", got)
	}
}

// 快捷键设置只检查写法：合法的改动原样保存，全部默认时不写入，写法不对的整份拒绝。
func TestSavePreferencesHotkeys(t *testing.T) {
	wb, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	p := wb.Store.Read().Preferences
	p.Hotkeys = &schema.HotkeySettings{Off: []string{"music"}, Bindings: map[string]string{"transcribe.nextLine": "mod+down", "story.speaker": "ctrl+#", "global.sidebar": "mod+shift+[", "transcribe.export": ""}}
	if err := wb.SavePreferences(p); err != nil {
		t.Fatalf("拒绝有效的快捷键设置: %v", err)
	}
	saved := wb.Store.Read().Preferences.Hotkeys
	if saved == nil || saved.Bindings["transcribe.nextLine"] != "mod+down" || saved.Bindings["transcribe.export"] != "" || len(saved.Bindings) != 4 {
		t.Fatalf("快捷键保存不完整: %+v", saved)
	}
	for _, bad := range []schema.HotkeySettings{
		{Bindings: map[string]string{"Bad Id": "mod+K"}},
		{Bindings: map[string]string{"global.new": "mod+meta+K"}},
		{Bindings: map[string]string{"global.new": "mod+"}},
		// 小写字母、未知键名都永远匹配不上，保存时拒绝。
		{Bindings: map[string]string{"global.new": "mod+k"}},
		{Bindings: map[string]string{"global.new": "mod+f13"}},
		{Bindings: map[string]string{"global.new": "mod+shift"}},
		{Off: []string{"music", "music"}},
	} {
		p.Hotkeys = &bad
		if err := wb.SavePreferences(p); err == nil {
			t.Fatalf("接受了无效的快捷键设置 %+v", bad)
		}
	}
	p.Hotkeys = &schema.HotkeySettings{}
	if err := wb.SavePreferences(p); err != nil {
		t.Fatal(err)
	}
	if wb.Store.Read().Preferences.Hotkeys != nil {
		t.Fatal("全部默认的快捷键设置不应写入")
	}
}
