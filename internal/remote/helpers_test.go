package remote

import (
	"os"
	"testing"
	"yovoice/internal/testkit"
)

// 共用测试辅助，保持各测试文件的简短写法。
var (
	must = testkit.Must
	wav  = testkit.WAV
)

func ptr(s string) *string { return &s }

func TestMain(m *testing.M) {
	testkit.RunFakeEngine()
	os.Exit(m.Run())
}
