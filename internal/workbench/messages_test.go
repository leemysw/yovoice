package workbench

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestMessageCodesCoveredByCatalogs(t *testing.T) {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("caller")
	}
	root := filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..", "web", "src", "shared", "i18n", "catalogs"))
	for _, name := range []string{"en.json", "zh-CN.json"} {
		b, err := os.ReadFile(filepath.Join(root, name))
		if err != nil {
			t.Fatal(err)
		}
		var catalog map[string]any
		if err := json.Unmarshal(b, &catalog); err != nil {
			t.Fatal(err)
		}
		for _, code := range AllMessageCodes() {
			if _, ok := catalog[string(code)]; !ok {
				t.Fatalf("%s missing %s", name, code)
			}
		}
	}
}
