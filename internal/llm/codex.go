package llm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"time"
	"yovoice/internal/msg"
	"yovoice/internal/platform"
)

// ChatGPT 订阅经本机官方 Codex CLI 调用：登录与令牌由 CLI 自己管理，yovoice 不读取也不保存凭证。
// 每次请求在空的临时目录里以只读沙箱运行 codex exec，忽略用户的 config.toml 与规则文件，
// 避免用户为编程配置的模型、MCP 和钩子影响写作请求。

// FormatCodex 表示经 Codex CLI 使用 ChatGPT 订阅，不走 HTTP 接口。
const FormatCodex = "codex_cli"

// CodexInfo 是 Codex CLI 的检测结果：Path 为空表示未安装；Login 为 chatgpt、apikey 或空（未登录）。
type CodexInfo struct {
	Path    string `json:"path,omitempty"`
	Version string `json:"version,omitempty"`
	Login   string `json:"login,omitempty"`
}

// 桌面应用从 Finder 启动时 PATH 只有系统目录，而 npm 安装的 codex 是 Node 脚本，需要补上常见的安装目录。
func searchDirs() []string {
	home, _ := os.UserHomeDir()
	if runtime.GOOS == "windows" {
		return []string{filepath.Join(os.Getenv("APPDATA"), "npm"), filepath.Join(os.Getenv("ProgramFiles"), "nodejs")}
	}
	dirs := []string{"/opt/homebrew/bin", "/usr/local/bin", filepath.Join(home, ".local", "bin"), filepath.Join(home, ".npm-global", "bin"), filepath.Join(home, ".volta", "bin"), filepath.Join(home, ".bun", "bin")}
	// nvm 安装的 Node 按版本号分目录，取版本最新的一个。
	if versions, _ := filepath.Glob(filepath.Join(home, ".nvm", "versions", "node", "*", "bin")); len(versions) > 0 {
		slices.Sort(versions)
		dirs = append(dirs, versions[len(versions)-1])
	}
	return dirs
}

func codexEnv(path string) []string {
	dirs := append([]string{filepath.Dir(path)}, searchDirs()...)
	env := os.Environ()
	for i, item := range env {
		if key, value, ok := strings.Cut(item, "="); ok && strings.EqualFold(key, "PATH") {
			env[i] = key + "=" + strings.Join(append(dirs, value), string(os.PathListSeparator))
			return env
		}
	}
	return append(env, "PATH="+strings.Join(dirs, string(os.PathListSeparator)))
}

// codexPath 先查 PATH，再查常见的安装目录。
var codexPath = func() string {
	if path, e := exec.LookPath("codex"); e == nil {
		return path
	}
	names := []string{"codex"}
	if runtime.GOOS == "windows" {
		names = []string{"codex.cmd", "codex.exe"}
	}
	for _, dir := range searchDirs() {
		for _, name := range names {
			if info, e := os.Stat(filepath.Join(dir, name)); e == nil && !info.IsDir() {
				return filepath.Join(dir, name)
			}
		}
	}
	return ""
}

func codexCommand(ctx context.Context, path string, args ...string) *exec.Cmd {
	c := exec.CommandContext(ctx, path, args...)
	c.Env = codexEnv(path)
	platform.ConfigureProcess(c)
	// 取消时结束整个进程组，Node 启动的子进程一起退出。
	c.Cancel = func() error { platform.KillProcess(c); return nil }
	c.WaitDelay = 5 * time.Second
	return c
}

// CodexStatus 检测 CLI 是否安装、版本和登录方式；只读取 `codex login status` 的输出，不接触凭证文件。
func CodexStatus(ctx context.Context) CodexInfo {
	path := codexPath()
	if path == "" {
		return CodexInfo{}
	}
	info := CodexInfo{Path: path}
	if out, e := codexCommand(ctx, path, "--version").Output(); e == nil {
		info.Version = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(string(out)), "codex-cli"))
	}
	out, _ := codexCommand(ctx, path, "login", "status").CombinedOutput()
	switch status := strings.ToLower(string(out)); {
	case strings.Contains(status, "not logged in"):
	case strings.Contains(status, "chatgpt"):
		info.Login = "chatgpt"
	case strings.Contains(status, "api key"):
		info.Login = "apikey"
	}
	return info
}

// CodexLogin 启动 `codex login`：CLI 自己打开浏览器完成 ChatGPT 登录，最长等待 10 分钟；返回登录进程的结束结果。
func CodexLogin(ctx context.Context) error {
	path := codexPath()
	if path == "" {
		return msg.Err(msg.ErrCodexMissing, nil)
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	out, e := codexCommand(ctx, path, "login").CombinedOutput()
	if e != nil {
		return msg.Err(msg.ErrCodexFailed, msg.Params{"detail": Sanitize(lastLine(out))})
	}
	return nil
}

// codexModels 读取 CLI 的模型目录，只列出界面可选（visibility 为 list）的模型。
func codexModels(ctx context.Context) ([]string, error) {
	path := codexPath()
	if path == "" {
		return nil, msg.Err(msg.ErrCodexMissing, nil)
	}
	out, e := codexCommand(ctx, path, "debug", "models").Output()
	if e != nil {
		return nil, msg.Err(msg.ErrCodexFailed, msg.Params{"detail": Sanitize(e.Error())})
	}
	var catalog struct {
		Models []struct {
			Slug       string `json:"slug"`
			Visibility string `json:"visibility"`
		} `json:"models"`
	}
	if e = json.Unmarshal(out, &catalog); e != nil {
		return nil, msg.Err(msg.ErrCodexFailed, msg.Params{"detail": Sanitize(e.Error())})
	}
	var models []string
	for _, m := range catalog.Models {
		if m.Visibility == "list" && m.Slug != "" {
			models = append(models, m.Slug)
		}
	}
	return models, nil
}

// codexPrompt 把系统提示与多轮消息合成一段指令：codex exec 只接受单条输入。
func codexPrompt(r Request) string {
	var b strings.Builder
	b.WriteString("你是写作助手，只根据下面的要求直接给出回答：不要运行命令、读取或修改文件，也不要解释你的做法。\n\n")
	if r.System != "" {
		b.WriteString("## 要求\n" + r.System + "\n\n")
	}
	for _, m := range r.Messages {
		role := "用户"
		if m.Role == "assistant" {
			role = "你之前的回答"
		}
		b.WriteString("## " + role + "\n" + m.Content + "\n\n")
	}
	return b.String()
}

// codexComplete 运行一次 codex exec，最后一条回复写入临时文件后读回；JSONL 事件只用来取出错误原因。
func codexComplete(ctx context.Context, c Config, r Request) (Result, error) {
	if len(r.Messages) == 0 {
		return Result{}, msg.Err(msg.ErrAINotConfigured, nil)
	}
	path := codexPath()
	if path == "" {
		return Result{}, msg.Err(msg.ErrCodexMissing, nil)
	}
	dir, e := os.MkdirTemp("", "yovoice-codex-")
	if e != nil {
		return Result{}, e
	}
	defer os.RemoveAll(dir)
	last := filepath.Join(dir, "last-message.txt")
	args := codexExecArgs(dir, last)
	if model := strings.TrimSpace(c.Model); model != "" {
		args = append(args, "--model", model)
	}
	// 带图片的消息把图片写进临时目录，用 --image 交给 codex。
	for i, m := range r.Messages {
		if m.Image == nil {
			continue
		}
		ext := ".jpg"
		if m.Image.MediaType == "image/png" {
			ext = ".png"
		}
		image := filepath.Join(dir, "image-"+strconv.Itoa(i)+ext)
		if e = os.WriteFile(image, m.Image.Data, 0600); e != nil {
			return Result{}, e
		}
		// 用 = 写法：--image 可以跟多个值，分开写会把后面的提示词参数也当成图片。
		args = append(args, "--image="+image)
	}
	cmd := codexCommand(ctx, path, append(args, "-")...)
	cmd.Dir = dir
	cmd.Stdin = strings.NewReader(codexPrompt(r))
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	e = cmd.Run()
	if ctx.Err() != nil {
		return Result{}, ctx.Err()
	}
	text, readErr := os.ReadFile(last)
	if e != nil || readErr != nil || len(bytes.TrimSpace(text)) == 0 {
		return Result{}, codexError(stdout.Bytes(), stderr.Bytes(), e)
	}
	return Result{Text: strings.TrimSpace(string(text))}, nil
}

// codexError 从 JSONL 的 error / turn.failed 事件取原因；未登录单独提示，其余带上原因。
func codexError(stdout, stderr []byte, runErr error) error {
	detail := ""
	scanner := bufio.NewScanner(bytes.NewReader(stdout))
	scanner.Buffer(make([]byte, 64<<10), 4<<20)
	for scanner.Scan() {
		var event struct {
			Type    string `json:"type"`
			Message string `json:"message"`
			Error   struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if json.Unmarshal(scanner.Bytes(), &event) != nil {
			continue
		}
		if event.Type == "error" && event.Message != "" {
			detail = event.Message
		} else if event.Type == "turn.failed" && event.Error.Message != "" {
			detail = event.Error.Message
		}
	}
	if detail == "" {
		detail = lastLine(stderr)
	}
	if detail == "" && runErr != nil {
		detail = runErr.Error()
	}
	lower := strings.ToLower(detail)
	if strings.Contains(lower, "not logged in") || strings.Contains(lower, "login") && strings.Contains(lower, "required") || strings.Contains(lower, "401") {
		return msg.Err(msg.ErrCodexLoggedOut, nil)
	}
	if strings.Contains(lower, "usage limit") || strings.Contains(lower, "rate limit") || strings.Contains(lower, "429") {
		return msg.Err(msg.ErrCodexLimit, nil)
	}
	return msg.Err(msg.ErrCodexFailed, msg.Params{"detail": Sanitize(detail)})
}

// lastLine 取输出里最后一行非空文本作为原因。
func lastLine(out []byte) string {
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		if line := strings.TrimSpace(lines[i]); line != "" {
			return line
		}
	}
	return ""
}
