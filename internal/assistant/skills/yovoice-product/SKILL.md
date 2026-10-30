---
name: yovoice-product
description: yovoice product knowledge — which model fits which job, model parameters and hardware, where every page and setting lives, and what each error code means and how to fix it. Use when the user asks which model or voice to use, why something failed, where a feature is, or how a setting works.
---

# yovoice product guide

yovoice runs every model locally through its inference engine. Models and the engine are downloaded in Settings; generation happens on this machine and works offline afterwards.

## Pages (open_page keys)

| Key | Page | What it is for |
| --- | --- | --- |
| text | 语音生成 Voice | One script read by one voice. Model, voice and advanced options sit in the right inspector. |
| story | 故事配音 Story | Multi-speaker dubbing: speakers, lines (cues) and a timeline. Each line can be regenerated alone. Novels and subtitle files can be imported. |
| music | 音乐 Music | Songs or instrumentals from a style prompt and lyrics (ACE-Step, YuE2), or instrumental music from an English description (Stable Audio 3). YuE2 can write an editable melody score first or extract one from a song (cover). |
| score | 编曲 Arrangement | Multi-track score rendered through a SoundFont. |
| sfx | 音效 Sound effects | Short sound effects from an English description (Stable Audio 3 Small SFX or Medium), default 5 s; rework or inpaint an existing take. |
| characters | 声音库 Voice library | Saved characters: designed or cloned voices with a preview, reusable across works. |
| voices | 参考音色 References | Uploaded reference recordings (≤ 20 MB, one clean speaker). Recordings longer than 60 s (up to 10 min) are trimmed automatically to the clearest 5–15 s; the crop dialog's Auto pick does the same for an existing reference. |
| history | 历史 History | Every generated take; play, reuse settings, save as a voice. |
| settings | 设置 Settings | Tabs: 常规 General (language, proxy, download source, storage location), 语音模型 Voice models and 音乐模型 Music models (ACE-Step, YuE2, Stable Audio 3, SheetSage2, optional Lyric Aligner; download/remove), 推理引擎 Engine (install, compute device), 编曲音色库 SoundFonts, AI 服务 AI provider (also the model Ocho uses), 资源 Assets (files and cleanup), 日志 Logs (filter, export diagnostics), 本机接口 Local API (HTTP/MCP for other apps). |

The assistant opens with ⌘J / Ctrl+J, the launcher in the corner, or the title bar button.

## Choosing a voice model

| Model | Best for | Needs |
| --- | --- | --- |
| IndexTTS 2.0 / 2.5 | Cloning with emotion control (emotion text, emotion reference or 8-value vector: happy, angry, sad, afraid, disgusted, low, surprised, calm). 2.5 adds Japanese, Spanish, Arabic and pronunciation marks. | Reference audio |
| VoxCPM2 (2B, 48 kHz) | Highest fidelity; voice design from a description or cloning; 30 languages. Description also steers speed, emotion, dialect. | Optional description; transcript only for transcript-assisted cloning |
| OmniVoice (0.6B) | Light design from fixed attributes (gender, age, pitch, whisper) or cloning; sound tags like [laughter] [sigh]. | Attributes, or audio + matching transcript |
| Qwen3-TTS Base 0.6B / 1.7B | Plain cloning, 10 languages | Reference audio; transcript optional |
| Qwen3-TTS CustomVoice | 9 built-in voices (Vivian, Serena, Uncle_Fu, Dylan, Eric, Ryan, Aiden, Ono_Anna, Sohee) with style instructions | Speaker |
| Qwen3-TTS VoiceDesign | Voice from a natural-language description | Description |
| Breeze TTS 2 (~3B) | Very natural Chinese/English design, cloning and voice direction; non-commercial licence; GPU recommended | Cloning needs 5–15 s clean audio and a word-for-word transcript |
| Kokoro-82M | Fastest, tiny, CPU friendly; built-in voices only, no cloning or emotion. 1.1-zh has 100 Chinese voices. | Speaker |

Hardware rule of thumb: Kokoro runs on any CPU; cloning models want 4–6 GB VRAM or 8 GB+ Apple Silicon; music models want 12 GB+ VRAM or 16 GB+ Apple Silicon. Q8 is the smallest precision with near-original quality; BF16/F16/ORIG are larger and slightly better.

Recommend in this order: what the user already has installed (list_models), then the lightest model that does the job.

## Music and arrangement models

- ACE-Step 1.5 Turbo / XL Turbo: songs or instrumentals from style (≤ 512 chars) + lyrics (≤ 4000 chars, [verse] [chorus] tags). Duration auto or 10–300 s. XL is higher quality and much larger.
- YuE2 3B: vocal songs (length follows the lyrics) or instrumentals (writes a score, then instruments play the vocal melody; lyrics optional), non-commercial licence. Can plan an ABC melody score first or cover a song via SheetSage2 (yovoice-music skill).
- Stable Audio 3 Small Music / Small SFX / Medium: instrumental music (Small Music, Medium) or sound effects (Small SFX) from an English description; no lyrics or vocals. Duration 1–120 s (Small) or up to 380 s (Medium), default 30 s for music and 5 s for sound effects. The 生成方式 setting can also start from an existing take of the same work: 改编 Rework (`edit` = `init_audio`, `init_noise_level` 0–1, lower stays closer) or 局部重绘 Inpaint (`edit` = `inpaint_audio`, `inpaint_start`/`inpaint_end` seconds), with `sourceGenerationId` naming the take. Stability AI Community License (free under USD 1M yearly revenue).
- SheetSage2: extracts melody and chords from a song for YuE2 covers.
- Lyric Aligner (optional): on the playback page, Auto-align separates the vocals and aligns the lyrics word by word to a generated song; saved with the version.
- SoundFonts (MuseScore General, GeneralUser GS, SGM-V2.01) render arrangements on the score page.
- All music models need inference engine v0.9.1 or later.

## Common fixes

- Dragging, repeating or trailing silence on long text (Breeze, VoxCPM2): shorten text_chunk_size in Advanced, then lower temperature to 0.6–0.8.
- Voice changes between chunks without a reference: design the voice on a short line, save it to the voice library, then clone from it.
- Cloning sounds wrong: use one clear speaker, little noise, 5–15 s; transcripts must match word for word for OmniVoice and Breeze.
- Audio check warnings (shown on a take, a story line or in `inspect_audio`): clipping / clicks / cutoff / silence / silent → regenerate that take or line; quiet → pick a target loudness when exporting (Audiobook −18, Podcast −16, Video −14 LUFS), no need to regenerate; dc → ignore.
- Slow or out of memory: pick Q8 or a smaller model, close other GPU apps, or switch compute device in Settings › Engine.
- Model missing or engine too old: the user installs it in Settings › Voice models, Settings › Music models (ACE-Step, YuE2, Stable Audio 3, SheetSage2) or Settings › Engine; you can propose it with propose_action.

## Error codes

Errors reach you as stable codes (in <ui_context>, get_generation_status, get_recent_errors). The list below is the exact text the user sees in Chinese; explain it in the user's language and give the fix.

<!-- errors:begin -->
- `timeline.packageInvalid` 工程文件无效或素材不完整。
- `timeline.packageLimit` 工程超过 500 MB，请分章备份。
- `timeline.importDuration` 音频时长需在 0.01 秒至 1 小时之间。
- `timeline.invalid` 音轨设置无效，请检查片段范围；最多 32 条音轨、2000 个片段及 24 小时。
- `timeline.inUse` 这段音频正在作品音轨中使用，请先移除对应片段。
- `subtitle.invalid` 字幕格式或内容无效。支持 SRT、VTT、ASS/SSA，最多 2 MB、2000 句、100 位说话人和 12000 字；请检查时间和说话人设置。
- `error.voiceReferenced` 参考音频正在被「{names}」使用，请先替换或移除引用。
- `error.voiceInUse` 此音色正在被角色使用，请先在角色中替换或解除引用。
- `error.characterInvalid` 角色或音色信息无效，请检查名称、台词长度及记录是否存在。
- `error.omniReferenceRequired` OmniVoice 克隆需要填写参考音频原文。
- `error.referenceTextRequired` {model} 克隆需要填写参考音频的完整原文。
- `error.xttsReferenceDuration` XTTS v2 需要 6–30 秒的参考音频。
- `error.voiceDescriptionRequired` 请填写声音描述。
- `error.omniAttributes` OmniVoice 仅接受预定义音色属性，同一类别只能选择一个。
- `error.speakerInvalid` 请选择有效的内置音色。
- `error.busy` 请等待当前操作结束，或先取消。
- `error.proxyURL` 请输入有效的 HTTP、HTTPS 或 SOCKS5 代理地址及端口，不包含路径或账号密码。
- `error.modelDirAbsolute` 模型目录必须是绝对路径。
- `error.modelDirSpace` 模型目录磁盘空间不足。
- `error.downloadHTTP` 下载失败（HTTP {status}），请检查网络或更换来源。
- `error.downloadRange` 下载源返回了错误的断点范围。
- `error.downloadSize` 下载源的文件大小不匹配。
- `error.downloadIncomplete` 下载未完成，可重试续传。
- `error.downloadStale` 断点已失效，请重试下载。
- `error.downloadChecksum` 文件校验未通过，请更换下载来源后重试。
- `error.downloadOversized` 下载文件超出声明大小。
- `error.generateFailed` 生成失败，请检查模型、显存和参考音频。可在设置中打开日志。
- `error.paramsOutOfRange` 生成参数超出范围。
- `error.stateSaveFailed` 状态保存失败。
- `error.stateCorrupt` 本地记录无法读取。
- `error.audioPathInvalid` 音频路径无效。
- `error.audioPathSymlink` 音频路径不能是符号链接。
- `error.audioMissing` 没有找到音频。
- `error.audioKindInvalid` 音频类型无效。
- `error.audioIDInvalid` 音频编号无效。
- `error.audioTooLarge` 参考音频需小于 20 MB。
- `error.audioDuration` 请选择 1 秒到 10 分钟的音频；超过 60 秒的录音会自动截取最清楚的一段。
- `error.audioFormat` 请选择有效的单声道或双声道 PCM / Float WAV 音频。
- `error.audioDecode` 无法解码音频，请检查文件是否损坏、加密或缺少音轨。
- `error.audioConverterMissing` 安装包缺少音频转换器，请重新安装完整的 yovoice 安装包。
- `error.nameLength` 名称需为 1–120 个字符。
- `error.draftLimits` 作品内容超出限制。
- `error.draftIDInvalid` 作品编号无效。
- `error.textRequired` 请输入 1–12000 字的正文。
- `error.titleLength` 作品名称需为 1–120 字。
- `error.languageUnsupported` 当前模型不支持此语言。
- `error.modeInvalid` 表达方式无效。
- `error.emotionInvalid` 情绪参数无效。
- `error.emotionStrength` 情绪强度需为 0–1。
- `error.emotionTextRequired` 请输入情绪描述，或选择理解正文。
- `error.emotionVoiceRequired` 请添加情绪参考音频。
- `error.voiceRequired` 请先添加音色参考音频。
- `error.voiceBusyDelete` 请等待生成结束后再删除声音。
- `error.modelRequired` 请先在设置中下载或导入模型。
- `error.modelUnsupported` 不支持的模型。
- `error.modelMoved` 模型文件已移动，请重新导入。
- `error.modelForgetBlocked` 此模型暂不可移除，请先结束相关操作。
- `error.downloadSource` 请选择有效的下载来源。
- `error.runtimeRequired` 请先安装或更新当前设备对应的推理内核。
- `error.runtimeMissing` 请先在设置中安装推理引擎。
- `error.runtimeUnique` 运行库未包含唯一的推理服务。
- `error.runtimeArchivePath` 压缩包包含非法路径。
- `error.runtimeArchiveLink` 运行库包含不支持的链接或特殊文件。
- `error.runtimeArchiveSize` 运行时解压体积异常。
- `error.engineStartFailed` 引擎启动失败，请检查运行库或更换计算设备。
- `error.engineStartTimeout` 引擎启动超时，请打开日志查看详情。
- `error.engineNoAudio` 引擎没有返回音频。
- `error.engineCrashed` 推理引擎在生成时意外退出，可以直接重试；反复出现时请关闭占用内存或显卡的程序，或换用更小的模型。（{detail}）
- `error.cpuBundleInvalid` 内置内核不是有效文件。
- `error.backendUnsupported` 不支持的计算设备或平台。
- `error.platformArch` 不支持的平台架构。
- `error.macBackend` macOS 支持 CPU 或 Metal。
- `error.macAppleSilicon` 仅支持 M 系列 Mac（Apple Silicon arm64）。
- `error.requestInvalid` 请求参数无效。
- `error.methodUnsupported` 不支持的操作。
- `error.voxModeInvalid` VoxCPM2 生成方式无效。
- `error.voxTextLimits` 声音描述或参考原文超出限制。
- `error.voxReferenceRequired` 精细克隆需要参考音频的原文。
- `error.voxParams` VoxCPM2 生成参数超出范围。
- `error.legacyRestore` 旧数据无法读取。
- `error.jobMissing` 任务不存在或已过期。
- `error.jobConflict` 任务 ID 已用于不同参数，或推理服务繁忙。
- `error.musicStyle` 请用 1–512 字描述风格。
- `error.musicLyrics` 歌词最多 4000 字。
- `error.musicParams` 音乐参数超出当前模型的范围，请检查时长、速度或重绘区间。
- `error.musicLyricsRequired` YuE2 生成带人声的歌曲需要歌词；不写歌词可以切到纯音乐。
- `error.musicSourceRequired` 请选择本作品已生成的一个版本作为改编或重绘的起点，或切回文字生成。
- `error.scoreInvalid` 乐谱格式不正确：请检查速度、拍号、声部和音符位置（最多 512 小节、32 个声部、20000 个音符、10 分钟）。
- `error.scoreTooLong` 乐谱太长：最多 {minutes} 分钟、{bars} 小节，请删减小节或调快速度后再试。
- `error.midiInvalid` 无法读取这个 MIDI 文件，请使用含音符的标准类型 0 或 1 MIDI。
- `error.melodyInvalid` 旋律谱有误：{issue}
- `error.melodyEmpty` 模型没有写出旋律谱，请重试或调整歌词。
- `error.coverModelRequired` 从歌曲提取旋律需要 SheetSage2 模型，请在“设置 › 音乐模型”中下载。
- `error.melodySoundFontRequired` 试听旋律谱需要一个音色库，请在“设置 › 编曲音色库”中下载。
- `error.alignModelRequired` 请先在设置的音乐模型里下载歌词对齐模型
- `error.alignLyrics` 这个版本没有可对齐的歌词
- `error.alignEmpty` 没能从人声里对上歌词，可以手动校准
- `error.engineUpgradeRequired` 该模型需要 {version} 及以上的推理内核，请在设置中更新内核。
- `error.aiProviderInvalid` AI 服务配置无效，请检查地址、名称和模型。
- `error.aiNotConfigured` 还没有可用的 AI 服务，请在“设置 › AI”中添加服务并选择模型。
- `error.aiAuth` AI 服务拒绝了密钥（HTTP {status}），请检查 API 密钥。
- `error.aiRateLimit` AI 服务暂时限流或额度不足。免费模型使用的人多时容易限流，请等一两分钟再试，或在写作栏换一个模型。
- `error.aiNetwork` 无法连接 AI 服务：{detail}
- `error.aiResponse` AI 服务返回错误（HTTP {status}）：{detail}
- `error.aiModelsPath` 这个服务没有模型列表，请直接填写模型名。
- `error.aiResultInvalid` AI 的结果无法使用：{detail}。请重试或换个说法。
- `error.aiTimeout` AI 服务在 {seconds} 秒内没有写完。可以在“设置 › AI 服务”里延长 AI 请求超时，或换一个更快的模型。
- `error.assistantMissing` 当前安装包未包含 AI 助手运行时，AI 写谱与写词暂不可用。
- `error.assistantProvider` 当前 AI 服务（ChatGPT 订阅）不能用于助手，请在设置里换用接口类服务。
- `error.codexMissing` 未找到 Codex CLI。请先安装 Codex（npm i -g @openai/codex 或 brew install codex），再点“检测”。
- `error.codexLoggedOut` Codex 尚未登录。点“用 ChatGPT 登录”，在浏览器中完成登录后再试。
- `error.codexFailed` Codex 运行失败：{detail}
- `error.codexLimit` ChatGPT 订阅的 Codex 用量已达上限或请求过于频繁，请稍后再试。
- `error.codexNoImage` Codex 没有生成图片：{detail}
- `error.aiFreeRate` 免费模型的使用次数暂时用完了，约 {seconds} 秒后会恢复，到时再试一次即可。
- `error.aiFreeBusy` 免费模型现在用的人太多，请稍等片刻再试，或在写作栏换一个模型。
- `error.aiFreePromptCap` 这次内容超过了免费模型单次请求的长度上限，重试也不会成功。可以缩短描述，或在 OrcaRouter 领取额度（orcarouter.ai/offers）或充值后换用付费模型。
- `error.aiFreeAccess` OrcaRouter 需要账号绑定一个注册较久的 GitHub 账号才能使用免费模型。请在 OrcaRouter 个人设置中绑定 GitHub，或充值后再用。
- `error.localApiPort` 端口需在 1024–65535 之间。
- `error.localApiPortInUse` 端口 {port} 已被其他程序占用，请换一个端口。
- `error.storageInsideApp` 数据目录不能放在应用安装目录内，避免更新时丢失。
- `error.storageTargetNotEmpty` 目标目录已存在且不为空，请选择空文件夹。
- `error.storageSame` 所选目录与当前数据目录相同。
- `error.storageInsideData` 新目录不能位于当前数据目录内，也不能包含当前数据目录。
- `error.storageRestartRequired` 数据目录已迁移，请完全退出 yovoice 并重新打开后再继续操作。
- `error.dataRootMissing` 数据目录已不存在或无法访问：{path}。如果在外置磁盘上请重新连接；目录被删除时请退出后重新打开 yovoice 选择处理方式。
- `error.diskFull` 磁盘空间不足，内容未能保存。请清理磁盘空间，或在“设置 › 常规 › 存储”中清理残留、把数据目录迁移到空间更大的磁盘后重试。
- `error.unknown` 出了点问题，请重试。
<!-- errors:end -->
