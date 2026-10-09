// Package testkit 提供多个包共用的测试辅助，仅由测试引用，不进入发布程序。
package testkit

import (
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func Must(t testing.TB, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

// WAV 返回一秒 16 kHz 单声道静音。
func WAV() []byte {
	b := make([]byte, 44+32000)
	copy(b, "RIFF")
	binary.LittleEndian.PutUint32(b[4:], uint32(len(b)-8))
	copy(b[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(b[16:], 16)
	binary.LittleEndian.PutUint16(b[20:], 1)
	binary.LittleEndian.PutUint16(b[22:], 1)
	binary.LittleEndian.PutUint32(b[24:], 16000)
	binary.LittleEndian.PutUint32(b[28:], 32000)
	binary.LittleEndian.PutUint16(b[32:], 2)
	binary.LittleEndian.PutUint16(b[34:], 16)
	copy(b[36:], "data")
	binary.LittleEndian.PutUint32(b[40:], 32000)
	return b
}

// RepoFile 定位仓库内文件，跨端一致性检查不依赖测试的工作目录。
func RepoFile(t testing.TB, parts ...string) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("caller")
	}
	return filepath.Join(append([]string{filepath.Dir(file), "..", ".."}, parts...)...)
}

// RunFakeEngine 在测试二进制被当作推理引擎启动时提供模拟服务，并在服务结束后退出进程。
// 正文为“等待取消”时挂起至请求取消；以“模拟生成失败”结尾时返回错误。
func RunFakeEngine() {
	if len(os.Args) <= 2 || os.Args[1] != "--config" {
		return
	}
	b, e := os.ReadFile(os.Args[2])
	if e != nil {
		os.Exit(2)
	}
	var config struct {
		Port int `json:"port"`
	}
	if json.Unmarshal(b, &config) != nil {
		os.Exit(2)
	}
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("{}")) })
	http.HandleFunc("/v1/tasks/run", func(w http.ResponseWriter, r *http.Request) {
		var p struct {
			Request struct {
				Text string `json:"text"`
			} `json:"request"`
		}
		_ = json.NewDecoder(r.Body).Decode(&p)
		if p.Request.Text == "等待取消" {
			<-r.Context().Done()
			return
		}
		if strings.HasSuffix(p.Request.Text, "模拟生成失败") {
			http.Error(w, "模拟生成失败", http.StatusInternalServerError)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"audio": base64.StdEncoding.EncodeToString(WAV())})
	})
	_ = http.ListenAndServe(fmt.Sprintf("127.0.0.1:%d", config.Port), nil)
	os.Exit(0)
}
