package main

import (
	"flag"
	"fmt"
	"os"
	"yovoice/internal/catalog"
	"yovoice/internal/schema"
)

// musicFlags 是 generate 使用音乐模型（ACE-Step、YuE2、Stable Audio）时的参数：--text 为风格描述，歌词与旋律谱单独传入。
type musicFlags struct {
	lyrics, lyricsFile, abcFile string
	instrumental                bool
}

// musicAllowed 是音乐模型可用的 generate 参数；语音专用参数（参考音频、情绪、声音描述等）一律拒绝。
var musicAllowed = map[string]bool{"text": true, "text-file": true, "model": true, "seed": true, "option": true, "output": true, "data-dir": true, "json": true, "lyrics": true, "lyrics-file": true, "instrumental": true, "abc-file": true, "language": true}

// apply 把命令行参数填成与桌面端一致的音乐或音效作品，格式校验仍交给 schema.Validate。
func (m musicFlags) apply(fs *flag.FlagSet, d *schema.Draft, model catalog.ModelPackage, textFile string, seed int64, options map[string]any) error {
	var unsupported string
	language := false
	fs.Visit(func(f *flag.Flag) {
		if !musicAllowed[f.Name] || f.Name == "abc-file" && model.Family != "yue2" || f.Name == "language" && model.Family != "ace_step" {
			unsupported = f.Name
		}
		language = language || f.Name == "language"
	})
	if unsupported != "" {
		return fmt.Errorf("音乐模型 %s 不支持 --%s", model.Name, unsupported)
	}
	if m.lyrics != "" && m.lyricsFile != "" {
		return fmt.Errorf("--lyrics 和 --lyrics-file 只能指定一个")
	}
	if textFile != "" {
		b, e := os.ReadFile(textFile)
		if e != nil {
			return e
		}
		d.Text = string(b)
	}
	d.Lyrics = m.lyrics
	if m.lyricsFile != "" {
		b, e := os.ReadFile(m.lyricsFile)
		if e != nil {
			return e
		}
		d.Lyrics = string(b)
	}
	if m.abcFile != "" {
		b, e := os.ReadFile(m.abcFile)
		if e != nil {
			return e
		}
		d.Abc = string(b)
	}
	d.Kind, d.Title = "music", "CLI 音乐"
	d.Instrumental = m.instrumental
	// 音效款 Stable Audio 只做音效作品，与桌面端“音效”一致：不唱歌词。
	if model.Family == "stable_audio" && model.Variant == "sfx" {
		d.Kind, d.Title, d.Instrumental = "sfx", "CLI 音效", true
	}
	// 命令行一次只导出一个文件，多候选会白白多跑几遍。
	if n, ok := options["candidates"].(float64); ok && n > 1 {
		return fmt.Errorf("命令行每次只导出一版，换种子或重新运行代替 candidates")
	}
	// ACE-Step 需要演唱语言，未指定时交给模型判断；其余音乐模型从歌词与风格里判断。
	d.SynthesisLanguage = ""
	if model.Family == "ace_step" {
		d.SynthesisLanguage = "unknown"
		if language {
			d.SynthesisLanguage = d.Language
		}
	}
	d.ModelOptions = map[string]map[string]any{model.Family: options}
	if seed < -1 || seed > 2147483647 {
		return fmt.Errorf("随机种子必须在 0–2147483647 之间，或 -1 自动")
	}
	if seed >= 0 {
		n := int(seed)
		d.Seed = &n
	}
	return nil
}
