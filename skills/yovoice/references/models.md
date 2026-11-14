# 模型能力与高级参数

以 yovoice 内置 audio.cpp v0.9.3 为准。App 和独立 CLI 共用模型与生成实现；所有模型均完整生成后播放，不提供流式。

## 能力覆盖

| 模型 | 已接入的生成能力 | 输入与限制 |
| --- | --- | --- |
| IndexTTS 2 / 2.5 | 音色克隆、演绎参考、八维情绪、文字情绪、自动情绪、随机情绪、语速、采样、种子、段间停顿、长文分段；2.5 支持发音标注 | 必须参考音频；2 支持中英，2.5 增加日语、西班牙语、阿拉伯语 |
| VoxCPM2 | 自动音色、声音设计、音色克隆、精细克隆、风格描述、CFG、推理步数、种子、生成长度、异常重试、长文分段及连续/独立策略 | 精细克隆需原文；语言自动识别，语速和方言通过描述表达 |
| OmniVoice | 自动音色、属性设计、参考克隆、参考原文、语言提示、语速、CFG、推理步数、种子、非语言标签、长文分段、目标时长、降噪、预处理与后处理 | 克隆必须提供参考原文；设计描述仅接受预定义属性；权重 CC-BY-NC |
| Qwen3-TTS Base 0.6B / 1.7B | 参考克隆、带原文克隆、无原文纯音色克隆、语言、主/子解码器采样、种子、长文分段 | 必须参考音频；有原文时必须与参考音频一致 |
| Qwen3-TTS 1.7B CustomVoice | 9 种内置音色、文字风格/情绪、语言、主/子解码器采样、种子、长文分段 | 不使用外部参考音频 |
| Qwen3-TTS 1.7B VoiceDesign | 自然语言声音设计、语言、主/子解码器采样、种子、长文分段 | 必须填写声音描述，不使用外部参考音频 |
| Breeze TTS 2 | 自然语言声音设计、参考克隆、克隆时演绎指导、CFG、主/细节解码器采样、种子、长文分段、单段生成上限、正文 [笑]/(laugh) 等声音事件 | 中英；克隆必须提供逐字原文；需要 v0.9.1 内核，建议 GPU；权重仅限非商业 |
| Ming 3.0 TTS | 自然语言声音设计、参考克隆、可选原文声学前缀、7 种语言、流匹配引导与温度、种子、长文分段、尾部静音裁剪 | 设计描述可选；克隆原文可选；需要 v0.9.3 内核 |
| Voxtral 4B TTS | 20 个内置音色、9 种语言、声学引导与推理步数、种子、长文分段 | 只能使用内置音色，不能克隆；CC BY-NC 4.0；需要 v0.9.3 内核 |
| Plapre 3 | 5 个丹麦语内置音色、参考克隆、可选原文、采样、种子、段间静音与长文分段 | 丹麦语；内置音色默认 tor；需要 v0.9.3 内核 |
| XTTS v2 | 17 种语言、参考克隆、采样、重复惩罚、种子、长文分段 | 必须提供 6–30 秒参考音频并明确语言；Coqui Public Model License；需要 v0.9.3 内核 |
| Gradium Phonon | 英文默认音色、流噪声温度、种子、按 Token 长文分段 | 仅英文和默认音色，不能克隆；需要 v0.9.3 内核 |
| Drama 3 / Drama3-small | 默认音色、参考克隆、说话人及事件标签、采样、种子、长文分段、CUDA 性能优先 | 克隆必须提供完整原文；Fish Audio Community License；需要 v0.9.3 内核 |
| Kokoro-82M 1.0 / 1.1-zh | 内置音色、多语言、长文分段 | 只用内置音色（`--speaker`），不能克隆；1.0 有 49 个音色，支持中文、英语、西班牙语、法语、印地语、意大利语、巴西葡萄牙语，不含日语；1.1-zh 为 100 个中文和 3 个英文音色（实验性），音色 ID 与 1.0 不通用；首次下载会一并下载约 10 MB 发音库 |

此处覆盖语音生成能力，并非 audio.cpp 的全部底层调优开关。图内存、运行时重量化、缓存槽位、调试用噪声文件等引擎参数继续使用默认值，不作为声音设置展示。训练、微调、ASR、对齐及批量训练数据处理不属于此 TTS 接入。

官方 Qwen3-TTS 还有 0.6B CustomVoice；当前固定模型仓库未发布对应独立 GGUF，暂不列为可下载模型。Safetensors 多文件包未接入当前单文件 GGUF 管理流程。

`yovoice models list --json` 里的 ACE-Step、YuE2、Stable Audio 3 是音乐模型，`generate` 用法见[音乐参考](music.md)；Stable Audio Small SFX 生成音效。`qwen3-asr-*`、`parakeet-tdt-*`、`confucius4-r2t2-q8`、`htdemucs-6stems-*`、`bs-roformer-q8`、`muscriptor-small-f32` 分别用于转写、分轨和转 MIDI，见[音频工具参考](tools.md)；SheetSage2 是翻唱用的扒谱模型，`lyric-align-q8` 是播放页逐字对齐歌词的可选模型，只在桌面端使用；`*-sf2` 是编曲音色库，见[编曲参考](score.md)。

## 下载与精度

`yovoice models list --json` 返回模型 ID、下载路径、大小、SHA-256，以及当前支持的高级参数定义。App 使用同一目录。

```sh
yovoice setup --backend metal
yovoice models download qwen3-tts-customvoice-q8 --source modelscope
```

Windows/Linux 后端选择见 [引擎与模型下载](setup.md)。精度影响文件大小和输出，Q8、BF16、F16、ORIG 是不同资产；不把 ORIG 视为必然更好的输出。

| ID | 模型 | 精度 | 大小 |
| --- | --- | --- | --- |
| `index-2.5-q8` | IndexTTS 2.5 | Q8 | 3.50 GB |
| `index-2.5-f16` | IndexTTS 2.5 | F16 | 4.55 GB |
| `index-2.5-orig` | IndexTTS 2.5 | ORIG | 7.89 GB |
| `index-2-q8` | IndexTTS 2.0 | Q8 | 3.63 GB |
| `index-2-f16` | IndexTTS 2.0 | F16 | 4.65 GB |
| `index-2-orig` | IndexTTS 2.0 | ORIG | 8.08 GB |
| `voxcpm2-q8` | VoxCPM2 | Q8 | 2.96 GB |
| `voxcpm2-bf16` | VoxCPM2 | BF16 | 4.77 GB |
| `voxcpm2-orig` | VoxCPM2 | ORIG | 4.96 GB |
| `omnivoice-q8` | OmniVoice | Q8 | 1.35 GB |
| `omnivoice-bf16` | OmniVoice | BF16 | 1.64 GB |
| `omnivoice-f16` | OmniVoice | F16 | 1.64 GB |
| `qwen3-tts-base-q8` | Qwen3-TTS 1.7B Base | Q8 | 2.70 GB |
| `qwen3-tts-base-bf16` | Qwen3-TTS 1.7B Base | BF16 | 4.20 GB |
| `qwen3-tts-base-orig` | Qwen3-TTS 1.7B Base | ORIG | 4.54 GB |
| `qwen3-tts-customvoice-q8` | Qwen3-TTS 1.7B CustomVoice | Q8 | 2.82 GB |
| `qwen3-tts-customvoice-bf16` | Qwen3-TTS 1.7B CustomVoice | BF16 | 4.18 GB |
| `qwen3-tts-base-0.6b-q8` | Qwen3-TTS 0.6B Base | Q8 | 1.99 GB |
| `qwen3-tts-base-0.6b-bf16` | Qwen3-TTS 0.6B Base | BF16 | 2.52 GB |
| `qwen3-tts-voicedesign-q8` | Qwen3-TTS 1.7B VoiceDesign | Q8 | 2.82 GB |
| `qwen3-tts-voicedesign-bf16` | Qwen3-TTS 1.7B VoiceDesign | BF16 | 4.18 GB |
| `breeze-tts-2-q4` | Breeze TTS 2 | Q4 | 3.79 GB |
| `breeze-tts-2-q8` | Breeze TTS 2 | Q8 | 5.08 GB |
| `breeze-tts-2-bf16` | Breeze TTS 2 | BF16 | 7.34 GB |
| `ming3-tts-0.5b-q8` | Ming 3.0 TTS 0.5B | Q8 | 1.74 GB |
| `ming3-tts-0.5b-bf16` | Ming 3.0 TTS 0.5B | BF16 | 3.00 GB |
| `voxtral-tts-4b-q8` / `-bf16` | Voxtral 4B TTS | Q8 / BF16 | 4.72 / 8.03 GB |
| `plapre-3-bf16` / `-f32` | Plapre 3 | BF16 / F32 | 1.15 / 2.28 GB |
| `xtts-v2-q8` / `-q4` / `-orig` | XTTS v2 多文件包 | Q8 / Q4_K_M / Original | 0.57 / 0.37 / 1.75 GB |
| `gradium-phonon-31m-en-q8` | Gradium Phonon 多文件包 | Q8 | 85.5 MB |
| `fish-drama3-small-iq3` | Drama3-small | IQ3_XXS | 10.46 GB |
| `fish-drama3-q2` / `-q4` | Drama 3 | Q2_K / Q4_K_S | 17.05 / 24.60 GB |
| `kokoro-82m-q8` / `-bf16` | Kokoro-82M 1.0 | Q8 / BF16 | 190 / 212 MB |
| `kokoro-1.1-zh-q8` | Kokoro-82M 1.1-zh | Q8 | 255 MB |
| `yue2-3b-q8` / `-bf16` / `-q4` | YuE2 3B（音乐） | Q8 / BF16 / Q4 | 4.53 / 7.53 / 2.93 GB |
| `ace-step-1.5-turbo-q8` / `-bf16` | ACE-Step 1.5 Turbo（音乐） | Q8 / BF16 | 6.19 / 10.09 GB |
| `ace-step-1.5-xl-turbo-q8` / `-bf16` | ACE-Step 1.5 XL Turbo（音乐） | Q8 / BF16 | 10.71 / 15.28 GB |
| `stable-audio-3-small-music-q8` / `-f16` | Stable Audio 3 Small Music | Q8 / F16 | 1.68 / 2.36 GB |
| `stable-audio-3-small-sfx-q8` / `-f16` | Stable Audio 3 Small SFX（音效） | Q8 / F16 | 1.68 / 2.36 GB |
| `stable-audio-3-medium-q8` / `-f16` | Stable Audio 3 Medium（音乐） | Q8 / F16 | 3.58 / 5.83 GB |

## 调用方式

Qwen 的语言可选 `auto|zh|en|ja|ko|de|fr|ru|pt|es|it`，默认自动。Ming 的语言可选 `auto|zh|en|ja|ko|de|fr|es`。

```sh
# 内置音色，可用文字控制演绎
yovoice generate --model qwen3-tts-customvoice-q8 --speaker Serena --voice-description "温柔轻声，语速舒缓" --language zh --text-file narration.txt --output custom.wav
# 自然语言设计，必须填写描述
yovoice generate --model qwen3-tts-voicedesign-q8 --voice-description "低沉、富有磁性的成年男性旁白" --text-file narration.txt --output designed.wav
# 小模型参考克隆；省略原文时仅提取音色
yovoice generate --model qwen3-tts-base-0.6b-q8 --reference reference.wav --reference-text "参考音频实际说出的内容" --text-file narration.txt --output cloned.wav
# Kokoro 内置音色，语言随音色选择，无需参考音频
yovoice generate --model kokoro-82m-q8 --speaker zf_xiaobei --text "你好，欢迎使用。" --output kokoro.wav
# Omni 属性设计、语速与解码参数
yovoice generate --model omnivoice-q8 --voice-description "female, young adult, moderate pitch" --language zh --speed 1.1 --guidance-scale 2 --inference-steps 32 --text "你好。[laughter] 很高兴见到你。" --output omni.wav
```

CustomVoice 的说话人为 `Vivian`（默认）、`Serena`、`Uncle_Fu`、`Dylan`、`Eric`、`Ryan`、`Aiden`、`Ono_Anna`、`Sohee`。前五种以中文为原生语言，Ryan/Aiden 为英语，Ono_Anna 为日语，Sohee 为韩语。

### IndexTTS 情绪和采样

`--emotion-reference FILE`、`--emotion-vector "0.4,0,0,0,0,0,0.1,0"`、`--emotion-text TEXT` / `--infer-emotion` 选择一种演绎方式；`--emotion-strength` 控制强度，`--random-emotion` 控制情绪采样。八维顺序为高兴、愤怒、悲伤、害怕、厌恶、低落、惊讶、平静。

`--emotion-mode speaker|reference|vector|text` 可显式指定；有情绪输入时自动选择相应方式。采样选项：`--do-sample`、`--temperature`、`--top-p`、`--top-k`、`--repetition-penalty`、`--max-tokens`、`--num-beams`、`--length-penalty`、`--interval-silence-ms`、`--seed`。布尔参数使用 `--do-sample=false` 关闭。

IndexTTS 2.5 正文支持 `<文字|发音>`，App 可选中文字调整发音。

### OmniVoice 属性和标签

设计属性用英文或中文逗号分隔，同一类别只选一个。留空为自动音色，克隆不叠加这些属性。

- 性别：`male`、`female`。
- 年龄：`child`、`teenager`、`young adult`、`middle-aged`、`elderly`。
- 音调：`very low pitch`、`low pitch`、`moderate pitch`、`high pitch`、`very high pitch`。
- 发声方式：`whisper`。
- 口音：`american accent`、`british accent`、`australian accent`、`chinese accent`、`canadian accent`、`indian accent`、`korean accent`、`portuguese accent`、`russian accent`、`japanese accent`。
- 方言：`河南话`、`陕西话`、`四川话`、`贵州话`、`云南话`、`桂林话`、`济南话`、`石家庄话`、`甘肃话`、`宁夏话`、`青岛话`、`东北话`。

非语言标签直接写进正文：`[laughter]`、`[sigh]`、`[confirmation-en]`、`[question-en]`、`[question-ah]`、`[question-oh]`、`[question-ei]`、`[question-yi]`、`[surprise-ah]`、`[surprise-oh]`、`[surprise-wa]`、`[surprise-yo]`、`[dissatisfaction-hnn]`。App 可从“非语言声音”插入正文末尾，再自行调整位置。

## 高级生成选项

App 的“高级设置”按模型显示下列选项；CLI 使用可重复的 `--option KEY=JSON`。字符串需要 JSON 双引号，命令示例外层单引号用于保护 shell。

```sh
yovoice generate --model qwen3-tts-customvoice-q8 --speaker Ryan --text-file narration.txt --option 'temperature=0.7' --option 'subtalker_do_sample=false' --option 'text_chunk_size=512' --option 'text_chunk_mode="tag_aware"' --output output.wav
```

参数按模型族独立保存，未设置时沿用引擎原生默认值。`text_chunk_size=0` 表示不覆盖模型分段策略。长文分段仍是离线生成，不是流式。

### index_tts2

| 参数 | 含义 | 默认值 | 可用范围 |
| --- | --- | --- | --- |
| `text_chunk_size` | 长文分段字数（0 为模型默认） | `0` | 0–12000 |
| `text_chunk_mode` | 分段方式 | `"default"` | default, tag_aware, japanese, endline |

### voxcpm2

| 参数 | 含义 | 默认值 | 可用范围 |
| --- | --- | --- | --- |
| `text_chunk_size` | 长文分段字数（0 为模型默认） | `2048` | 0–12000 |
| `text_chunk_mode` | 分段方式 | `"tag_aware"` | default, tag_aware, japanese, endline |
| `max_tokens` | 最大生成长度 | `4096` | 50–4096 |
| `voxcpm2.chunk_strategy` | 长文生成策略 | `"continuation"` | continuation, stateless |
| `min_tokens` | 最小生成长度 | `2` | 0–4096 |
| `retry_badcase` | 异常生成自动重试 | `true` | true / false |
| `retry_badcase_max_times` | 最多重试次数 | `3` | 1–10 |
| `retry_badcase_ratio_threshold` | 异常长度比例阈值 | `6` | 0.1–20 |

### omnivoice

| 参数 | 含义 | 默认值 | 可用范围 |
| --- | --- | --- | --- |
| `text_chunk_size` | 长文分段字数（0 为模型默认） | `0` | 0–12000 |
| `text_chunk_mode` | 分段方式 | `"tag_aware"` | default, tag_aware, japanese, endline |
| `num_inference_steps` | 推理步数 | `32` | 1–100 |
| `guidance_scale` | 引导强度 | `2` | 0.5–5 |
| `audio_chunk_duration` | 自动分段时长（秒） | `15` | 1–60 |
| `audio_chunk_threshold` | 自动分段阈值（秒） | `30` | 1–120 |
| `duration` | 目标时长（秒，0 为自动） | `0` | 0–300 |
| `denoise` | 参考音频降噪 | `true` | true / false |
| `preprocess_prompt` | 提示词预处理 | `true` | true / false |
| `postprocess_output` | 音频后处理 | `true` | true / false |
| `t_shift` | 扩散时间偏移 | `0.1` | 0.01–2 |
| `layer_penalty_factor` | 层惩罚系数 | `5` | 0–20 |
| `position_temperature` | 位置采样温度 | `5` | 0–20 |
| `class_temperature` | 类别采样温度 | `0` | 0–5 |

### qwen3_tts

| 参数 | 含义 | 默认值 | 可用范围 |
| --- | --- | --- | --- |
| `text_chunk_size` | 长文分段字数（0 为模型默认） | `8192` | 0–12000 |
| `text_chunk_mode` | 分段方式 | `"default"` | default, tag_aware, japanese, endline |
| `max_tokens` | 最大生成长度 | `8192` | 50–16384 |
| `do_sample` | 随机采样 | `true` | true / false |
| `temperature` | 温度 | `0.9` | 0.05–2 |
| `top_k` | Top K | `50` | 1–200 |
| `top_p` | Top P | `1` | 0.01–1 |
| `repetition_penalty` | 重复惩罚 | `1.05` | 0.1–20 |
| `subtalker_do_sample` | 子解码器随机采样 | `true` | true / false |
| `subtalker_temperature` | 子解码器温度 | `0.9` | 0.05–2 |
| `subtalker_top_k` | 子解码器 Top K | `50` | 1–200 |
| `subtalker_top_p` | 子解码器 Top P | `1` | 0.01–1 |

### breeze_tts

| 参数 | 含义 | 默认值 | 可用范围 |
| --- | --- | --- | --- |
| `text_chunk_size` | 长文分段字数 | `160` | 20–600 |
| `text_chunk_mode` | 分段方式 | `"default"` | default, tag_aware, japanese, endline |
| `max_tokens` | 单段最大生成帧数（12.5 帧/秒） | `900` | 50–1500 |
| `guidance_scale` | 引导强度（1 为关闭 CFG） | `1` | 1–5 |
| `temperature` | 温度 | `0.9` | 0.05–2 |
| `depth_temperature` | 细节解码温度 | `0.9` | 0.05–2 |
| `top_k` | Top K | `50` | 1–200 |
| `top_p` | Top P | `1` | 0.01–1 |

Breeze TTS 2 用 `--voice-mode design|clone` 选择方式（有参考音频时默认克隆），`--voice-description` 在设计时描述音色、克隆时作为演绎指导。拖音时先缩短 `text_chunk_size`，再降低 `temperature`；CPU 后端无法使用 bf16 参考路径，长文更容易拖音。

### ming3_tts

| 参数 | 含义 | 默认值 | 可用范围 |
| --- | --- | --- | --- |
| `text_chunk_size` | 长文分段码点数（0 为上游自动） | `0` | 0–12000 |
| `text_chunk_mode` | 分段方式 | `"tag_aware"` | default, tag_aware, japanese, endline |
| `guidance_scale` | 流匹配引导强度 | `2` | 0–10 |
| `temperature` | 流采样温度 | `0` | 0–2 |
| `trim_silence` | 裁剪每段尾部低能量音频并保留短尾音 | `true` | true / false |

Ming 3.0 TTS 用 `--voice-mode design|clone` 选择方式（有参考音频时默认克隆），设计描述可选；克隆原文可选，省略时仅参考说话人音色。上游默认按中日韩 50 码点、其他语言 300 码点分段，无参考音色时后续段锁定首段音色，不要无目的强制分段大小。

### voxtral_tts

`num_inference_steps` 1–100（7）、`guidance_scale` 0–10（1.2）、`max_tokens` 1–16384（2048）、`text_chunk_size` 1–12000（300）。`--speaker` 选择 20 个内置音色，默认 `casual_male`，不使用参考音频。

### plapre

`temperature` 0–2（0.8）、`top_k` -1–500（50）、`top_p` 0–1（0.95）、`silence_duration_sec` 0–10（0.1）、`text_chunk_size` 1–12000（300）。`--voice-mode design|clone` 切换内置音色和克隆；设计用 `--speaker tor|ida|liv|ask|kaj`，克隆原文可选。

### xtts_v2

`temperature` 0–2（0.75）、`top_k` 0–500（50）、`top_p` 0–1（0.85）、`repetition_penalty` 1–20（10）、`text_chunk_size` 1–12000（256）。必须提供 6–30 秒参考音频；`--language` 支持 17 种语言，默认及 auto 均按 `zh-cn`。

### gradium_phonon

`temperature` 0.01–2（0.3）、`text_chunk_tokens` 1–4096（50）。只支持英文默认音色，不接受参考音频。

### fish_drama3

`top_p` 0–1（0.9）、`temperature` 0–2（1）、`max_tokens` 1–16384（1024）、`text_chunk_size` 1–12000（128）。默认音色用 design；克隆用 `--voice-mode clone --reference FILE --reference-text TEXT`，原文必填。正文说话人标签为 `<|speaker:0|>` 至 `<|speaker:15|>`，事件标签包括 `[laughs]`、`[sighs]`。CUDA 性能优先自动注入 `fish_drama3.perf_mode=cuda_perf`，不默认开启 disk/CPU experts。

VoxCPM2 的 `stateless` 适合普通文本或参考克隆长文，跨段风格延续应保留默认 `continuation`。VoxCPM2 的 CFG 和步数继续用 `--guidance-scale`、`--inference-steps`，与 App 控件一致。

## 上游依据

- [audio.cpp IndexTTS 文档（v0.9.3）](https://github.com/0xShug0/audio.cpp/blob/v0.9.3/docs/models/index_tts.md)
- [audio.cpp VoxCPM2 文档（v0.9.3）](https://github.com/0xShug0/audio.cpp/blob/v0.9.3/docs/tts.md#voxcpm2)
- [audio.cpp OmniVoice 文档（v0.9.3）](https://github.com/0xShug0/audio.cpp/blob/v0.9.3/docs/models/omnivoice.md)
- [audio.cpp Qwen3 文档（v0.9.3）](https://github.com/0xShug0/audio.cpp/blob/v0.9.3/docs/models/qwen3.md)
- [audio.cpp BreezeTTS 2 文档（v0.9.3）](https://github.com/0xShug0/audio.cpp/blob/v0.9.3/docs/models/breeze_tts.md)
- [audio.cpp Ming 3.0 TTS 文档（v0.9.3）](https://github.com/0xShug0/audio.cpp/blob/v0.9.3/docs/models/ming3_tts.md)
- [audio.cpp Voxtral TTS 文档（v0.9.3）](https://github.com/0xShug0/audio.cpp/blob/v0.9.3/docs/models/voxtral_tts.md)
- [audio.cpp Plapre 3 文档（v0.9.3）](https://github.com/0xShug0/audio.cpp/blob/v0.9.3/docs/models/plapre.md)
- [audio.cpp XTTS v2 文档（v0.9.3）](https://github.com/0xShug0/audio.cpp/blob/v0.9.3/docs/community_models/xtts_v2.md)
- [audio.cpp Gradium Phonon 文档（v0.9.3）](https://github.com/0xShug0/audio.cpp/blob/v0.9.3/docs/models/gradium_phonon.md)
- [audio.cpp Drama 3 文档（v0.9.3）](https://github.com/0xShug0/audio.cpp/blob/v0.9.3/docs/models/fish_drama3.md)
- [Qwen 官方模型与说话人](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice)
