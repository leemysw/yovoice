# CLI 与 Agent Skill

[English](cli.md) · 简体中文

无需打开桌面 App，即可通过命令行生成语音。支持 Apple Silicon macOS、Windows x64 和 Linux x64。

## 安装

从 [Releases](https://github.com/leemysw/yovoice/releases) 下载对应平台的 CLI 压缩包。

| 平台 | 安装包 | 可执行文件 |
| --- | --- | --- |
| macOS · Apple Silicon | `yovoice-<版本>-cli-macos-arm64.zip` | `yovoice` |
| Windows · x64 | `yovoice-<版本>-cli-windows-x64.zip` | `yovoice.exe` |
| Linux · x64 | `yovoice-<版本>-cli-linux-x64.zip` | `yovoice` |

解压后保留可执行文件同级的 `tools/` 目录。将所在目录加入 PATH，或通过完整路径运行。更改 PATH 后重新打开终端。

```sh
yovoice --version
yovoice --help
```

安装包已包含音频转换器，无需另外安装 FFmpeg、Python 或 Go。引擎和模型需要单独下载。

## 准备引擎与模型

```sh
yovoice setup
yovoice models list --json
yovoice models download index-2.5-q8
```

`setup` 默认在 macOS 使用 Metal，在 Windows/Linux 使用 CPU。可指定其他后端：

| 平台 | 支持的后端 |
| --- | --- |
| macOS · Apple Silicon | `--backend metal`、`--backend cpu` |
| Windows · x64 | `--backend cpu`、`--backend cuda`、`--backend vulkan` |
| Linux · x64 | `--backend cpu`、`--backend vulkan` |

GPU 后端需要兼容的硬件和驱动。切换后端时重新运行 `setup`。

模型默认从 ModelScope 下载，可添加 `--source huggingface` 或 `--source mirror` 切换来源。下载支持断点续传和自动校验。已有受支持的 GGUF 文件可以直接登记：

```sh
yovoice models import /absolute/path/model.gguf
```

仅接受 yovoice 已识别的模型包。输入要求和示例见[模型选择](models_zh.md)。

## 生成语音

```sh
yovoice generate --model index-2.5-q8 --text-file narration.txt --reference voice.wav --output narration.wav
```

- 正文使用 `--text TEXT` 或 `--text-file FILE`，二选一。
- 克隆音色时，使用 `--reference FILE`，或从 `yovoice voices list` 获取 ID 后使用 `--voice ID`。
- 参考音频需为 1–60 秒、不超过 20 MB。支持 WAV、MP3、M4A/AAC、FLAC、OGG/Opus、AIFF、WMA、WebM，格式自动转换。
- 输出路径需以 `.wav` 结尾，不覆盖已有文件。
- 命令等待生成完成，Ctrl-C 可取消。重复运行 `generate` 会重新加载模型；需要常驻引擎时使用[远程服务](api_zh.md)。

保存可复用的参考音色：

```sh
yovoice voices import voice.wav --name 旁白
yovoice voices list --json
```

进度写入 stderr，结果以 JSON 写入 stdout：

```json
{"id":"...","path":"/absolute/narration.wav","duration":4.2,"model":"index-2.5-q8","voice":"..."}
```

失败时 stderr 返回错误，退出码为 1；Ctrl-C 的退出码为 130。

## 数据目录

默认目录为 `~/.yovoice`，同一时间只能由一个 App、CLI 命令或服务使用。请退出 App，或在每条命令中通过 `--data-dir DIR` 指定独立目录：

```sh
yovoice setup --data-dir ./voice-data
yovoice models download index-2.5-q8 --data-dir ./voice-data
yovoice generate --text-file narration.txt --reference voice.wav --output narration.wav --data-dir ./voice-data
```

引擎日志位于数据目录下的 `logs/` 文件夹。

## Agent Skill

将安装包中的 `skills/yovoice` 文件夹复制到 Agent 的 Skill 目录。本地生成还需将 CLI 加入 Agent 的 PATH；连接已有远程服务时，客户端无需安装 CLI 或模型。

可以让 Agent 读取文本、选择音色并保存生成结果。远程调用见 [API / MCP 部署](api_zh.md)，源码构建见[开发指南](development_zh.md)。
