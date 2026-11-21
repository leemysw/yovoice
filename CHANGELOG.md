# Changelog

各版本的重要更新记录。日常改动记入 `Unreleased`；发布前合并重复项，整理为简短的功能、改进和修复说明。

## [Unreleased]

### English

- CLI model downloads now use the saved download source by default; failed downloads no longer change it, and explicit sources are saved only after success.
- Exporting large scores to MIDI is faster, with identical output.
- Fix the microphone staying active after rapidly starting a recording, cancelling microphone access, or leaving the page while access is pending.
- Cancelling score rendering now stops promptly without saving a completed WAV.
- Shorten Expression options and Speech sidebar labels across all interface languages to avoid clipped text, while keeping reference performance field headings in full.
- Rapidly switching pages no longer reports an error when a visual transition is interrupted.
- Browser preview: closing Stem Studio before its tracks finish loading no longer keeps their audio in memory.
- Fix an error that could drop characters when typing quickly in a draft.
- Fix a Linux desktop freeze when opening the Model menu or returning to the workbench from Settings on WebKitGTK 2.50.
- Fix the first-run tour spotlight on Linux so its rounded highlight stays on the intended control without a large white wedge.
- Windows: when GitHub rate-limits update checks, Check for updates now says so and when to try again, instead of reporting a network problem.
- Fix data loss: generating speech no longer silently deletes older takes after ten versions. API history and completed story takes are also retained during generation, startup and residual cleanup until explicitly deleted.
- Reference audio supports drag and drop and selecting generated speech from history, with audition, excerpt selection and an editable transcript. Saved references retain their source and remain usable after the original generation is deleted.
- Qwen3 CustomVoice now labels its optional delivery instructions as style guidance and explains how they work with the built-in speaker.
- New speech model Audio8 TTS Realistic 0.6B (Q8 / BF16): default voice and voice cloning with automatic language detection across 11 languages, 44.1 kHz output; cloning requires the reference transcript.
- Story narration evens out each line's loudness as it is generated, so lines no longer jump between quiet and loud. Lines generated earlier keep their level until regenerated.
- Importing a book recognizes scripts written as “Name: line” and casts each name as a role; narrator lines and notes such as Scene or Time are not treated as roles. Import book is also in the New project menu.
- Generation history shows model tags and a read-only configuration view with the saved text, time, seed and parameters, plus JSON export. The same view is available while selecting historical speech as a reference.
- Ming 3.0 TTS adds control modes: built-in voices picked from a list (with emotion variants where available), emotion, dialect (Cantonese, Sichuan-Chongqing), speed / pitch / volume, and free-form instructions. Paralinguistic tags such as [Laughter] can be inserted into the text.
- macOS: switching the interface language now relabels the whole native menu bar right away (Hide, Edit, Window and their items), without restarting the app.
- Settings > Assets: table columns now widen to fit their content, so headers, sort icons, type tags and status labels are no longer cut off in any language.
- Choose reference audio now says when the reference library is empty or a search has no matches, instead of showing a blank list.

### 简体中文
- CLI 模型下载默认沿用已保存的下载来源；下载失败不再改变来源，显式指定的来源仅在下载成功后保存。
- 修复快速重复开始录音、取消麦克风授权或等待授权时离开页面后，麦克风仍保持开启的问题。
- 取消编曲渲染后及时停止，不再继续渲染并保存完整 WAV。
- 缩短各语言界面的演绎选项和语音侧栏标签，避免文字被截断；参考演绎字段标题保留完整文案。
- 快速切换页面时，切换动画被打断不再报错。
- 浏览器预览：分轨工作台在音轨加载完之前关闭，不再把这些音频一直留在内存里。
- 修复快速输入作品正文时可能报错并丢字的问题。
- 修复 Linux 桌面版在 WebKitGTK 2.50 上打开模型菜单或从设置返回工作台时卡死的问题。
- 修复 Linux 首次使用引导的聚光遮罩，让圆角高亮准确覆盖目标控件，不再出现大片白色楔形。
- Windows：GitHub 限制更新检查次数时，“检查更新”会说明原因和可重试的时间，不再误报为无法连接网络。
- 修复音频丢失：语音生成不再达到十次后自动删除较早版本及原音频；接口历史和已完成的故事逐句版本也不会在生成、启动或清理残留时自动删除，保留到用户明确删除。
- 参考音频支持拖入文件，以及从生成历史选择语音、试听、截取节选并编辑原文；保存的样本保留来源，删除原生成记录后仍可使用。
- Qwen3 CustomVoice 将可选的演绎指令标为“风格指导”，说明其与内置音色的关系。
- 新增语音模型 Audio8 TTS Realistic 0.6B（Q8 / BF16）：默认音色与音色克隆，自动识别 11 种语言，44.1 kHz 输出；克隆需填写参考原文。
- 故事配音逐句生成时统一响度，句与句之间不再忽大忽小；之前生成的句子重新生成后才会调整。
- 导入小说可识别“角色：台词”格式的剧本，按名字分角色；“旁白”行和“场景”“时间”等说明行不算角色。“新建作品”菜单里也可以直接导入小说。
- 生成历史新增模型标签和只读的生成配置详情，可查看保存的文字、时间、随机种子与参数并导出 JSON；选择历史语音作为参考时也可查看。
- Ming 3.0 TTS 新增控制方式：从列表选择内置音色（部分音色可选情感）、情感、方言（粤语、川渝话）、语速 / 音高 / 音量，以及自由指令；正文可插入 [Laughter] 等非语言声音标签。
- macOS：切换界面语言后整个原生菜单栏立即换成新语言（隐藏、编辑、窗口及其菜单项），无需重启应用。
- 设置 > 资源：表格各列按内容自动加宽，所有语言下的表头、排序图标、类型标签和状态都不再被截断。
- 选择参考音频时，参考音频库为空或搜索没有结果会显示提示，不再是一片空白。

## [0.8.0] - 2026-11-15

### English

- Share songs to the yovoice community from the player or version menu: sign in through your browser, add a title, tags and a license, and the version goes up for review with its aligned lyrics. Reference voices are never included. Ocho offers to share a song once it finishes, and Settings › Community lists what you have shared and its review status.
- Song covers are drawn from the song's own loudness, the same as on the community page, and are embedded in exported FLAC and M4A files and used for library records.
- Keyboard shortcuts: a new Settings › Keyboard shortcuts tab lists every shortcut by area. Change keys, see conflicts and system-reserved keys, restore defaults, turn areas off, and export or import with a preview. Press ⌘/ (Ctrl+/) to see the shortcuts for the current page. Shortcuts no longer fire behind dialogs, swallow ⌥ / AltGr characters or interfere with typing, and some defaults moved off system and input-method keys.
- Six themes in Settings › General › Appearance: Paper, Ink, Lagoon, Sand, Sage and Abyss. Match system uses Paper or Ink, and the macOS title bar follows the theme.
- Transcribing a video keeps the picture: it plays on top with the current subtitle, the lines scroll below. Transcript editing gains continuous playback that skips long silences, undo and redo, and Delete at the end of a line to join the next one.
- New speech recognition models: Qwen3 ASR 1.7B, Confucius4-R2T2 and Parakeet TDT 0.6B v3 (the last two need engine v0.9.3). Settings › Models brings all model kinds into one tab and opens on a Defaults sub-tab, where you choose the recognizer and the vocal separation used for lyric alignment — HTDemucs 6-stem is a much faster option than the default BS-RoFormer.
- Smart lyric alignment is faster and more accurate: aligning again reuses separated vocals, long songs no longer drift toward the end, and bracketed notes in lyrics such as sound effects are skipped (songs with such notes need aligning again).
- Story narration can even out role volumes when exporting a track, and Balance role levels keeps the differences you set between lines of the same role.
- The song player's top bar is lighter, with a stop button on the lyric tools while aligning. The bottom player is tidier, and in single-track projects the buttons beside play switch to the previous or next version.
- Speech generation shows loading, synthesis and saving separately, with model residency, idle unloading and streamed audio duration.
- Fixes: Windows updates no longer leave `.yovoice-update.*` folders behind; the sidebar button no longer stays in the macOS title bar over the player; long style tags in the music inspector wrap instead of overflowing; dialog backgrounds are no longer blurred into blocks on macOS.

### 简体中文

- 加快大型乐谱导出 MIDI 的速度，导出内容保持不变。
- 可以从播放器或版本菜单把歌曲分享到 yovoice 社区：在浏览器里登录，填写标题、标签和使用许可后连同对齐过的歌词提交审核，参考音色不会上传。歌曲生成好后 Ocho 会提示分享；设置 › 社区里可以查看分享过的作品和审核状态。
- 歌曲封面按这首歌自己的响度起伏来画，和社区页一致；导出的 FLAC、M4A 和作品库唱片封套都用这张封面。
- 快捷键：设置新增“快捷键”标签，按功能区列出全部快捷键，可修改、提示冲突与系统占用、恢复默认、按功能区关闭，导入导出时先预览变化；任意页面按 ⌘/（Ctrl+/）查看当前页可用的快捷键。快捷键不再作用到弹窗背后、不再吞掉 ⌥ / AltGr 打的字符或妨碍打字，部分默认按键避开了系统和输入法。
- 设置 › 常规 › 外观新增纸白、夜墨、青岸、宣纸、苔绿、深海 6 套主题，默认跟随系统用纸白或夜墨，macOS 标题栏也跟着换色。
- 转写视频时保留画面：上面播放画面并叠加当前字幕，下面滚动字幕。转写编辑支持连续播放并跳过长静音、撤销重做，以及在行尾按 Delete 合并下一行。
- 新增语音识别模型 Qwen3 ASR 1.7B、Confucius4-R2T2 和 Parakeet TDT 0.6B v3（后两个需要 v0.9.3 内核）。“设置 › 模型”把各类模型合到一个标签，首先打开“默认模型”子页，可选语音识别模型和歌词对齐用的人声分离；HTDemucs 6-stem 比默认的 BS-RoFormer 快很多。
- 歌词“智能对齐”更快更准：再次对齐直接用已分离的人声，长歌后半段不再错位，歌词里括号括起来的音效等注释不参与对齐（有这类注释的歌需要重新对齐）。
- 故事配音导出音轨时可以统一各角色音量；“均衡角色音量”保留同一角色几句之间手动调的差别。
- 歌曲播放页顶栏更轻，对齐时歌词工具按钮变成停止按钮；底部播放器更紧凑，单轨作品里播放键两侧改为切换上一版、下一版。
- 语音生成分别显示加载、合成和保存阶段，以及模型驻留、空闲卸载和流式收到的音频时长。
- 修复：Windows 更新不再留下 `.yovoice-update.*` 文件夹；macOS 播放页标题栏不再残留侧栏按钮；音乐检查器里较长的风格标签换行，不再超出面板；macOS 上弹窗背后的页面不再糊成方框。

### 贡献者 / Contributors

@leemysw @zoyluoblue @david-bowiegxw

## [0.7.0] - 2026-11-11

### English

- Transcripts are saved and listed like your other work. Edit subtitles as plain text: Enter splits a line, Backspace at the start joins it, with find and replace, undo and line playback; changes save automatically. You can record on the Transcribe page, pick the track of multi-track files, and turn on loudness normalization or vocal isolation for quiet recordings or background music.
- Transcribe accepts audio and video up to 4 GB and 1 hour by default; the limits and how lines are split can be changed in Settings › General › Transcribe. Lines no longer leave the last characters of a sentence on their own.
- Local models: scan a folder and register the matching models in one step, or convert IndexTTS 2.0 / 2.5 checkpoints on your device. Imports show verification progress and catch a wrong IndexTTS version early.
- Model downloads can be paused, resumed and cancelled one by one and keep their version. Updates verify the whole new package before replacing the old one, and choosing an existing download folder recovers verified packages in the background.
- Starting with the next update, macOS and Windows download a much smaller patch when you are on the previous stable version; if the patch can't be applied, the full package is used.
- CLI: `yovoice generate` now makes songs and sound effects with ACE-Step, YuE2 and Stable Audio 3, and new `yovoice transcribe`, `yovoice separate` and `yovoice to-midi` commands turn audio into subtitles, stems and MIDI. The Agent Skill covers them all.
- YuE2 songs vary more: a new seed for every score, more song forms for instrumentals, styles up to 2000 characters, and a new Song shape section for language, tempo and structure. Ocho steers new songs away from the genre and tempo of earlier ones.
- With ModelScope as the download source, YuE2, SheetSage2, Ming 3.0 TTS, Phonon and ACE-Step 1.5 XL Turbo (BF16) download from ModelScope too.
- Progress bars follow the app theme and no longer show step counts as file sizes.
- Fixes: custom data folders with Chinese characters on Windows; choosing PNG, JPEG and WebP images for “Style from image” on macOS, with each import dialog filtering its own formats; a `host.log` check of the local service when the macOS window fails to load.

### 简体中文

- 语音转写结果像作品一样保存和列出。像改文档一样编辑字幕：回车拆分、行首退格合并，可查找替换、撤销、点行试听，改动自动保存。转写页可直接录音；多音轨文件可选择音轨；可选响度归一化和预先提取人声，应对音量偏小或带背景音乐的录音。
- 语音转写默认支持 4 GB、1 小时以内的音频和视频，上限和字幕断行方式可在“设置 › 常规 › 语音转写”调整；不再把一句话最后一两个字单独断成一行。
- 本地模型：扫描目录后一次确认并登记匹配的模型，也可在本机把 IndexTTS 2.0 / 2.5 检查点转换为可用模型。导入时显示校验进度，并提前提示 IndexTTS 版本选错。
- 模型下载可逐个暂停、继续和取消，并保留所选版本。更新完整校验新包后才替换旧包；重新选择已有的下载目录时，会在后台校验并恢复已有模型包。
- 从下一次更新起，macOS 和 Windows 在上一正式版上升级只需下载体积小得多的差分包；补丁无法应用时自动改用完整更新包。
- 命令行：`yovoice generate` 支持用 ACE-Step、YuE2 和 Stable Audio 3 写歌和生成音效；新增 `yovoice transcribe`、`yovoice separate` 和 `yovoice to-midi`，把音频转成字幕、分轨和 MIDI。Agent Skill 同步说明。
- YuE2 歌曲更多变：每次写谱换新种子，纯音乐曲式更丰富，风格描述最多 2000 字，新增“歌曲展开”可选语言、速度和结构；Ocho 写新歌时会避开已有作品的流派和速度。
- 下载来源选 ModelScope 时，YuE2、SheetSage2、Ming 3.0 TTS、Phonon 和 ACE-Step 1.5 XL Turbo（BF16）也从 ModelScope 下载。
- 进度条统一使用应用主题，不再把段数显示成文件大小。
- 修复：Windows 含中文的自定义数据目录启动时被误报为不存在；macOS「看图取风格」无法选择 PNG、JPEG 和 WebP，各导入窗口改按自身支持的格式筛选；macOS 窗口加载失败时把本地服务检查结果写入 `host.log`。

### 贡献者 / Contributors

@leemysw @david-bowiegxw

## [0.6.0] - 2026-11-09

### English

- Speech recognition and subtitles with the optional Qwen3 ASR 0.6B model (30 languages): a new Transcribe page turns audio or video into timed subtitles (SRT / WebVTT); “Recognize text” fills in a reference transcript; speech versions can export aligned subtitles.
- Stems: “Separate stems” splits a music version into drums, bass, vocals, guitar, piano and other (HTDemucs, with optional BS-RoFormer for cleaner vocals). The new full-screen stem studio plays all stems in sync with per-track waveform, volume, mute and solo. Stems can be exported to a folder with DAW-friendly names, separated again or deleted, and songs up to 10 minutes now separate reliably.
- “Transcribe to MIDI” (optional MuScriptor model, non-commercial) turns a music version into a score project with one track per instrument and sensible levels, so the lead melody is no longer buried.
- YuE2: hum a melody into a score, edit or hand-write the melody score in a large editor, re-sing only the changed bars, make up to 4 candidate takes, apply LoRAs, take style tags from an image, and tune Top P / Top K / repetition penalty.
- Export audio as FLAC or M4A as well as WAV, with title, lyrics, cover and an AI-generated note in the tags; version exports can also target audiobook, podcast or video loudness.
- “Listen while generating” for models that support streaming; Settings › Engine › Runtime sets threads, GPU device, idle unload and model-specific options. Kokoro gets a speaking-rate control.
- Long reference recordings open a section picker with the clearest part preselected.
- Import existing local GGUF models and SF2 sound fonts without copying them; models replaced by a catalog update can be rolled back to the earlier version.
- Interface: smoother transitions, a resizable side panel, Transcribe moved under Text to speech, simpler Settings copy, less CPU when idle, and a smaller install with a faster first screen.
- Reliability: automatic restore from backup, safer media deletion and data-folder moves, resumable downloads that survive network hiccups, no hang on quit, errors shown where they happen (Ocho panel, music player, dialogs), and a clear message instead of a blank window when the macOS window fails to load.

### 简体中文

- 可选语音识别模型 Qwen3 ASR 0.6B（支持 30 种语言）：新增“语音转写”页，把音频或视频转成带时间的字幕（SRT / WebVTT）；“识别文字”自动填写参考原文；语音版本可导出对齐的字幕。
- 分轨：“分离音轨”把音乐版本分成鼓、贝斯、人声、吉他、钢琴和其他六轨（HTDemucs，可选 BS-RoFormer 让人声更干净）；新的全屏分轨工作台统一播放各轨，每轨有波形、音量、静音和独奏。分轨可按 DAW 习惯命名导出到文件夹，也可重新分离或删除；10 分钟以内的歌都能稳定分离。
- “转为 MIDI”（可选 MuScriptor 模型，仅限非商业用途）：把音乐版本转成编曲作品，每种乐器一轨并按角色定电平，主旋律不再被伴奏盖住。
- YuE2：哼一段扒成旋律谱，旋律谱可放大编辑或手写，按改动只重唱变化的小节，一次最多生成 4 个候选，支持 LoRA，可看图取风格，并可调写谱阶段的 Top P / Top K / 重复惩罚。
- 导出音频新增 FLAC 和 M4A，标签里写入标题、歌词、封面并注明 AI 生成；版本导出也可选有声书、播客或视频平台的目标响度。
- 支持流式的模型可“边生成边试听”；“设置 › 推理引擎 › 运行参数”可设置线程、GPU 设备、空闲卸载和模型专属参数；Kokoro 新增语速调节。
- 较长的参考录音先选段，已预先选中最清楚的一段。
- 可原地导入本机已有的 GGUF 模型和 SF2 音色库；经目录更新替换过的模型可以回退到旧版本。
- 界面：过渡更连贯，右侧面板可调宽，语音转写移到语音生成下方，设置页文案更简洁，空闲更省 CPU，安装包更小、首屏更快。
- 更可靠：状态库丢失时自动从备份恢复，删除素材和迁移数据目录更稳妥，下载遇网络抖动自动续传，退出不再卡住，错误在出错的地方就地提示（Ocho 面板、音乐播放页、各对话框），macOS 窗口加载失败时给出原因而不是白屏。

### 贡献者 / Contributors

@leemysw @zoyluoblue @david-bowiegxw

## [0.5.0] - 2026-10-28

### English

- Six new speech models: Ming 3.0 TTS, Voxtral TTS, Plapre 3, XTTS v2, Gradium Phonon and Fish Audio Drama 3, covering built-in voices, voice design and multilingual voice cloning; Drama 3 also takes speaker and event tags. Each story-narration role can use them separately. They need the audio.cpp v0.9.3 engine.
- Music generation adds Stable Audio 3 (Small Music, Small SFX, Medium; Q8 / F16): generate instrumentals from an English description, up to 2 minutes with Small and about 6 with Medium, remix a whole existing version, or redraw part of it. New "Sound effects" generates 1–30 s effects from a description. Stable Audio 3 uses the Stability AI Community License (free below US$1M annual revenue).
- The engine is upgraded to audio.cpp v0.9.3: fixes occasional wrong results on Metal and CUDA and speeds up several models. Engines v0.7.4 and later keep working; update from Settings. A new CUDA "Performance first" mode speeds up ACE-Step, Qwen3-TTS, YuE2, VoxCPM2 and Drama 3 at the cost of more VRAM.
- Kokoro can blend two voices of the same language, set per story-narration role.
- Downloaded models show "Update available" in Settings when upstream releases a new version, with one-click update and a dismissible sidebar notice; old versions keep working.
- Audio check after every generation: clipping, clicks, cut-off endings, long silences, near-silence or low volume are flagged in the player and next to the affected story lines, with details and timestamps on hover. Ocho checks audio before handing it over and regenerates only the faulty story lines.
- Export to a target loudness: audiobook −18, podcast −16 or video platforms −14 LUFS, with peaks kept under −1 dBTP.
- Reference recordings up to 10 minutes: clips over 60 s are trimmed to the clearest 5–15 s of speech automatically, and "Auto pick" is available when trimming.
- Story narration can add yovoice-generated speech, sound effects and music straight to a track; Ocho can add sound effects to a story, update models and turn on "Performance first".
- Smoother background-music ducking: it dips before speech starts, holds through short pauses and recovers smoothly.
- The Settings › Resources table is simpler and fits on one screen, with row actions in a "More" menu; narrow windows scroll sideways.
- Clearer errors: picking a ChatGPT subscription in the Ocho panel explains right away that the assistant can't use it and lets you switch back; an engine crash mid-generation now says "The inference engine exited unexpectedly" with the reason, instead of a network-like error.
- Interface polish: the asset dialog in story narration keeps a stable height when switching types, and the editor scrollbar sits against the divider.

### 简体中文

- 新增 6 个语音模型：Ming 3.0 TTS、Voxtral TTS、Plapre 3、XTTS v2、Gradium Phonon 和 Fish Audio Drama 3，覆盖内置音色、声音设计与多语言音色克隆，Drama 3 还支持说话人和事件标签；故事配音的每个角色可分别使用，需要 audio.cpp v0.9.3 内核。
- 音乐生成支持 Stable Audio 3（Small Music、Small SFX、Medium，Q8 / F16）：按英文描述生成纯音乐，Small 最长 2 分钟、Medium 约 6 分钟，可以已生成的版本为起点整体改编或局部重绘；新增“音效生成”，按描述生成 1–30 秒音效。模型采用 Stability AI 社区许可，年收入低于 100 万美元可免费使用。
- 推理内核升级到 audio.cpp v0.9.3：修复 Metal 与 CUDA 上偶发的计算错误，多个模型生成更快；已装 v0.7.4 及以上内核的仍可使用，设置页可选更新。CUDA 新增“性能优先”模式，为 ACE-Step、Qwen3-TTS、YuE2、VoxCPM2 和 Drama 3 加速，但占用更多显存。
- Kokoro 支持按比例混合两种同语言音色，故事配音的每个角色可分别设置。
- 已下载的模型在上游发布新版本后，设置里标出“有新版本”并可一键更新，侧栏给出一次可关闭的提示；旧版本仍可使用。
- 生成后自动体检音频：发现爆音、咔哒声、结尾截断、长静音、几乎无声或音量过小时，在播放栏和故事配音对应句子旁提醒，悬停可看问题和时间位置；Ocho 交付前也会检查，故事配音只重新生成有问题的句子。
- 导出时可选目标响度：有声书 −18、播客 −16、视频平台 −14 LUFS，峰值不超过 −1 dBTP。
- 参考音频支持最长 10 分钟的录音：超过 60 秒时自动截取人声最清楚的 5–15 秒，裁剪时也可点“自动挑选”。
- 故事配音可直接把 yovoice 生成的语音、音效和音乐加到音轨；Ocho 能给故事配音加音效、更新模型和开启“性能优先”。
- 背景音乐压低更自然：说话前提前让位，句间短停顿不再忽高忽低，说完后平滑恢复。
- 设置“资源”页表格精简，一屏放下，每行操作收进“更多”菜单；窄窗口可左右滚动。
- 提示更清楚：Ocho 面板选中 ChatGPT 订阅时直接说明助手用不了并可就地切回；推理引擎中途崩溃时提示“推理引擎意外退出”并附上原因，不再显示像网络故障的报错。
- 界面细节：故事配音素材弹窗切换类型时高度保持稳定，作品编辑区滚动条贴靠右侧分割线。

## [0.4.1] - 2026-10-21

### English

- Fix macOS auto-update always failing after download with "Update verification failed (codesign) … invalid requirement specification". The bug is in the updater of 0.3.0–0.4.0 itself, so on macOS please download and install 0.4.1 manually once; later updates will install automatically.

### 简体中文

- 修复 macOS 自动更新下载完成后总是提示“更新校验失败（codesign）……invalid requirement specification”、无法安装的问题。问题出在 0.3.0–0.4.0 自带的更新程序里，macOS 用户请手动下载安装一次 0.4.1，之后即可正常自动更新。

## [0.4.0] - 2026-10-21

### English

- New Linux x64 desktop app: `.deb` (Debian/Ubuntu) and `.tar.gz` with `install.sh`. It runs on the bundled CPU engine, can download a Vulkan GPU engine in Settings, and needs WebKitGTK 4.1; auto-update is not available on Linux yet.
- Word-by-word lyrics on the music playback page: each word lights up as it is sung, timed from the vocals. A new one-line-per-screen "Glow" style flies words in and lights them up, good for screen recording. Export word-level LRC.
- Optional lyric alignment model (BS-RoFormer vocal separation + Qwen3 Forced Aligner, about 1.3 GB): "Smart align" separates the vocals, skips interludes and long pauses, and aligns the lyrics word by word, line by line; results are saved with the version.
- Refreshed playback page: an immersive title bar on macOS, a "Lyric tools" menu for calibration, alignment and export, reworked "Glow" motion and backdrop, and smoother lyric scrolling. "Adjust lyric timing" anchors a line to the playhead or nudges it by 0.1/0.5 s (←/→), with or without shifting later lines; drag single words on a timeline or tap along while listening.
- Smaller installers: the Kokoro pronunciation data (about 10 MB) now downloads together with the Kokoro model.
- Settings › General › "Features" lets you hide story narration, music generation and the Ocho assistant; AI service settings hide when both Ocho and music are off.
- Faster launch and a smoother interface: fixes launch stalling on the splash screen when recent work includes 20–30 minute audio; pages load on first open; generation, downloads and Ocho replies no longer redraw the whole interface.
- Fix exporting longer music (about two minutes or more) doing nothing on Windows and Linux; long timeline exports are no longer limited either. The player toolbar now has "Show in folder", with export under "More".
- Fix model downloads from ModelScope failing size checks after the mirror was refreshed.
- The Windows installer now supports Windows 10 1809 (17763) and later.
- On upgrade, saved projects, assistant chats and engine records are converted to the new format once, with a database backup made first.

### 简体中文

- 新增 Linux x64 桌面版：提供 `.deb`（Debian/Ubuntu）和附 `install.sh` 的 `.tar.gz`，开箱使用内置 CPU 内核，可在设置中下载 Vulkan GPU 内核；需要系统提供 WebKitGTK 4.1，暂不支持自动更新。
- 音乐播放页逐字点亮歌词：按音频里的人声分出每个字的时间；新增一句一屏的“浮光”样式，字随演唱逐个飞入亮起，适合录屏；可导出逐字 LRC。
- 新增可选下载的歌词对齐模型（BS-RoFormer 人声分离 + Qwen3 Forced Aligner，约 1.3 GB）：“智能对齐”先分离人声，去掉间奏和长停顿，再按句把歌词逐字对到演唱上，结果随版本保存。
- 音乐播放页焕新：macOS 上标题栏与背景融为一体；校准、对齐、导出收进“歌词工具”菜单；“浮光”动效和背景重做，歌词滚动更顺滑。新增“调整歌词时间”：把一句锚定到当前播放位置，或整句提前、推后 0.1/0.5 秒（←/→），可选后面跟着移或只改这一句；单字可在时间轴上拖动，也可边听边跟唱打点。
- 安装包变小：Kokoro 发音库（约 10 MB）改为第一次下载 Kokoro 模型时一并下载。
- 设置 › 通用新增“功能显示”，可分别隐藏故事配音、音乐生成和 Ocho 助手；Ocho 与音乐生成都关闭时一并隐藏 AI 服务设置。
- 启动更快、界面更流畅：修复最近作品里有二三十分钟长音频时启动停在启动画面的问题；各页面第一次打开时才加载；生成、下载和 Ocho 回复过程中不再重绘整个界面。
- 修复 Windows 和 Linux 上导出约两分钟以上的音乐时点击没有反应的问题，时间线导出长音频也不再受限；播放器工具栏改为“打开位置”，导出移到“更多”菜单。
- 修复 ModelScope 镜像刷新后，从该来源下载模型时大小校验失败的问题。
- Windows 安装包最低系统要求放宽到 Windows 10 1809（17763）。
- 升级时一次性把旧版本保存的作品、助手对话和内核记录转换为新格式，转换前自动备份数据库。

## [0.3.1] - 2026-10-19

### English

- Fix a crash on launch on macOS 26 caused by the sidebar button in the title bar.
- Fix long pages on Windows being covered by a large black block; main scroll areas now show a thin, light scrollbar.

### 简体中文

- 修复 macOS 26 上标题栏侧边栏按钮导致应用启动后闪退的问题。
- 修复 Windows 上内容超过一屏的页面被一大片黑色遮住的问题；主要滚动区域显示细的浅色滚动条。

## [0.3.0] - 2026-10-19

### English

- Meet Ocho, the built-in AI assistant (⌘J / Ctrl+J): create and edit projects, write lyrics and scores, pick voices, tune parameters and start generations by chatting. It sees your selection and recent results, remembers preferences, and asks before anything destructive.
- YuE2 songs can start from a melody score: write or extract the melody and chords, view them as staff notation, tracks or ABC, preview with a sound font (notes light up as they play), edit, undo, export `.abc`, then generate from the score. Adds instrumental songs, covers via SheetSage2, and song forms that vary from song to song.
- Novel import for story narration (TXT, Markdown, EPUB), SRT/WebVTT subtitle export, LRC lyrics export, and side-by-side comparison of song versions on the playback page.
- New settings pages: Resources to find and clean up unused audio, Logs with diagnostic bundles, separate Speech and Music model pages with one row per model and a precision switch, and ChatGPT (Codex) as an AI provider.
- The interface now speaks Traditional Chinese, Japanese, Korean, Spanish, French, German, Portuguese (Brazil), Russian, Italian and Vietnamese, with an opening animation, a feature tour and smoother motion throughout.
- New projects default to downloaded models; `yovoice serve` serves interactive API docs at `/docs/`; Score projects move under Music as "Score generation".

### 简体中文

- 新增 AI 助手 Ocho（⌘J / Ctrl+J）：用对话新建和修改作品、写词写谱、挑音色、调参数、发起生成；能看到你的选中内容和最近结果，记住偏好，删除等操作先确认再执行。
- YuE2 歌曲可以先写旋律谱：按歌词写谱或从歌曲提取，用五线谱、轨道或 ABC 查看，用音色库试听（谱面跟随高亮）、修改、撤回、导出 `.abc`，再按谱生成整首歌；新增纯音乐、SheetSage2 翻唱，写词时按曲风选择不同曲式。
- 故事配音支持导入小说（TXT、Markdown、EPUB）和导出 SRT/WebVTT 字幕；音乐播放页可导出 LRC 歌词，并在同一作品的各版本间对比试听。
- 设置新增“资源”页（查找并清理未使用的音频）、“日志”页（可导出诊断包），模型分为“语音模型”和“音乐模型”两页，每个模型一行、切换精度下载；AI 服务新增 ChatGPT (Codex)。
- 界面新增繁體中文、日本語、한국어、Español、Français、Deutsch、Português (Brasil)、Русский、Italiano 和 Tiếng Việt，加入开场动画、功能引导和更顺滑的动效。
- 新建作品默认使用已下载的模型；`yovoice serve` 在 `/docs/` 提供交互式 API 文档；「编曲」更名为「编曲生成」并入「音乐生成」。

## [0.2.1] - 2026-10-16

### English

- Add direct Kokoro-82M 1.1-zh downloads from Hugging Face and ModelScope, and simplify model management to downloads from the app or CLI.
- Add first-run preparation guidance, faster speech generation, batch reference-audio deletion, readable generated-audio filenames, and safer shared-file cleanup.
- Add a full music playback page with synchronized lyrics, vocal alignment and calibration, plus improved score limits, AI naming, and style editing.
- Move projects, voices, models and settings to transactional SQLite storage with backups, migration from `state.json`, storage relocation, recovery, and lifecycle cleanup.
- Improve desktop reliability across Windows and macOS, including service recovery, process cleanup, tray behavior, narrow-window layouts, localized Windows UI, signing checks, and automatic updates.
- Add Breeze TTS 2, text and subtitle file import, local MCP and API integration improvements, OrcaRouter, and clearer audio, migration, disk, and save-error handling.

### 简体中文

- 新增从 Hugging Face 和 ModelScope 直接下载 Kokoro-82M 1.1-zh，模型统一通过应用或 CLI 下载，并自动识别模型目录中的完整模型。
- 新增首次生成准备清单、快速语音合成、参考音频批量删除、可读的生成音频文件名和更安全的共享文件清理。
- 新增带歌词同步、人声定位与校准的音乐播放页，改进编曲时长限制、AI 自动命名和风格编辑。
- 作品、音色、模型和设置迁移到带事务与备份的 SQLite，支持从 `state.json` 迁移、存储位置迁移、故障恢复和生命周期清理。
- 提升 Windows 与 macOS 桌面可靠性，涵盖本地服务恢复、进程清理、托盘行为、窄窗口布局、Windows 界面本地化、签名校验和自动更新。
- 新增 Breeze TTS 2、文本与字幕文件导入，改进本机 MCP 与 API、OrcaRouter，以及音频、迁移、磁盘和保存失败提示。

## [0.2.0] - 2026-10-11

### English

- New Music projects: set the style with tags, write lyrics with section markers or go instrumental, and generate full songs with ACE-Step 1.5 Turbo / XL Turbo or YuE2 3B (vocal songs whose length follows the lyrics; CC BY-NC 4.0, non-commercial). Each take is kept as a version you can preview, compare, reuse and export. Models made of several files can now be downloaded.
- New Score projects: write notes per track by bar and beat, import MIDI, or let an agent compose, then render every track with a General MIDI sound font and mix by role. The track area spans the bottom of the window with sections on the timeline, zoom, scrolling and a playhead; export MIDI or score JSON. Choose MuseScore General, GeneralUser GS or SGM-V2.01. The CLI adds `yovoice score render|midi|from-midi` with stems, MCP adds `render_score`, and the Agent Skill adds a score guide.
- Optional AI providers (DeepSeek, Qwen, Zhipu, Kimi, Doubao, MiniMax, OpenAI, Anthropic, OpenRouter, coding plans, local and custom endpoints) write a whole score or song style, lyrics and title from one sentence, run in the background, and can switch models on the spot.
- A refreshed interface: ticket-style project lists with record and cassette covers, grouped settings, a separate sound font page, side panel toggles in the title bar (the right panel toggle only appears in a workspace), and hover hints only for truncated text or icon buttons.
- The audio.cpp engine is upgraded to v0.9.1 and updates separately from the app; new Windows CUDA 12.4 and 13.3 installers.
- Fixes for long AI requests timing out, saving on exit, Windows time-zone saves, timeline menus, deleting the last project, and clearer error messages and diagnostic logs.

### 简体中文

- 新增“音乐生成”：用标签定风格，写带段落标记的歌词或改为纯音乐，由 ACE-Step 1.5 Turbo / XL Turbo 或 YuE2 3B（带人声、长度随歌词，CC BY-NC 4.0 仅限非商业）生成整首歌曲；每次生成保留为版本，可试听、对比、复用和导出。支持下载由多个文件组成的模型。
- 新增“编曲”：按小节和拍写各声部音符，或导入 MIDI、让 Agent 写谱，用 General MIDI 音色库逐声部渲染并按角色混音。轨道区横跨窗口底部，段落标在时间轴上，可缩放、滚动并显示播放指针；可导出 MIDI 或乐谱 JSON。音色库可选 MuseScore General、GeneralUser GS 或 SGM-V2.01。CLI 新增 `yovoice score render|midi|from-midi`（含分轨），MCP 新增 `render_score`，Agent Skill 新增编曲参考。
- 可选接入 AI 服务（DeepSeek、通义千问、智谱、Kimi、豆包、MiniMax、OpenAI、Anthropic、OpenRouter、编程套餐、本地与自定义接口），一句话写出整份编曲或歌曲的风格、歌词和标题，在后台进行，可随时切换模型。
- 界面焕新：票根式作品列表配唱片与磁带封面，设置页分组，音色库单独成页，左右面板开关集成到标题栏（右侧面板开关只在工作区显示），悬浮提示只在文字被截断或图标按钮需要说明时出现。
- 推理内核升级到 audio.cpp v0.9.1，与应用分开更新；新增 Windows CUDA 12.4 与 13.3 安装包。
- 修复长 AI 请求超时、退出保存、Windows 时区作品保存、时间线菜单、删除最后一个作品等问题，错误提示和诊断日志更具体。

## [0.1.7] - 2026-10-05

### English

- Run a remote speech service with HTTP API and MCP support. Submit, query, cancel, and download generation tasks with authentication, retry deduplication, and configurable timeouts.
- Use the Agent Skill with either a local CLI or a remote service. User guides and CLI packages now include separate English and Chinese documentation.
- Fix Windows save-error reporting and allow a recovery backup when saving on exit fails. Improve diagnostic logs for saving and generation failures.

### 简体中文

- 新增 HTTP API 与 MCP 远程语音服务，支持任务提交、查询、取消和音频下载，提供认证、重试去重与可配置超时。
- Agent Skill 支持本地 CLI 和远程服务；用户指南与 CLI 安装包提供独立中英文文档。
- 修复 Windows 保存错误提示，退出保存失败时可备份作品；完善保存和生成失败的诊断日志。

## [0.1.6] - 2026-10-01

### Added

- 角色支持保存多种演绎方式，每种演绎可独立选择模型和参数，故事台词和语音项目可分别选用。

### Fixed

- 统一演绎选择框与新增、更多按钮的尺寸和对齐。
- 修复音轨面板调高区域遮挡播放按钮的问题，拖拽仅在顶部横线附近触发，横线贴近面板上边线外侧，并缩小播放控制图标。
- 移除应用图标底板边缘的光带，清理透明轮廓杂点，并校准 macOS 图标的主体边界和小尺寸留白。

## [0.1.5] - 2026-09-29

### Added

- 新增故事配音与语音生成两类作品，支持字幕导入、分段生成和可编辑音轨。
- 新增音轨裁剪、撤销与重做、混音及 WAV 导出，支持作品归档导入导出与状态恢复。
- 新增 Kokoro 官方 BF16 模型下载。
- 新增版本变更日志，发布时自动将对应版本的说明展示到 GitHub Release 页面。

### Changed

- 移除待处理台词批量生成，播放时正文始终自动跟随。

### Fixed

- 优化音轨缩放、滚动、片段拖动与磁吸裁剪交互，统一单人和多人播放指针样式。
- 修复旧版 WebKit 下拉浮层样式，通知展示不再挤动工作台布局。
- 改进 Windows 窗口尺寸适配与位置保存，以及 macOS 应用启动和图标边距。

## [0.1.4] - 2026-09-26

### Added

- 新增角色库，保存并复用音色与声音设置；声音库与创作流程共用编辑能力。
- 新增 Kokoro 官方 Q8 模型下载及 49 个内置音色，支持实验性多语言和中文版本导入。

### Changed

- 优化声音库、生成历史、参考音频片段与原文管理，统一搜索、头像、音频试听和弹窗交互。

### Fixed

- 修复 macOS 麦克风权限回调崩溃，兼容旧版 macOS 的下拉选择器。
- 修复 VoxCPM2 长参考音频的编码器容量问题。
- 修复服务退出时未等待清理完成的问题，并保留 Windows 界面兼容修复。

## [0.1.3] - 2026-09-19

### Changed

- 优化 Windows 窗口边框、滚动、原生菜单与应用对话框。
- 新增代理开关和设置自动保存，调整下拉菜单定位。

### Fixed

- 修复 Windows 下载归档目录路径处理，完善 .NET 8 构建兼容性。

## [0.1.2] - 2026-09-18

### Added

- 新增 OmniVoice 与 Qwen3-TTS 模型及对应的声音设计、克隆和生成参数。
- 新增英文界面，支持语言偏好及 macOS 菜单、提示本地化。

### Changed

- 整理偏好设置、模型目录操作与生成控制面板。

### Fixed

- 修复 macOS 自动更新时 `lipo` 架构校验参数顺序错误。

## [0.1.1] - 2026-09-16

### Added

- 新增 VoxCPM2 Q8 / BF16，支持声音设计、音色克隆和参考原文辅助克隆，App 与 CLI 均可使用。
- 新增声音描述、引导强度、推理步数和随机种子设置。

### Changed

- 优化模型管理布局与按钮，下载期间可移除其他模型的登记。
- 简化 `make app-run`，分离日常启动与安装包制作；采用完整生成后播放。

### Fixed

- 修复 macOS 麦克风权限归属，改用原生权限请求。

## [0.1.0] - 2026-09-16

### Added

- 首个公开版本，提供 macOS Apple Silicon 与 Windows 桌面安装包。
- 支持 IndexTTS 2.0 / 2.5 本地生成、模型下载及 GGUF 导入。
- 支持参考音色、参考演绎、情绪调节、文字引导和参考音频录制。
- 提供声音库、作品历史、版本管理与音频试听。
- 提供 macOS、Windows、Linux 独立 CLI 与 Agent Skill，内置精简 FFmpeg 处理常见音频格式。
