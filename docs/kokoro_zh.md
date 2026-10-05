# Kokoro

[English](kokoro.md) · 简体中文

Kokoro 使用内置音色生成语音，不需要参考录音。

## 选择模型

| 模型 ID | 大小 | 音色与语言 | 安装方式 |
| --- | --- | --- | --- |
| `kokoro-82m-q8` | 约 190 MB | 49 个音色，支持日语以外的多种语言 | 下载 |
| `kokoro-82m-bf16` | 约 212 MB | 音色与 Q8 相同 | 下载 |
| `kokoro-1.0-q8` | 约 933 MB | 54 个音色，包含日语 | 导入兼容的 GGUF |
| `kokoro-1.1-zh-q8` | 约 255 MB | 100 个中文和 3 个英文音色，实验性支持 | 导入兼容的 GGUF |

可下载模型支持中文、英语（美式与英式）、西班牙语、法语、印地语、意大利语和巴西葡萄牙语。1.1-zh 的音色 ID 与 1.0 不通用。

## 生成语音

```sh
yovoice models download kokoro-82m-q8
yovoice generate --model kokoro-82m-q8 --speaker zf_xiaobei --text "你好，欢迎使用。" --output hello.wav
```

通过 `yovoice models list --json` 查看可用音色 ID。语言随音色选择；官方模型的中文音色可用 `zf_xiaobei`，1.1-zh 可用 `zf_001`。

默认按 64 个字符分段，需要时可通过 `--option 'text_chunk_size=120'` 调整；单段仍受引擎音素数量上限限制。

Kokoro 不支持音色克隆或文字情绪控制。请保留 CLI 安装包中的 `tools/` 目录。安装引擎和模型后，生成过程可离线运行。完整多语言模型首次加载可能较慢。

返回 [CLI 指南](cli_zh.md)或[模型选择](models_zh.md)。
