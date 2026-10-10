package schema_test

import (
	"os"
	"reflect"
	"regexp"
	"slices"
	"strings"
	"testing"
	"yovoice/internal/catalog"
	"yovoice/internal/schema"
	"yovoice/internal/testkit"
)

// 界面在 web/src/shared/workbench.ts 手写镜像这些结构；字段名不一致时保存会静默丢失数据。
func TestFrontendTypesMatchSchema(t *testing.T) {
	source, err := os.ReadFile(testkit.RepoFile(t, "web", "src", "shared", "workbench.ts"))
	testkit.Must(t, err)
	interfaces := tsInterfaces(string(source))
	// 仅后端保留、界面有意不读写的字段。
	goOnly := map[string][]string{
		"AudioClip":    {"fadeIn", "fadeOut"}, // 旧版淡化，读取时忽略
		"ModelPackage": {"revision", "repo"},  // 下载时固定的仓库与修订号
	}
	for _, value := range []any{
		schema.SynthesisSettings{}, schema.SubtitleSpeaker{}, schema.CharacterPerformance{}, schema.SubtitleCue{}, schema.SubtitleDocument{},
		schema.AudioClip{}, schema.AudioLane{}, schema.AudioAsset{}, schema.AudioMarker{}, schema.AudioTimeline{}, schema.Draft{},
		schema.CharacterPreview{}, schema.Character{}, schema.Voice{}, schema.InstalledModel{}, schema.Generation{},
		schema.GenerationSegment{}, schema.Activity{}, schema.Preferences{}, schema.State{}, catalog.ModelPackage{},
		schema.Score{}, schema.ScoreSection{}, schema.ScoreTrack{}, schema.Humanize{}, schema.ScoreRamp{}, schema.ScoreNote{},
	} {
		typ := reflect.TypeOf(value)
		ts, ok := interfaces[typ.Name()]
		if !ok {
			t.Errorf("workbench.ts 缺少接口 %s", typ.Name())
			continue
		}
		fields := jsonFields(typ)
		for _, name := range fields {
			if !slices.Contains(ts, name) && !slices.Contains(goOnly[typ.Name()], name) {
				t.Errorf("%s.%s 只在 Go 中定义", typ.Name(), name)
			}
		}
		for _, name := range ts {
			if !slices.Contains(fields, name) {
				t.Errorf("%s.%s 只在 TS 中定义，后端不会保存", typ.Name(), name)
			}
		}
	}
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
