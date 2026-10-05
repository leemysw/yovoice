# 模型选择

[English](models.md) · 简体中文

根据是否已有参考录音，以及需要内置音色还是设计音色来选择模型。所有模型均完整生成后播放。

| 模型 | 主要用途 | 输入要求 |
| --- | --- | --- |
| IndexTTS 2.0 / 2.5 | 音色克隆、情绪控制 | 必须提供参考音频；2.0 支持中英，2.5 增加日语、西班牙语、阿拉伯语 |
| VoxCPM2 | 声音设计、音色克隆 | 设计描述可选；精细克隆使用参考音频及其原文 |
| OmniVoice | 属性设计、音色克隆 | 设计使用预定义属性；克隆需音频和匹配原文 |
| Qwen3-TTS Base · 0.6B / 1.7B | 音色克隆 | 必须提供参考音频，原文可选 |
| Qwen3-TTS CustomVoice · 1.7B | 内置音色与演绎控制 | 音色 ID，可选风格描述 |
| Qwen3-TTS VoiceDesign · 1.7B | 声音设计 | 必须填写声音描述 |
| Kokoro | 轻量内置音色 | 音色 ID，无需参考音频 |

通过 `yovoice models list --json` 查询模型 ID、精度、文件大小、音色和高级参数定义。App 的设置中也可查看模型。引擎和模型下载见 [CLI 指南](cli_zh.md)。

## 音色克隆

```sh
yovoice generate --model index-2.5-q8 --text-file narration.txt --reference voice.wav --output index.wav
yovoice generate --model voxcpm2-q8 --text-file narration.txt --reference voice.wav --reference-text "参考音频中实际说出的内容。" --output vox.wav
yovoice generate --model omnivoice-q8 --text-file narration.txt --reference voice.wav --reference-text "参考音频中实际说出的内容。" --output omni.wav
yovoice generate --model qwen3-tts-base-0.6b-q8 --text-file narration.txt --reference voice.wav --output qwen.wav
```

VoxCPM2 省略 `--reference-text` 时使用普通克隆。Qwen3-TTS Base 添加准确原文后可进行原文辅助克隆。OmniVoice 克隆始终需要匹配的原文。

参考录音应人声清晰、只有一位说话人且背景噪声较少，长度为 1–60 秒、大小不超过 20 MB。

## 声音设计与内置音色

```sh
yovoice generate --model voxcpm2-q8 --voice-description "温暖平静的成年旁白" --text-file narration.txt --output vox-design.wav
yovoice generate --model omnivoice-q8 --voice-description "女, 青年, 中音调" --text-file narration.txt --output omni-design.wav
yovoice generate --model qwen3-tts-voicedesign-q8 --voice-description "低沉、富有磁性的成年旁白" --text-file narration.txt --output qwen-design.wav
yovoice generate --model qwen3-tts-customvoice-q8 --speaker Serena --voice-description "温柔轻声，语速舒缓" --language zh --text-file narration.txt --output custom.wav
```

Qwen3-TTS CustomVoice 的音色为 `Vivian`、`Serena`、`Uncle_Fu`、`Dylan`、`Eric`、`Ryan`、`Aiden`、`Ono_Anna`、`Sohee`。

OmniVoice 设计使用逗号分隔的预定义属性，不接受自由描述。同一类别最多选一个：

- 性别：男、女。
- 年龄：儿童、少年、青年、中年、老年。
- 音调：极低音调、低音调、中音调、高音调、极高音调。
- 发声方式：耳语。

描述留空时自动选择音色。Kokoro 音色和模型差异见 [Kokoro 指南](kokoro_zh.md)。

## 演绎与高级参数

IndexTTS 可通过 `--emotion-text`、`--emotion-reference` 或 `--emotion-vector` 选择演绎方式。情绪向量的八维顺序为高兴、愤怒、悲伤、害怕、厌恶、低落、惊讶、平静。`--emotion-strength` 控制强度，`--speed` 控制语速。IndexTTS 2.5 还支持正文中的发音标注。

VoxCPM2 通过声音描述表达语速、情绪和方言，也可使用 `--guidance-scale`、`--inference-steps`、`--seed` 调整生成。精细克隆沿用参考音频的演绎，不叠加设计描述。

OmniVoice 支持 `--speed`、`--language`、`--guidance-scale`、`--inference-steps`，正文可插入 `[laughter]`、`[sigh]` 等声音标签。Qwen3-TTS 支持 `--language auto|zh|en|ja|ko|de|fr|ru|pt|es|it`。

App 在高级设置中展示可用参数。CLI 使用可重复的 `--option KEY=JSON`，具体参数及范围通过 `models list --json` 查询：

```sh
yovoice generate --model qwen3-tts-customvoice-q8 --speaker Serena --text-file narration.txt --option 'temperature=0.7' --option 'text_chunk_size=512' --output advanced.wav
```

## 使用协议

OmniVoice 权重使用 CC-BY-NC 协议，仅限非商业用途。IndexTTS 有独立的[模型协议](../web/public/model-license.txt)。商业使用前请确认所选模型发布方的使用条款。
