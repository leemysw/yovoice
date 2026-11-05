# 模型选择

[English](models.md) · 简体中文

根据是否已有参考录音，以及需要内置音色还是设计音色来选择模型。模型和当前引擎支持流式输出时，可在创作面板的「推理运行时」开启边生成边试听。生成结束后仍会保存完整音频。

| 模型 | 主要用途 | 输入要求 |
| --- | --- | --- |
| IndexTTS 2.0 / 2.5 | 音色克隆、情绪控制 | 必须提供参考音频；2.0 支持中英，2.5 增加日语、西班牙语、阿拉伯语 |
| VoxCPM2 | 声音设计、音色克隆 | 设计描述可选；精细克隆使用参考音频及其原文 |
| OmniVoice | 属性设计、音色克隆 | 设计使用预定义属性；克隆需音频和匹配原文 |
| Qwen3-TTS Base · 0.6B / 1.7B | 音色克隆 | 必须提供参考音频，原文可选 |
| Qwen3-TTS CustomVoice · 1.7B | 内置音色与演绎控制 | 音色 ID，可选风格描述 |
| Qwen3-TTS VoiceDesign · 1.7B | 声音设计 | 必须填写声音描述 |
| Breeze TTS 2 | 中英声音设计、音色克隆与演绎指导 | 设计描述可选；克隆需音频和完整原文；建议使用显卡 |
| Ming 3.0 TTS | 7 种语言的声音设计与音色克隆 | 设计描述可选；克隆需音频，原文可选；需要 v0.9.3 内核 |
| Voxtral 4B TTS | 9 种语言的 20 个内置音色 | 音色 ID，不支持参考音频或克隆；CC BY-NC 4.0；需要 v0.9.3 内核 |
| Plapre 3 | 丹麦语内置音色与音色克隆 | 音色 ID，或参考音频与可选原文；需要 v0.9.3 内核 |
| XTTS v2 | 17 种语言的音色克隆 | 6–30 秒参考音频与明确语言；Coqui Public Model License；需要 v0.9.3 内核 |
| Gradium Phonon | 轻量英文语音 | 仅默认音色，不支持参考音频或克隆；需要 v0.9.3 内核 |
| Drama 3 / Drama3-small | 说话人与事件标签、默认音色与克隆 | 克隆需参考音频及完整原文；Fish Audio Community License；需要 v0.9.3 内核 |
| Kokoro | 轻量内置音色 | 音色 ID，无需参考音频 |

通过 `yovoice models list --json` 查询模型 ID、精度、文件大小、音色和高级参数定义。App 的设置中也可查看模型。引擎和模型下载见 [CLI 指南](cli_zh.md)。

## 导入已有本地模型

在设置的“语音模型”“音乐模型”或“编曲音色库”中，先选对应的型号、版本和精度，再点“导入本地模型”。选择 audio.cpp GGUF 文件（音色库为清单中支持的 SF2）；多文件包请选择主 GGUF，并保留配套文件的原始目录结构。模型原地使用，不复制，也不改变模型下载目录；移除时只解除登记，保留源文件。使用外置硬盘上的模型时，请保持硬盘连接。

单文件导入检查 GGUF 格式和模型家族，并记录文件的 SHA-256；支持本机转换的 GGUF，但仍须选对版本和精度，家族匹配不代表任意自定义转换都能运行。多文件包及 SF2 须通过清单校验。PyTorch（`.pth`、`.pt`、`.safetensors`）和 MLX 原始权重不能直接交给 audio.cpp，需先使用上游对应的转换器制作 GGUF。导入不会安装、运行 Python，也不会自动转换权重。导入模型与下载模型使用相同的音色和高级生成参数。

## 模型文件与硬件

| 模型 | 参数量 | 模型文件大小（按精度） | 核心能力 |
| --- | --- | --- | --- |
| IndexTTS 2.0 | — | Q8 · 3.63 GB<br>F16 · 4.65 GB<br>ORIG · 8.08 GB | 中英音色克隆、情绪控制、参考演绎 |
| IndexTTS 2.5 | — | Q8 · 3.50 GB<br>F16 · 4.55 GB<br>ORIG · 7.89 GB | 多语言音色克隆、情绪控制、发音调整 |
| VoxCPM2 | 2B | Q8 · 2.96 GB<br>BF16 · 4.77 GB<br>ORIG · 4.96 GB | 文字设计音色、音色克隆、参考原文辅助的精细克隆 |
| OmniVoice | 0.6B | Q8 · 1.35 GB<br>BF16 · 1.64 GB<br>F16 · 1.64 GB | 属性设计音色、音色克隆、非语言声音标签 |
| Qwen3-TTS Base | 0.6B | Q8 · 1.99 GB<br>BF16 · 2.52 GB | 参考音色克隆、可选原文辅助、多语言生成 |
| Qwen3-TTS Base | 1.7B | Q8 · 2.70 GB<br>BF16 · 4.20 GB<br>ORIG · 4.54 GB | 参考音色克隆、可选原文辅助、多语言生成 |
| Qwen3-TTS CustomVoice | 1.7B | Q8 · 2.82 GB<br>BF16 · 4.18 GB | 9 种内置音色、文字控制风格与情绪 |
| Qwen3-TTS VoiceDesign | 1.7B | Q8 · 2.82 GB<br>BF16 · 4.18 GB | 自然语言描述设计音色，无需参考音频 |
| Breeze TTS 2 | 约 3B | Q4 · 3.79 GB<br>Q8 · 5.08 GB<br>BF16 · 7.34 GB | 中英自然语言设计音色、音色克隆与演绎指导；建议使用显卡，需要 v0.9.1 内核 |
| Ming 3.0 TTS | 0.5B | Q8 · 1.74 GB<br>BF16 · 3.00 GB | 中英日韩德法西声音设计与音色克隆、44.1 kHz 输出；需要 v0.9.3 内核 |
| Kokoro-82M 1.0 Official | 82M | Q8 · 189.55 MB<br>BF16 · 211.95 MB | 49 种内置音色、多语言生成，不含日语 |
| Kokoro-82M 1.1-zh | 82M | Q8 · 255.32 MB | 100 种中文音色及 3 种英文音色；实验性 |
| ACE-Step 1.5 Turbo | — | Q8 · 6.19 GB<br>BF16 · 10.09 GB | 根据风格描述和歌词生成歌曲或纯音乐，支持 50 多种演唱语言；需要 v0.9.1 内核 |
| ACE-Step 1.5 XL Turbo | — | Q8 · 10.71 GB<br>BF16 · 15.28 GB | 更大的 ACE-Step 模型，歌曲与纯音乐质量更高；需要 v0.9.1 内核 |
| Stable Audio 3 Small Music | — | Q8 · 1.68 GB<br>F16 · 2.36 GB | 根据英文描述生成纯音乐，最长 2 分钟；可改编或局部重绘已生成的版本；需要 v0.9.1 内核 |
| Stable Audio 3 Small SFX | — | Q8 · 1.68 GB<br>F16 · 2.36 GB | 根据英文描述生成音效，最长 2 分钟；可改编或局部重绘已生成的版本；需要 v0.9.1 内核 |
| Stable Audio 3 Medium | — | Q8 · 3.58 GB<br>F16 · 5.83 GB | 更大的 Stable Audio 模型，纯音乐质量更高、可生成约 6 分钟以内的长曲；需要 v0.9.1 内核 |
| YuE2 3B | 3B | Q4 · 2.93 GB<br>Q8 · 4.53 GB<br>BF16 · 7.53 GB | 根据歌词和风格生成整首带人声歌曲，长度由歌词决定，也可按旋律谱生成纯音乐；需要 v0.9.1 内核 |
| SheetSage2 | — | F32 · 2.71 GB | 把歌曲的旋律与和弦扒成谱，配合 YuE2 做翻唱；需要 v0.9.1 内核 |
| 歌词对齐（可选） | 0.6B | Q8 · 1.30 GB | BS-RoFormer 分离人声 + Qwen3 Forced Aligner：把歌词逐字对齐到生成的歌曲上，用于播放页逐字歌词和导出逐字 LRC；需要 v0.9.1 内核 |

| 创作场景 | 推荐配置 | 适用模型推荐 |
| --- | --- | --- |
| 🟢 **轻量极速朗读与旁白** | 任何 CPU / 4GB+ 内存 | **Kokoro-82M** (Q8 仅 189 MB，毫秒级合成，纯 CPU 也能飞快运行) |
| 🟡 **高音质克隆与声音设计** | 4GB ~ 6GB 显存 / Apple Silicon 8GB+ | **VoxCPM2** (2B, 48kHz)、**IndexTTS 2.0/2.5**、**Qwen3-TTS** |
| 🔴 **整首歌生成与伴奏演奏** | 12GB+ 显存 / Apple Silicon 16GB+ | **ACE-Step 1.5 Turbo** (Q8 6GB / BF16 10GB)、**ACE-Step 1.5 XL Turbo**、**YuE2 3B** |

## 音色克隆

```sh
yovoice generate --model index-2.5-q8 --text-file narration.txt --reference voice.wav --output index.wav
yovoice generate --model voxcpm2-q8 --text-file narration.txt --reference voice.wav --reference-text "参考音频中实际说出的内容。" --output vox.wav
yovoice generate --model omnivoice-q8 --text-file narration.txt --reference voice.wav --reference-text "参考音频中实际说出的内容。" --output omni.wav
yovoice generate --model qwen3-tts-base-0.6b-q8 --text-file narration.txt --reference voice.wav --output qwen.wav
yovoice generate --model breeze-tts-2-q8 --text-file narration.txt --reference voice.wav --reference-text "参考音频中实际说出的内容。" --voice-description "语速稍快，语气轻松" --output breeze.wav
yovoice generate --model ming3-tts-0.5b-q8 --text-file narration.txt --reference voice.wav --reference-text "参考音频中实际说出的内容。" --language zh --output ming.wav
```

VoxCPM2 省略 `--reference-text` 时使用普通克隆。Qwen3-TTS Base 添加准确原文后可进行原文辅助克隆。OmniVoice 与 Breeze TTS 2 克隆始终需要匹配的原文；Breeze 的 `--voice-description` 在克隆时作为演绎指导，保留音色并调整语速、情绪和语气。Ming 3.0 TTS 的原文可选：填写后同时使用声学前缀，省略时仅参考说话人音色。

参考录音应人声清晰、只有一位说话人且背景噪声较少，长度为 1–60 秒、大小不超过 20 MB。

## 声音设计与内置音色

```sh
yovoice generate --model voxcpm2-q8 --voice-description "温暖平静的成年旁白" --text-file narration.txt --output vox-design.wav
yovoice generate --model omnivoice-q8 --voice-description "女, 青年, 中音调" --text-file narration.txt --output omni-design.wav
yovoice generate --model breeze-tts-2-q8 --voice-description "温暖的女声，语速平稳，吐字清晰" --text-file narration.txt --output breeze-design.wav
yovoice generate --model ming3-tts-0.5b-q8 --voice-description "温暖平静的成年旁白" --language zh --text-file narration.txt --output ming-design.wav
yovoice generate --model qwen3-tts-voicedesign-q8 --voice-description "低沉、富有磁性的成年旁白" --text-file narration.txt --output qwen-design.wav
yovoice generate --model qwen3-tts-customvoice-q8 --speaker Serena --voice-description "温柔轻声，语速舒缓" --language zh --text-file narration.txt --output custom.wav
```

Qwen3-TTS CustomVoice 的音色为 `Vivian`、`Serena`、`Uncle_Fu`、`Dylan`、`Eric`、`Ryan`、`Aiden`、`Ono_Anna`、`Sohee`。

OmniVoice 设计使用逗号分隔的预定义属性，不接受自由描述。同一类别最多选一个：

- 性别：男、女。
- 年龄：儿童、少年、青年、中年、老年。
- 音调：极低音调、低音调、中音调、高音调、极高音调。
- 发声方式：耳语。

描述留空时自动选择音色。Kokoro 音色和模型差异见下方 [Kokoro](#kokoro) 章节。

## 演绎与高级参数

IndexTTS 可通过 `--emotion-text`、`--emotion-reference` 或 `--emotion-vector` 选择演绎方式。情绪向量的八维顺序为高兴、愤怒、悲伤、害怕、厌恶、低落、惊讶、平静。`--emotion-strength` 控制强度，`--speed` 控制语速。IndexTTS 2.5 还支持正文中的发音标注。

VoxCPM2 通过声音描述表达语速、情绪和方言，也可使用 `--guidance-scale`、`--inference-steps`、`--seed` 调整生成。精细克隆沿用参考音频的演绎，不叠加设计描述。

VoxCPM2 以每秒 6.25 帧自回归生成，整段过长时音色会发散甚至爆音，长段内音高和音量也会逐渐下沉。YoVoice 默认每段 200 字、上限 400 字；默认的续写策略会把上一段作为下一段的提示，保持前后衔接。克隆时希望每段都直接对齐参考音频，可把“长文生成策略”改为“独立生成”（`stateless`）。

OmniVoice 支持 `--speed`、`--language`、`--guidance-scale`、`--inference-steps`，正文可插入 `[laughter]`、`[sigh]` 等声音标签。Qwen3-TTS 支持 `--language auto|zh|en|ja|ko|de|fr|ru|pt|es|it`。

Ming 3.0 TTS 支持 `--language auto|zh|en|ja|ko|de|fr|es`，高级设置可调整 `guidance_scale`、`temperature`、`trim_silence` 与长文分段。长文默认按中日韩 50 码点、其他语言 300 码点分段；无参考音色时后续段会锁定首段音色，YoVoice 不强制覆盖分段大小。

### Breeze TTS 2 与拖音

Breeze TTS 2 自然度高，但自回归生成在以下情况下容易拖音、重复或在句尾拖出长段静音，YoVoice 已按此调整默认值：

- **段落过长。** 模型以每秒 12.5 帧生成，官方上下文为 2048 帧；audio.cpp 默认每段 600 字、单段上限 1500 帧（120 秒），中文长段会超出训练长度。YoVoice 默认每段 160 字、单段上限 900 帧（约 72 秒），可在高级设置的 `text_chunk_size`、`max_tokens` 调整。
- **非 bf16 推理。** 官方实现全程以 bf16 运行，fp32 激活容易发音错误和重复。YoVoice 在 CUDA、Vulkan 和 Metal 上都开启 bf16 参考路径（Metal 约慢 20%）；CPU 后端无法开启，长文更容易拖音，建议使用显卡。
- **参考音频与原文。** 克隆参考宜为 5–15 秒、无背景噪声、不循环的干净人声，原文须逐字一致（重复的话也要写上）。
- **调教顺序。** 仍有拖音时，先缩短分段（如 80–120 字），再把 `temperature` 降到 0.6–0.8；需要更贴合描述时把 `guidance_scale` 调到 3–4（耗时约翻倍）。语速、情绪用描述表达，例如“语速稍快，语气轻松”，与正文使用同一种语言。

长文不带参考音频生成时，v0.9.1 内核会为每段单独挑选音色，前后音色可能不一致；需要稳定音色时，先用短句设计满意的声音，保存为音色后改用克隆。

App 在高级设置中展示可用参数。CLI 使用可重复的 `--option KEY=JSON`，具体参数及范围通过 `models list --json` 查询：

```sh
yovoice generate --model qwen3-tts-customvoice-q8 --speaker Serena --text-file narration.txt --option 'temperature=0.7' --option 'text_chunk_size=512' --output advanced.wav
```

## 其他 TTS 家族

### Voxtral 4B TTS

Q8（4.72 GB，默认）和 BF16（8.03 GB）提供覆盖 9 种语言的 20 个内置音色。用 `--speaker` 选择，默认 `casual_male`；不支持参考音频克隆。高级参数为 `num_inference_steps`、`guidance_scale`、`max_tokens`、`text_chunk_size`。模型权重与预设音色采用 CC BY-NC 4.0。

```sh
yovoice generate --model voxtral-tts-4b-q8 --speaker fr_female --text "Bonjour." --output voxtral.wav
```

### Plapre 3

Plapre 生成 24 kHz 丹麦语语音，提供 BF16（1.15 GB，默认）与 F32（2.28 GB）。可用 `--speaker tor|ida|liv|ask|kaj`，也可用参考音频和可选的准确原文克隆。高级参数覆盖采样、段间静音和长文分段。

```sh
yovoice generate --model plapre-3-bf16 --speaker tor --text "Hej." --output plapre.wav
yovoice generate --model plapre-3-bf16 --voice-mode clone --reference voice.wav --reference-text "Ordene i referenceoptagelsen." --text "I morgen kommer jeg igen." --output plapre-clone.wav
```

### XTTS v2

XTTS 支持 17 种语言，必须提供 6–30 秒参考音频。Q8（0.57 GB，默认）、Q4_K_M（0.37 GB）和原始包（1.75 GB）均包含 GPT、声码器和归一化数据。用 `--language en|es|fr|de|it|pt|pl|tr|ru|nl|cs|ar|zh-cn|hu|ko|ja|hi` 指定语言，默认 `zh-cn`。高级参数包括采样、重复惩罚和分段。权重采用 Coqui Public Model License。

```sh
yovoice generate --model xtts-v2-q8 --reference voice.wav --language en --text "Hello from XTTS." --output xtts.wav
```

### Gradium Phonon

英文 Q8 包（85.5 MB）包含模型和默认音色，不支持克隆。高级设置仅提供 `temperature`、`text_chunk_tokens` 和 `seed`。

```sh
yovoice generate --model gradium-phonon-31m-en-q8 --language en --text "Hello from Phonon." --output phonon.wav
```

### Fish Audio Drama 3

Drama3-small IQ3_XXS（10.46 GB，默认）、Drama 3 Q2_K（17.05 GB）和 Q4_K_S（24.60 GB）属于同一家族。默认音色无需参考；克隆必须提供音频及完整原文。正文支持 `<|speaker:0|>` 至 `<|speaker:15|>`，以及 `[laughs]`、`[sighs]` 等事件标签。高级参数为 `top_p`、`temperature`、`max_tokens`、`text_chunk_size`。CUDA“性能优先”会启用 `fish_drama3.perf_mode=cuda_perf`；磁盘专家与 CPU 专家卸载仍需显式开启。权重采用 Fish Audio Community License。

```sh
yovoice generate --model fish-drama3-small-iq3 --text "<|speaker:0|>Hello. [laughs]" --output drama.wav
yovoice generate --model fish-drama3-small-iq3 --voice-mode clone --reference voice.wav --reference-text "参考音频的逐字原文。" --text "<|speaker:0|>克隆的一段台词。" --output drama-clone.wav
```

## Kokoro

Kokoro 使用内置音色生成语音，不需要参考录音。

### 选择模型

| 模型 ID | 大小 | 音色与语言 | 安装方式 |
| --- | --- | --- | --- |
| `kokoro-82m-q8` | 约 190 MB | 49 个音色，支持日语以外的多种语言 | 下载 |
| `kokoro-82m-bf16` | 约 212 MB | 音色与 Q8 相同 | 下载 |
| `kokoro-1.1-zh-q8` | 约 255 MB | 100 个中文和 3 个英文音色，实验性支持 | 下载 |

官方模型支持中文、英语（美式与英式）、西班牙语、法语、印地语、意大利语和巴西葡萄牙语。1.1-zh 的音色 ID 与 1.0 不通用。

第一次下载 Kokoro 模型时会一并下载发音库（eSpeak NG 与 MeCab，约 10 MB），下载源为 Hugging Face 时取自 PyPI，ModelScope 或镜像源时取自阿里云 PyPI 镜像；所有 Kokoro 模型共用。

### 生成语音

```sh
yovoice models download kokoro-82m-q8
yovoice generate --model kokoro-82m-q8 --speaker zf_xiaobei --text "你好，欢迎使用。" --output hello.wav
```

通过 `yovoice models list --json` 查看可用音色 ID。语言随音色选择；官方模型的中文音色可用 `zf_xiaobei`，1.1-zh 可用 `zf_001`。

默认按 64 个字符分段，需要时可通过 `--option 'text_chunk_size=120'` 调整；单段仍受引擎音素数量上限限制。

Kokoro 不支持音色克隆或文字情绪控制。请保留 CLI 安装包中的 `tools/` 目录。安装引擎和模型后，生成过程可离线运行。完整多语言模型首次加载可能较慢。

## 音乐生成

桌面端的“音乐生成”作品可用 ACE-Step 1.5 Turbo 或 XL Turbo 生成歌曲与纯音乐，用 YuE2 3B 生成歌曲和按谱演奏的纯音乐，或用 Stable Audio 3 生成纯音乐；独立的“音效”标签用 Stable Audio 3 Small SFX 或 Medium 根据英文描述生成短音效，默认 5 秒，均需要 v0.9.1 及以上的推理内核。

- **风格**：一句描述加若干标签，例如 `city pop, warm synths, chill, female vocals`，最多 512 字。
- **歌词**：用 `[verse]`、`[chorus]`、`[bridge]` 等标记段落，最多 4000 字；打开“纯音乐”后只生成伴奏，歌词仍会保留。
- **时长与语言**：时长可选自动或 10–300 秒；演唱语言需与歌词一致。
- **编曲细节**：速度（30–300 BPM）、调性、拍号默认由模型规划，也可手动指定。

Stable Audio 3（Small Music、Small SFX、Medium）只根据英文描述生成纯音乐或音效，没有歌词和演唱语言。Small 最长 2 分钟，Medium 约 6 分钟（默认 30 秒）。在“生成方式”里还可以以本作品已生成的某个版本为起点：

- **改编**：用新的描述重写整段；“改动幅度”（0–1）越小越接近原版本。
- **局部重绘**：只重新生成选定的时间区间，其余部分保持原样。

Stable Audio 3 权重采用 Stability AI 社区许可：年收入低于 100 万美元可免费使用。

YuE2 生成带人声的歌曲时必须填写歌词，歌曲长度由歌词决定。它也可以按一份可编辑的旋律谱生成：

- **先写旋律谱**：YuE2 先按歌词写出人声旋律与和弦（ABC 谱），暂不演唱。可以在轨道视图或 ABC 谱面里查看和修改，调整速度、只保留旋律、导入 `.abc` 文件，或让创作助手改谱（需要接入 AI 服务）。之后按谱生成：带和弦时保留你定的和声，只有旋律时由 YuE2 自由编配伴奏。
- **从歌曲提取（翻唱）**：安装 SheetSage2 后选择一首 10 分钟以内的歌曲，扒出旋律、去掉原曲和弦，YuE2 按你写的风格和歌词重新演唱；不保留原唱的音色和唱法。
- **纯音乐**：YuE2 先写谱，再把人声旋律交给乐器演奏，和弦、速度和调不变。歌词可以不填，写 `[Verse]`、`[Chorus]` 等段落标记可以安排结构；已有的谱也按同样方式转换，旋律谱菜单里可以直接转好。
- **生成方式**：“按旋律谱”按谱生成（没有谱时先写谱）；“自由发挥”不经过谱直接生成，结果没有可编辑的谱。高级设置里可以调推理步数以及写谱和演唱的采样参数。
- 每个版本都保存当时用的谱，复用版本时一并恢复。

播放页的歌词时间默认按混音里的人声自动定位，可逐行校准。下载可选的歌词对齐模型后，“智能对齐”会先分离人声，去掉间奏和长停顿，再把歌词逐字对齐到演唱上（最长 20 分钟；对齐模型一次处理约 100 秒人声，更长的歌按句分组、在人声停顿处切段；同一版本重新对齐时复用已分离的人声）；结果随版本保存，和手动校准以最近一次为准。对齐后仍有偏差的字，可在“歌词工具 › 调整歌词时间”里修正：播放时点一句即锚定到当前播放位置，也可整句提前或推后（可选后面跟着移或只改这一句），单字可拖动字块或边听边跟唱打点。以上入口都在播放页顶栏的“歌词工具”菜单里。

续写、局部重绘和分轨提取暂未开放。

## 编曲音色库

“编曲”作品与 `yovoice score render` 使用 MuseScore General 音色库（`musescore-general-sf2`，SF2 · 约 216 MB），包含 128 种 General MIDI 乐器和鼓组；另可选 GeneralUser GS（`generaluser-gs-sf2`，约 32 MB）和 SGM-V2.01（`sgm-v2-sf2`，约 247 MB）。不需要推理内核。用法见[编曲](score_zh.md)。

## 使用协议

OmniVoice 权重使用 CC-BY-NC 协议，YuE2 权重使用 CC BY-NC 4.0 协议，均仅限非商业用途。Breeze TTS 2 权重使用 [BreezeBlue 研究与非商业许可](https://huggingface.co/BreezeBlue/Breeze-TTS-2)，生成结果同样不可商用。IndexTTS 有独立的[模型协议](../web/public/model-license.txt)。商业使用前请确认所选模型发布方的使用条款。

## 推理运行时

创作面板会将运行时设置随作品保存。CPU 线程数为 0 时沿用应用默认值；GPU 设备编号从 0 开始。模型默认空闲五分钟后卸载，设为 0 可保持加载。没有正在进行的生成时，可用「卸载模型并清空缓存」释放当前会话。更改会话设置后，下次生成会重新加载会话。

面板根据已安装引擎的模型清单显示支持的流式模式和模型专属的缓存、精度与执行设置。IndexTTS 在每段生成完成后开始试听；其他模型可按各自实现返回更小的片段。生成结束后仍会保存完整音频；停止试听不会取消生成。VoxCPM2 流式模式会关闭已经输出片段的质量重试。引擎声明支持时，VoxCPM2、Breeze TTS 2、Qwen3-TTS 和 Ming 3.0 还可调整片段节奏和帧数。

IndexTTS 每段 Token 上限和 IndexTTS 2.5 的文本规范化开关需要引擎明确声明支持。规范化开关控制 audio.cpp 自带的文本处理。官方 Python 实现可选的 NeMo 规则、PyTorch 开关和 DeepSpeed 配置不属于 audio.cpp 的会话参数。
