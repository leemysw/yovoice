# 独立 CLI 与 Agent Skill

CLI 直接调用 Go 核心和 audio.cpp，不需要安装、启动桌面 App，也不需要 Node.js、WebView 或 Python 推理环境。支持 Apple Silicon macOS、Windows x64 和 Linux x64。

## 安装

从 [GitHub Releases](https://github.com/leemysw/yovoice/releases) 下载对应平台的独立 CLI 压缩包，无需安装 Go 或克隆仓库。文件名中的 `<版本>` 对应 Release 标签。

| 平台 | 安装包 | 可执行文件 |
| --- | --- | --- |
| macOS · Apple Silicon | `yovoice-<版本>-cli-macos-arm64.zip` | `yovoice` |
| Windows · x64 | `yovoice-<版本>-cli-windows-x64.zip` | `yovoice.exe` |
| Linux · x64 | `yovoice-<版本>-cli-linux-x64.zip` | `yovoice` |

1. 解压安装包，保留可执行文件及同级 `tools/` 目录，一起放入固定目录。macOS 和 Linux 可使用 `~/.local/share/yovoice-cli`，Windows 可使用 `%LOCALAPPDATA%\Programs\yovoice-cli`。
2. 将该目录加入用户 PATH，并重新打开终端；从 Agent 调用时，也需要重启 Agent。无需配置 PATH 时，可直接使用可执行文件的绝对路径。
3. 运行 `yovoice --version` 和 `yovoice --help` 验证安装。

安装包同时包含 Skill、协议和说明。引擎和模型在首次使用时按需下载。正式发布的 macOS CLI 使用 Developer ID 签名并提交 Apple 公证。

开发构建见[开发说明](development.md#standalone-cli)。

模型与引擎下载详见[准备参考](../skills/yovoice/references/setup.md)，音频格式与转换详见[音频参考](../skills/yovoice/references/audio.md)。

## 使用

```sh
yovoice --help
yovoice status --json
yovoice setup                         # Mac 默认 Metal，Windows 和 Linux 默认 CPU
yovoice models list --json
yovoice models download index-2.5-q8   # 默认 ModelScope，数 GB 下载
yovoice voices import voice.wav --name 我的音色
yovoice voices list --json
yovoice generate --text-file narration.txt --reference voice.wav --output narration.wav --json
```

模型使用须遵守 [模型协议](../web/public/model-license.txt)。已有 GGUF 可通过 `yovoice models import /absolute/model.gguf` 校验登记，无需重复下载。下载支持 `--source huggingface` 或 `--source mirror`。引擎和模型复用核心的摘要校验。

生成支持 `--model`、`--language`、`--speed`、`--emotion-text`。`--text` 和 `--text-file` 二选一；`--voice ID` 和 `--reference AUDIO` 二选一。参考音频支持 WAV、MP3、M4A/AAC、FLAC、OGG/Opus、AIFF、WMA、WebM，需为 1–60 秒且不超过 20 MB。非兼容 WAV 在内部自动转换，转换器已内置，无需额外安装或下载。参考文件会登记进音色库，生成结果和参数保存在历史中。

默认输出 JSON，`--json` 用于明确调用意图。进度写 stderr，成功时 stdout 返回结果对象；失败 stderr 返回错误 JSON，退出码为 1，Ctrl-C 为 130。生成结果示例：

```json
{"id":"...","path":"/absolute/narration.wav","duration":4.2,"model":"index-2.5-q8","voice":"..."}
```

输出必须指定 `.wav` 路径，不覆盖已有文件。命令等待任务完成，退出时释放引擎；Ctrl-C 取消并等待清理。第一版为单次生成，不启动常驻服务，连续调用会重新加载模型。

## 数据隔离

所有命令支持 `--data-dir DIR`，放在命令及位置参数之后。默认 `~/.yovoice`，使用与 App 相同的排他锁；同一目录不能同时被 App 和 CLI 使用。关闭 App 的窗口不等于退出，使用退出菜单释放目录，或为 CLI 指定独立目录：

```sh
yovoice setup --data-dir ./voice-data
yovoice models import /absolute/model.gguf --data-dir ./voice-data
yovoice generate --text "你好" --reference voice.wav --output hello.wav --data-dir ./voice-data
```

引擎日志位于数据目录的 `logs/`。CLI 不修改全局环境，不读取桌面窗口或会话凭证。

## Agent Skill

将 CLI 安装包中的 `skills/yovoice` 文件夹复制到 Agent 支持的 Skill 目录；例如 Codex 的 `~/.codex/skills/yovoice`。CLI 需单独安装并在 Agent 的 PATH 中可见。Skill 负责环境检查、参考音色选择、生成参数和结果交付，实际生成由 CLI 执行。

Linux 使用上游 Ubuntu x64 引擎包，CI 在 Ubuntu 24.04 验证。默认 CPU，可用 `yovoice setup --backend vulkan` 切换 Vulkan（需系统安装兼容的 GPU 驱动）。当前不提供 Linux ARM64 包。
