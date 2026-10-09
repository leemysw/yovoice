package msg

import (
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

func TestMessageCodesCoveredByCatalogs(t *testing.T) {
	root := repoFile(t, "web", "src", "shared", "i18n", "catalogs")
	for _, name := range []string{"en.json", "zh-cn.json"} {
		b, err := os.ReadFile(filepath.Join(root, name))
		if err != nil {
			t.Fatal(err)
		}
		var catalog map[string]any
		if err := json.Unmarshal(b, &catalog); err != nil {
			t.Fatal(err)
		}
		for _, code := range All() {
			if _, ok := catalog[string(code)]; !ok {
				t.Fatalf("%s missing %s", name, code)
			}
		}
	}
}

// All 为手写清单，新增常量遗漏时目录覆盖检查会静默失效。
func TestAllCodesListed(t *testing.T) {
	file, err := parser.ParseFile(token.NewFileSet(), repoFile(t, "internal", "msg", "msg.go"), nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	listed := map[Code]bool{}
	for _, code := range All() {
		listed[code] = true
	}
	declared := 0
	for _, decl := range file.Decls {
		gen, ok := decl.(*ast.GenDecl)
		if !ok || gen.Tok != token.CONST {
			continue
		}
		for _, spec := range gen.Specs {
			v := spec.(*ast.ValueSpec)
			if typ, ok := v.Type.(*ast.Ident); !ok || typ.Name != "Code" {
				continue
			}
			for i, name := range v.Names {
				code, err := strconv.Unquote(v.Values[i].(*ast.BasicLit).Value)
				if err != nil {
					t.Fatal(err)
				}
				declared++
				if !listed[Code(code)] {
					t.Errorf("%s 未加入 All", name.Name)
				}
			}
		}
	}
	if declared != len(listed) {
		t.Errorf("All 有 %d 项，声明了 %d 个常量", len(listed), declared)
	}
}
