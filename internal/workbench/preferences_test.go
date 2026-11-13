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
