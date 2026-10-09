package workbench

import (
	"encoding/json"
	"os"
	"path/filepath"
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
		for _, code := range AllMessageCodes() {
			if _, ok := catalog[string(code)]; !ok {
				t.Fatalf("%s missing %s", name, code)
			}
		}
	}
}
