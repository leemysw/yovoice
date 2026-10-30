package schema_test

import (
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"slices"
	"strings"
	"testing"
	"yovoice/internal/catalog"
	"yovoice/internal/schema"
	"yovoice/internal/testkit"
)

// 界面在 web/src/shared/workbench/ 下手写镜像这些结构；字段名不一致时保存会静默丢失数据。
func TestFrontendTypesMatchSchema(t *testing.T) {
	interfaces := tsInterfaces(readTypeScript(t, testkit.RepoFile(t, "web", "src", "shared", "workbench")))
	// 仅后端保留、界面有意不读写的字段。
	goOnly := map[string][]string{
		"AudioClip":    {"fadeIn", "fadeOut"},              // 旧版淡化，读取时忽略
		"ModelPackage": {"revision", "repo", "modelScope"}, // 下载时固定的仓库与修订号
	}
	// 仅界面使用、不随状态保存的字段。
	tsOnly := map[string][]string{
		"State": {"assistantMissing"}, // state.get 附带的随包助手可用性，不入库
	}
	for _, value := range []any{
		schema.SynthesisSettings{}, schema.SubtitleSpeaker{}, schema.CharacterPerformance{}, schema.SubtitleCue{}, schema.SubtitleDocument{},
		schema.AudioClip{}, schema.AudioLane{}, schema.AudioAsset{}, schema.AudioMarker{}, schema.AudioTimeline{}, schema.Draft{},
		schema.CharacterPreview{}, schema.Character{}, schema.Voice{}, schema.InstalledModel{}, schema.Generation{},
		schema.GenerationSegment{}, schema.AudioCheck{}, schema.AudioIssue{}, schema.VoiceExcerpt{}, schema.Activity{}, schema.Preferences{}, schema.State{}, catalog.ModelPackage{},
		schema.Score{}, schema.ScoreSection{}, schema.ScoreTrack{}, schema.Humanize{}, schema.ScoreRamp{}, schema.ScoreNote{},
		schema.AIProvider{}, schema.AITest{}, schema.AITask{}, schema.MelodyResult{},
		schema.AssistantMessage{}, schema.AssistantBlock{}, schema.AssistantToolCard{}, schema.AssistantSession{}, schema.AssistantSessions{}, schema.AssistantTurn{}, schema.AssistantNav{}, schema.AssistantUpdate{}, schema.AssistantLive{},
	} {
		typ := reflect.TypeOf(value)
		ts, ok := interfaces[typ.Name()]
		if !ok {
			t.Errorf("shared/workbench 缺少接口 %s", typ.Name())
			continue
		}
		fields := jsonFields(typ)
		for _, name := range fields {
			if !slices.Contains(ts, name) && !slices.Contains(goOnly[typ.Name()], name) {
				t.Errorf("%s.%s 只在 Go 中定义", typ.Name(), name)
			}
		}
		for _, name := range ts {
			if !slices.Contains(fields, name) && !slices.Contains(tsOnly[typ.Name()], name) {
				t.Errorf("%s.%s 只在 TS 中定义，后端不会保存", typ.Name(), name)
			}
		}
	}
}

// readTypeScript 拼接目录下全部 .ts 文件：类型按职责分在多个文件里，接口在哪个文件不重要。
func readTypeScript(t *testing.T, dir string) string {
	entries, err := os.ReadDir(dir)
	testkit.Must(t, err)
	var all strings.Builder
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".ts") {
			continue
		}
		source, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		testkit.Must(t, err)
		all.Write(source)
		all.WriteByte('\n')
	}
	return all.String()
}

// jsonFields 返回结构体序列化后的字段名，展开匿名嵌入的结构体。
func jsonFields(typ reflect.Type) []string {
	var names []string
	for field := range typ.Fields() {
		if field.Anonymous {
			names = append(names, jsonFields(field.Type)...)
			continue
		}
		if name, _, _ := strings.Cut(field.Tag.Get("json"), ","); name != "" && name != "-" {
			names = append(names, name)
		}
	}
	return names
}

// tsInterfaces 解析导出接口的顶层字段名，合并 extends 继承的字段。
func tsInterfaces(source string) map[string][]string {
	header := regexp.MustCompile(`export interface (\w+)(?: extends (\w+))? \{`)
	field := regexp.MustCompile(`^\s*(\w+)\??:`)
	own, parents := map[string][]string{}, map[string]string{}
	for _, match := range header.FindAllStringSubmatchIndex(source, -1) {
		name := source[match[2]:match[3]]
		if match[4] >= 0 {
			parents[name] = source[match[4]:match[5]]
		}
		depth, start := 0, match[1]
		for i := start; i < len(source); i++ {
			switch source[i] {
			case '{':
				depth++
			case ';', '\n':
				if depth == 0 {
					if m := field.FindStringSubmatch(source[start:i]); m != nil {
						own[name] = append(own[name], m[1])
					}
					start = i + 1
				}
			case '}':
				if depth--; depth < 0 {
					if m := field.FindStringSubmatch(source[start:i]); m != nil {
						own[name] = append(own[name], m[1])
					}
					i = len(source)
				}
			}
		}
	}
	result := map[string][]string{}
	for name, fields := range own {
		for parent := parents[name]; parent != ""; parent = parents[parent] {
			fields = append(fields, own[parent]...)
		}
		result[name] = fields
	}
	return result
}

// 界面语言清单在 web/src/shared/i18n/locale.ts 与 UiLocaleNames 各写一份，并且每种语言都要有翻译目录。
func TestUiLocalesMatchFrontend(t *testing.T) {
	source, err := os.ReadFile(testkit.RepoFile(t, "web", "src", "shared", "i18n", "locale.ts"))
	testkit.Must(t, err)
	var ids []string
	for _, match := range regexp.MustCompile(`\{ id: '([^']+)', name: `).FindAllStringSubmatch(string(source), -1) {
		ids = append(ids, match[1])
	}
	var names []string
	for locale := range schema.UiLocaleNames {
		names = append(names, string(locale))
	}
	slices.Sort(ids)
	slices.Sort(names)
	if !slices.Equal(ids, names) {
		t.Fatalf("locale.ts %v 与 UiLocaleNames %v 不一致", ids, names)
	}
	for _, id := range ids {
		if _, err := os.Stat(testkit.RepoFile(t, "web", "src", "shared", "i18n", "catalogs", strings.ToLower(id)+".json")); err != nil {
			t.Errorf("缺少 %s 的翻译目录", id)
		}
	}
}
