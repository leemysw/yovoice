# 模型能力与高级参数

以 yovoice 内置 audio.cpp v0.7.4 为准。App 和独立 CLI 共用模型与生成实现；所有模型均完整生成后播放，不提供流式。

## 能力覆盖

| 模型 | 已接入的生成能力 | 输入与限制 |
| --- | --- | --- |
| IndexTTS 2 / 2.5 | 音色克隆、演绎参考、八维情绪、文字情绪、自动情绪、随机情绪、语速、采样、种子、段间停顿、长文分段；2.5 支持发音标注 | 必须参考音频；2 支持中英，2.5 增加日语、西班牙语、阿拉伯语 |
| VoxCPM2 | 自动音色、声音设计、音色克隆、精细克隆、风格描述、CFG、推理步数、种子、生成长度、异常重试、长文分段及连续/独立策略 | 精细克隆需原文；语言自动识别，语速和方言通过描述表达 |
| OmniVoice | 自动音色、属性设计、参考克隆、参考原文、语言提示、语速、CFG、推理步数、种子、非语言标签、长文分段、目标时长、降噪、预处理与后处理 | 克隆必须提供参考原文；设计描述仅接受预定义属性；权重 CC-BY-NC |
| Qwen3-TTS Base 0.6B / 1.7B | 参考克隆、带原文克隆、无原文纯音色克隆、语言、主/子解码器采样、种子、长文分段 | 必须参考音频；有原文时必须与参考音频一致 |
| Qwen3-TTS 1.7B CustomVoice | 9 种内置音色、文字风格/情绪、语言、主/子解码器采样、种子、长文分段 | 不使用外部参考音频 |
| Qwen3-TTS 1.7B VoiceDesign | 自然语言声音设计、语言、主/子解码器采样、种子、长文分段 | 必须填写声音描述，不使用外部参考音频 |

此处覆盖语音生成能力，并非 audio.cpp 的全部底层调优开关。图内存、运行时重量化、缓存槽位、调试用噪声文件等引擎参数继续使用默认值，不作为声音设置展示。训练、微调、ASR、对齐及批量训练数据处理不属于此 TTS 接入。

官方 Qwen3-TTS 还有 0.6B CustomVoice；当前固定模型仓库未发布对应独立 GGUF，暂不列为可下载模型。Safetensors 多文件包未接入当前单文件 GGUF 管理流程。

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

## 调用方式

Qwen 的语言可选 `auto|zh|en|ja|ko|de|fr|ru|pt|es|it`，默认自动。

```sh
# 内置音色，可用文字控制演绎
yovoice generate --model qwen3-tts-customvoice-q8 --speaker Serena --voice-description "温柔轻声，语速舒缓" --language zh --text-file narration.txt --output custom.wav
# 自然语言设计，必须填写描述
yovoice generate --model qwen3-tts-voicedesign-q8 --voice-description "低沉、富有磁性的成年男性旁白" --text-file narration.txt --output designed.wav
# 小模型参考克隆；省略原文时仅提取音色
yovoice generate --model qwen3-tts-base-0.6b-q8 --reference reference.wav --reference-text "参考音频实际说出的内容" --text-file narration.txt --output cloned.wav
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

VoxCPM2 的 `stateless` 适合普通文本或参考克隆长文，跨段风格延续应保留默认 `continuation`。VoxCPM2 的 CFG 和步数继续用 `--guidance-scale`、`--inference-steps`，与 App 控件一致。

## 上游依据

- [audio.cpp IndexTTS 文档（v0.7.4）](https://github.com/0xShug0/audio.cpp/blob/v0.7.4/docs/models/index_tts.md)
- [audio.cpp VoxCPM2 文档（v0.7.4）](https://github.com/0xShug0/audio.cpp/blob/v0.7.4/docs/tts.md#voxcpm2)
- [audio.cpp OmniVoice 文档（v0.7.4）](https://github.com/0xShug0/audio.cpp/blob/v0.7.4/docs/models/omnivoice.md)
- [audio.cpp Qwen3 文档（v0.7.4）](https://github.com/0xShug0/audio.cpp/blob/v0.7.4/docs/models/qwen3.md)
- [Qwen 官方模型与说话人](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice)
