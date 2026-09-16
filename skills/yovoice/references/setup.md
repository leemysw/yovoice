# 引擎与模型

所有选项放在子命令和位置参数之后。以下命令默认使用 `~/.yovoice`；独立数据目录需在每条命令后添加同一个 `--data-dir /absolute/path`。

## 安装推理引擎

```sh
yovoice status --json
yovoice setup
```

`setup` 下载并校验 audio.cpp v0.7.4，不下载模型。默认 Mac 使用 Metal，Windows/Linux 使用 CPU。

| 平台 | 可选后端 | 命令 |
| --- | --- | --- |
| macOS Apple Silicon | Metal、CPU | `yovoice setup --backend metal` 或 `--backend cpu` |
| Windows x64 | CPU、Vulkan、CUDA 12.4 | `yovoice setup --backend cpu`、`--backend vulkan` 或 `--backend cuda` |
| Linux x64 | CPU、Vulkan | `yovoice setup --backend cpu` 或 `--backend vulkan` |

GPU 后端需要兼容的硬件与系统驱动。Linux 使用上游 Ubuntu x64 portable 包；不提供 Linux ARM64 包。切换后端时重新执行 `setup`。下载地址为 [audio.cpp v0.7.4 Releases](https://github.com/0xShug0/audio.cpp/releases/tag/v0.7.4)，CLI 自动选择平台包并校验 SHA-256，无需手动解压。

## 下载或登记模型

先查询本地安装状态，再选模型：

```sh
yovoice models list --json
yovoice models download index-2.5-q8
```

| 模型 ID | 大小（约） | 语言 |
| --- | --- | --- |
| `index-2.5-q8` | 3.50 GB | 中文、英语、日语、西班牙语、阿拉伯语 |
| `index-2.5-f16` | 4.55 GB | 同上 |
| `index-2-q8` | 3.63 GB | 中文、英语 |
| `index-2-f16` | 4.65 GB | 中文、英语 |

默认使用 ModelScope；可指定下载来源：

```sh
yovoice models download index-2.5-q8 --source modelscope
yovoice models download index-2.5-q8 --source huggingface
yovoice models download index-2.5-q8 --source mirror
```

下载前说明所选模型大小、来源及模型使用协议，并遵循用户授权。下载支持断点续传并校验摘要；失败后可重复同一命令。不要同时在同一数据目录启动多个命令。

已有兼容 GGUF 时直接登记，文件保持在原路径：

```sh
yovoice models import /absolute/index-tts2_5-q8_0.gguf
```

登记需要匹配目录中的已知模型及 SHA-256；不接受任意 GGUF。完成后用 `models list --json` 确认，不自行修改状态文件。

## 音频转换器

App 与 CLI 安装包均内置由 FFmpeg 8.1.2 源码裁剪构建的转换器，只保留音频解码、重采样和 WAV 输出，不包含视频编解码、网络协议或播放器。转换完全离线，不需要下载额外组件或安装系统 FFmpeg。CLI 解压时保留可执行文件同级的 `tools/` 目录。
