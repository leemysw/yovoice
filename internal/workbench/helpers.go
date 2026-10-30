package workbench

import "yovoice/internal/schema"

func ptr(s string) *string { return &s }

// scoreLanguage 是界面语言对应的英文语言名，写进提示词让模型用它命名。
func scoreLanguage(locale schema.UiLocale) string {
	if name, ok := schema.UiLocaleNames[locale]; ok {
		return name
	}
	return "English"
}
