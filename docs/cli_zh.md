# CLI 与 Agent Skill

[English](cli.md) · 简体中文

无需打开桌面 App，即可通过命令行生成语音和音乐、转写录音、给歌曲分轨。支持 Apple Silicon macOS、Windows x64 和 Linux x64。

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

模型默认从 ModelScope 下载，可添加 `--source huggingface` 或 `--source mirror` 切换来源。下载支持断点续传和自动校验。只能安装 yovoice 列出的模型包，输入要求和示例见[模型选择](models_zh.md)。

## 生成语音

```sh
yovoice generate --model index-2.5-q8 --text-file narration.txt --reference voice.wav --output narration.wav
```

- 正文使用 `--text TEXT` 或 `--text-file FILE`，二选一。
- 克隆音色时，使用 `--reference FILE`，或从 `yovoice voices list` 获取 ID 后使用 `--voice ID`。
- 参考音频需为 1 秒到 10 分钟、不超过 20 MB；超过 60 秒时自动截取最清楚的 5–15 秒。支持 WAV、MP3、M4A/AAC、FLAC、OGG/Opus、AIFF、WMA、WebM，格式自动转换。
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

## 生成音乐

音乐模型（ACE-Step、YuE2、Stable Audio 3）同样使用 `generate`：`--text` 为风格描述，歌词单独传入：

```sh
yovoice generate --model yue2-3b-q8 --text "Mandarin, acoustic pop, warm female vocals, piano, 96 BPM" --lyrics-file song.txt --output song.wav
yovoice generate --model ace-step-1.5-turbo-q8 --text "city pop, warm synths" --lyrics-file song.txt --language zh --option 'duration_seconds=60' --output song.wav
yovoice generate --model stable-audio-3-small-sfx-q8 --text "door creaks open slowly" --option 'duration_seconds=5' --output door.wav
```

- 歌词使用 `--lyrics TEXT` 或 `--lyrics-file FILE`，可带 `[Verse]` 等段落标记；纯音乐使用 `--instrumental`。YuE2 不是纯音乐时必须提供歌词。
- YuE2 的结果 JSON 带有这次所用的旋律谱 `abc` 和 `seed`。改谱后用 `--abc-file FILE` 再生成，可保留旋律、只换风格或改一段。
- ACE-Step 用 `--language` 指定演唱语言；时长、YuE2 的 `cot` 等其他设置用 `--option`，各模型的 `generationOptions` 见 `yovoice models list --json`。
- Stable Audio 音效款生成音效，其余音乐模型生成歌曲。

## 转写、分轨与转 MIDI

以下命令处理已有的音频或视频，支持常见格式：

```sh
yovoice transcribe interview.mp4 --output interview.srt
yovoice separate song.mp3 --output-dir stems
yovoice to-midi song.mp3 --output song.mid
```

- `transcribe` 需要 `qwen3-asr-0.6b-q8`。输出扩展名决定格式：`.srt`、`.vtt`、`.txt`（每行一句）或 `.json`（原文、逐词时间与字幕行）。断句沿用 App 的语音转写设置，结果同时保存为转写记录，可在 App 中继续编辑。
- `separate` 需要 `htdemucs-6stems-q8`（另装 `bs-roformer-q8` 时人声更干净），在新建的“<文件名> Stems”文件夹中写入原混音和人声、鼓、贝斯、吉他、钢琴、其他六轨，长度一致。
- `to-midi` 需要 `muscriptor-small-f32`。输出 `.mid` 为多乐器 MIDI，`.json` 为编曲乐谱，可修改后用 `yovoice score render` 渲染。
- `separate` 和 `to-midi` 接受 10 分钟以内的歌曲。

## 编曲

用乐谱 JSON 或 MIDI 渲染配乐，需要先下载音色库，不需要推理引擎：

```sh
yovoice models download musescore-general-sf2
yovoice score render score.json --output music.wav --stems stems/
yovoice score midi score.json --output score.mid
yovoice score from-midi song.mid --output score.json
```

乐谱格式、混音约定和 MIDI 导入规则见[编曲](score_zh.md)。

## 以 stdio 方式提供 MCP

Claude Desktop、Cursor、Claude Code 等本机 MCP 客户端可以把 yovoice 作为子进程启动，无需令牌和端口：

```json
{
  "mcpServers": {
    "yovoice": {"command": "yovoice", "args": ["mcp"]}
  }
}
```

可执行文件不在客户端的 PATH 中时请写完整路径；在 `args` 中加上 `"--data-dir", "DIR"` 可使用独立目录。工具与[远程 MCP](api_zh.md#连接-mcp-客户端) 相同，区别有两点：结果返回生成 WAV 的本机路径 `path` 而不是 `downloadPath`；`upload_voice` 也可以传本机音频文件的 `path`。与其他命令一样，`yovoice mcp` 独占数据目录；桌面应用打开时，请改为连接它的[本机接口](api_zh.md#在同一台电脑上使用桌面应用) `http://127.0.0.1:8080/mcp`。

## 数据目录

默认目录与桌面应用相同：`~/.yovoice`，在“设置 › 存储”中迁移过时为迁移后的位置。同一时间只能由一个 App、CLI 命令或服务使用。请退出 App，或在每条命令中通过 `--data-dir DIR` 指定独立目录：

```sh
yovoice setup --data-dir ./voice-data
yovoice models download index-2.5-q8 --data-dir ./voice-data
yovoice generate --text-file narration.txt --reference voice.wav --output narration.wav --data-dir ./voice-data
```

引擎日志位于数据目录下的 `logs/` 文件夹。

## Agent Skill

将安装包中的 `skills/yovoice` 文件夹复制到 Agent 的 Skill 目录。本地生成还需将 CLI 加入 Agent 的 PATH；连接已有远程服务时，客户端无需安装 CLI 或模型。

可以让 Agent 读取文本、选择音色并保存生成结果。远程调用见 [API / MCP 部署](api_zh.md)，源码构建见[开发指南](development_zh.md)。
