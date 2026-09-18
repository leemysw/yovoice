---
name: yovoice
description: 使用独立 yovoice CLI 在本地将文字生成语音，支持 IndexTTS、VoxCPM2、OmniVoice、Qwen3-TTS 的配音、声音设计和音色克隆。适用于配音、旁白、朗读和音色复用，无需桌面 App。
---

# yovoice 本地配音

使用 `yovoice --help` 检查命令是否可用，再运行 `yovoice status --json`。CLI 独立运行，无需安装桌面应用或开发环境。

## 安装 CLI

命令不可用时，从 [GitHub Releases](https://github.com/leemysw/yovoice/releases) 下载对应平台的独立 CLI 压缩包。文件名中的 `<版本>` 为 Release 标签，例如 `v0.1.0`。

| 平台 | 安装包 | 可执行文件 |
| --- | --- | --- |
| macOS · Apple Silicon | `yovoice-<版本>-cli-macos-arm64.zip` | `yovoice` |
| Windows · x64 | `yovoice-<版本>-cli-windows-x64.zip` | `yovoice.exe` |
| Linux · x64 | `yovoice-<版本>-cli-linux-x64.zip` | `yovoice` |

完整解压并保留同级 `tools/` 目录，将可执行文件所在目录加入用户 PATH，重新启动 Agent，再执行 `yovoice --version` 验证安装。也可通过可执行文件的绝对路径调用。压缩包包含本 Skill；安装 Skill 不会自动安装 CLI、引擎或模型。

## 准备

- 仅支持 Apple Silicon macOS、Windows x64 和 Linux x64。所有命令的选项放在命令及位置参数之后。
- 默认数据目录 `~/.yovoice`。如果被 App 或另一个 CLI 占用，不终止用户任务；使用用户指定的独立 `--data-dir`，所有后续命令保持同一路径。新目录需要独立准备运行时和登记模型。
- `yovoice models list --json` 查看真实模型 ID 和安装状态；`yovoice voices list --json` 查看可用音色 ID。
- 安装引擎、选择 CPU/GPU、下载或登记模型时，阅读[引擎与模型参考](references/setup.md)。
- 用户提供参考文件时用 `--reference`。常见音频格式内部自动转换；格式、时长限制和复用方式见[音频参考](references/audio.md)。IndexTTS 需要参考音色；VoxCPM2 可无需参考音频进行声音设计，模式与参数见同一参考文档。

- 选择模型变体、内置音色、设计属性或高级生成参数时，阅读[模型能力参考](references/models.md)。Qwen Base、CustomVoice、VoiceDesign 的输入不同，不混用参考音频、内置说话人和设计描述。

## 生成

把长正文写入 UTF-8 文件，避免 shell 转义和命令行长度问题。例如：

```sh
yovoice generate --text-file narration.txt --reference voice.wav --model index-2.5-q8 --language zh --speed 1 --output narration.wav --json
```

已有音色改用 `--voice ID`，与 `--reference` 互斥。IndexTTS 需要情绪指导时添加 `--emotion-text "温柔、平静"`；效果受模型、文本和参考音频影响，不承诺固定效果。仅在用户需要时调节参数，默认沿用参考音色。不要使用不存在的预设参数。

命令阻塞到完成，进度在 stderr，stdout 只有最终 JSON；失败返回非零退出码，错误 JSON 在 stderr。Ctrl-C 取消当前命令并清理引擎，不提供跨进程取消命令。不要因首次模型加载慢反复启动任务。

成功后使用 JSON 的绝对 `path` 和 `duration` 交付音频；能够播放时展示播放器。没有实际试听，不宣称音质验证通过。参数错误先修正，下载或推理失败保留错误和日志线索，不无条件循环重试。输出文件默认拒绝覆盖，重新生成使用新文件名。
