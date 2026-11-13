package schema

import (
	"fmt"
	"reflect"
	"strings"
	"testing"
)

// 用反射给 State 中每个 FileName 及以 File 结尾的字符串字段（如 AudioFile、VideoFile）填入不同的值，确认全部登记在 MediaRefs 中。
// 历史版本的 Settings 是生成时的作品快照，只记录参数，不代表文件仍被使用。
func TestMediaRefsCoverEveryFileName(t *testing.T) {
	var names []string
	var fill func(v reflect.Value, depth int)
	fill = func(v reflect.Value, depth int) {
		if depth > 8 {
			return
		}
		switch v.Kind() {
		case reflect.Pointer:
			v.Set(reflect.New(v.Type().Elem()))
			fill(v.Elem(), depth+1)
		case reflect.Slice:
			v.Set(reflect.MakeSlice(v.Type(), 1, 1))
			fill(v.Index(0), depth+1)
		case reflect.Struct:
			for i := range v.NumField() {
				f := v.Type().Field(i)
				if !f.IsExported() || (v.Type() == reflect.TypeFor[Generation]() && f.Name == "Settings") {
					continue
				}
				if (f.Name == "FileName" || strings.HasSuffix(f.Name, "File")) && f.Type.Kind() == reflect.String {
					name := fmt.Sprintf("file-%d", len(names))
					names = append(names, name)
					v.Field(i).SetString(name)
					continue
				}
				fill(v.Field(i), depth+1)
			}
		}
	}
	var s State
	fill(reflect.ValueOf(&s).Elem(), 0)
	refs := s.MediaRefs()
	for _, name := range names {
		if !refs["outputs"][name] && !refs["voices"][name] {
			t.Errorf("%s 对应的文件名字段未登记在 MediaRefs 中", name)
		}
	}
	if len(names) < 5 {
		t.Fatal("反射未覆盖到预期的 FileName 字段", names)
	}
}
