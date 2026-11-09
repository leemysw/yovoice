package audio

import (
	"math"
	"path/filepath"
	"testing"
)

// 分轨补齐：结果是混音减去各轨之和，较短的轨按静音处理；叠回去与原混音一致（16 位量化误差内）。
func TestRemainderCompletesStems(t *testing.T) {
	dir := t.TempDir()
	const rate, n = 8000, 70000 // 跨过多个处理块
	mix, a, b := make([]float32, n), make([]float32, n), make([]float32, n/2)
	for i := range mix {
		a[i] = float32(.3 * math.Sin(float64(i)*.05))
		if i < len(b) {
			b[i] = float32(.2 * math.Sin(float64(i)*.013))
		}
		mix[i] = a[i] + .1
		if i < len(b) {
			mix[i] += b[i]
		}
	}
	paths := map[string][]float32{"mix.wav": mix, "a.wav": a, "b.wav": b}
	for name, samples := range paths {
		if e := WriteMono(filepath.Join(dir, name), samples, rate); e != nil {
			t.Fatal(e)
		}
	}
	out := filepath.Join(dir, "rest.wav")
	if e := Remainder(filepath.Join(dir, "mix.wav"), []string{filepath.Join(dir, "a.wav"), filepath.Join(dir, "b.wav")}, out); e != nil {
		t.Fatal(e)
	}
	rest, got, e := Read(out)
	if e != nil || got != rate || len(rest) != 1 || len(rest[0]) != n {
		t.Fatalf("%v %d %d", e, got, len(rest))
	}
	for i, v := range rest[0] {
		if math.Abs(float64(v)-.1) > 3.0/32768 {
			t.Fatalf("frame %d: %f", i, v)
		}
	}
}
