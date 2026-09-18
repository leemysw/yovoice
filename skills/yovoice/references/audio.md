# 参考音频

CLI 与 App 共用后端导入和转换逻辑。接受 WAV、MP3、M4A/AAC、FLAC、OGG/Opus、AIFF、WMA、WebM 音频。编码损坏、加密或不包含音轨的文件会报错。

- 输入为本地文件，最大 20 MB，时长 1–60 秒。
- 兼容的 PCM/Float WAV 直接使用；其他音频在内部转为单声道、24 kHz、16 位 PCM WAV。
- 超过 60 秒会拒绝导入，不静默截断；需先裁剪用户选定的片段。
- 原文件保持不变，音色库保存 WAV 副本，名称默认取原文件名。
- 转换器随安装包集成，首次转换也无需联网，见[准备文档](setup.md#音频转换器)。

直接生成：

```sh
yovoice generate --text-file narration.txt --reference voice.mp3 --output narration.wav --json
```

登记音色后复用：

```sh
yovoice voices import voice.m4a --name 旁白音色
yovoice voices list --json
yovoice generate --text-file narration.txt --voice <实际音色ID> --output narration.wav --json
```

选择清晰、单人、少混响的声音片段，避免背景音乐。文件格式兼容不代表音色克隆效果已验证；没有试听时只报告生成完成。输出仍为 WAV。

## VoxCPM2

无参考音频时使用声音设计，不要求用户先提供音色：

```sh
yovoice generate --model voxcpm2-q8 --text-file narration.txt --voice-description "温柔清澈的女声，语速舒缓" --output narration.wav
```

- 声音设计：无 `--reference` / `--voice`；`--voice-description` 可省略。
- 音色克隆：传入 `--reference AUDIO` 或 `--voice ID`，可通过 `--voice-description` 指导情绪和语气。
- 精细克隆：同时提供参考音频和 `--reference-text "音频中的准确原文"`，不加声音描述。目标正文仍放在 `--text-file`。
- 可显式指定 `--vox-mode design|clone|continuation`；默认根据参考音频和原文自动选择。
- 自动处理支持的语言，输出 48 kHz WAV。不要传 IndexTTS 的 `--language`、`--speed`、`--emotion-text`。
- 高级参数 `--guidance-scale 2`、`--inference-steps 10` 沿用模型默认；需要可复现时指定 `--seed 123`。实际结果仍受后端与模型精度影响。

声音描述最多 500 字，参考原文最多 2000 字。App 的三个生成模式与 CLI 对应，参考音频导入限制保持一致。

### OmniVoice 与 Qwen3-TTS

App 在模型设置中下载后，从创作页模型菜单切换。两者均完整生成后播放，可自动识别语言或显式指定语言，支持随机种子。使用引擎原生采样默认值，不沿用 IndexTTS 的情绪、语速或采样设置。

| 模型 | Q8 | BF16 | 用途 |
| --- | --- | --- | --- |
| OmniVoice | `omnivoice-q8` | `omnivoice-bf16` | 文字设计音色、参考音色克隆 |
| Qwen3-TTS 1.7B Base | `qwen3-tts-base-q8` | `qwen3-tts-base-bf16` | 参考音色克隆 |

```sh
yovoice models download omnivoice-q8 --source modelscope
yovoice models download qwen3-tts-base-q8 --source modelscope
yovoice generate --model omnivoice-q8 --text "你好，欢迎来到声音的世界。" --voice-description "female, young adult, moderate pitch" --output design.wav
yovoice generate --model omnivoice-q8 --text-file narration.txt --reference voice.wav --reference-text "参考音频原文" --output omni-clone.wav
yovoice generate --model qwen3-tts-base-q8 --text-file narration.txt --reference voice.wav --reference-text "参考音频原文" --output qwen-clone.wav
```

OmniVoice 自动根据是否提供参考音频选择设计或克隆，也可用 `--voice-mode design|clone` 指定。设计模式使用逗号分隔的预定义属性（如 `female, young adult, moderate pitch` 或 `女, 青年, 中音调`），不接受任意自由描述；可省略属性让模型自动选择音色。克隆模式不叠加设计描述。OmniVoice 克隆必须提供与录音一致的原文；Qwen Base 的原文可选，Qwen3-TTS 无原文时使用 `x_vector_only_mode` 仅提取说话人特征。Qwen3-TTS 同时支持 1.7B CustomVoice、VoiceDesign 和 0.6B Base；各变体使用不同输入。

OmniVoice 权重为 [CC-BY-NC](https://huggingface.co/k2-fsa/OmniVoice#license)，仅限非商业用途；Qwen3-TTS 权重为 Apache-2.0。

完整模型列表、四类模型能力、内置音色、Omni 属性及高级参数见[模型能力参考](models.md)。
