package workbench

import (
	"bytes"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"testing"
)

// repoFile 定位仓库内文件，跨端一致性检查不依赖测试的工作目录。
func repoFile(t *testing.T, parts ...string) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("caller")
	}
	return filepath.Join(append([]string{filepath.Dir(file), "..", ".."}, parts...)...)
}

// Go 嵌入文件与界面副本必须逐字节一致；修改任一侧后复制到另一侧。
func TestSharedDataMatchesWeb(t *testing.T) {
	for core, web := range map[string]string{
		"catalog.json":            "catalog.json",
		"generation_options.json": "generation-options.json",
		"omni_attributes.json":    "omni-attributes.json",
	} {
		a, err := os.ReadFile(repoFile(t, "internal", "workbench", core))
		if err != nil {
			t.Fatal(err)
		}
		b, err := os.ReadFile(repoFile(t, "web", "src", "shared", "lib", web))
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(a, b) {
			t.Errorf("internal/workbench/%s 与 web/src/shared/lib/%s 不一致，请同步两份文件", core, web)
		}
	}
}

// AllMessageCodes 为手写清单，新增常量遗漏时目录覆盖检查会静默失效。
func TestAllMessageCodesListed(t *testing.T) {
	file, err := parser.ParseFile(token.NewFileSet(), repoFile(t, "internal", "workbench", "messages.go"), nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	listed := map[MessageCode]bool{}
	for _, code := range AllMessageCodes() {
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
			if typ, ok := v.Type.(*ast.Ident); !ok || typ.Name != "MessageCode" {
				continue
			}
			for i, name := range v.Names {
				code, err := strconv.Unquote(v.Values[i].(*ast.BasicLit).Value)
				if err != nil {
					t.Fatal(err)
				}
				declared++
				if !listed[MessageCode(code)] {
					t.Errorf("%s 未加入 AllMessageCodes", name.Name)
				}
			}
		}
	}
	if declared != len(listed) {
		t.Errorf("AllMessageCodes 有 %d 项，声明了 %d 个常量", len(listed), declared)
	}
}

// 升级 audio.cpp 时，服务端在线安装与桌面打包脚本必须使用同一版本。
func TestEngineVersionConsistent(t *testing.T) {
	pattern := regexp.MustCompile(`audio-(v\d+\.\d+\.\d+)-|releases/download/(v\d+\.\d+\.\d+)/`)
	for name := range archives {
		if m := pattern.FindStringSubmatch(name); m == nil || m[1] != EngineVersion {
			t.Errorf("运行时包 %s 与 EngineVersion %s 不一致", name, EngineVersion)
		}
	}
	for _, script := range []string{"build-macos.sh", "build-windows.ps1"} {
		b, err := os.ReadFile(repoFile(t, "scripts", "desktop", script))
		if err != nil {
			t.Fatal(err)
		}
		matches := pattern.FindAllStringSubmatch(string(b), -1)
		if len(matches) == 0 {
			t.Errorf("%s 未引用 audio.cpp 版本", script)
		}
		for _, m := range matches {
			if version := m[1] + m[2]; version != EngineVersion {
				t.Errorf("%s 使用 audio.cpp %s，EngineVersion 为 %s", script, version, EngineVersion)
			}
		}
	}
}
