# Changelog

各版本的重要更新记录。日常改动记入 `Unreleased`；发布前合并重复项，整理为简短的功能、改进和修复说明。

## [Unreleased]

### English

- Safer data: when the state database is missing but a backup exists, yovoice restores from the backup instead of creating an empty database that overwrites it; quitting midway through deleting media no longer removes audio still in use; edits made while the data folder is being moved are no longer lost, and saving keeps working after a failed move.
- More reliable downloads: transient network errors, server hiccups and stalls resume and retry automatically; pausing or cancelling no longer deletes a fully downloaded file; after switching the download source, the file is checked to be the same one before resuming.
- Quitting no longer hangs: an in-progress data folder move is stopped first instead of waiting for the copy to finish, and an internal error in one operation no longer makes every later operation unresponsive.
- Cleaner cleanup: removing a model also deletes the temporary files left by downloads and updates, and “Clean residuals” reclaims expired temporary files in the models folder; a failed Kokoro pronunciation library update keeps the existing version.
- More reliable assistant: a message that fails to save shows an error instead of silently disappearing; the same proposal is never executed twice; the last lines of a reply are no longer lost when the assistant process exits.
- Remote API errors now return a JSON error code with a status code matched to the error type (bad parameters no longer return 500); the CLI prints the error code and parameters on failure.
- Ocho panel: a message that fails to send (too long, the assistant is busy, the service is unreachable) stays in the input box and the reason shows inside the panel; starting, switching or deleting a chat, picking a model, confirming a proposal and playing a result also report failures in place. Messages are capped at 2000 characters while typing.
- Music player: saving a lyric sync no longer discards the markers when it fails; the error shows inside the player, and you can undo one line and retry. Loading, alignment, word editing and LRC export errors also show in the player instead of behind it.
- Robustness: a corrupted sidebar-width record no longer blanks the app at startup; a failure inside the player, voice picker, Ocho panel, dialogs, intro or tour only affects that part; when a lazily loaded part can't be fetched, "Try again" reloads the page. Book import no longer creates duplicate chapters when you retry after a partial failure, and the create page no longer crashes when a Voxtral model is missing from the catalog.
- Smaller fixes: timeline, resource and update dialogs show their own errors; the melody score reports when it can't be checked or the staff can't render; melody preview and reply playback no longer keep playing after being stopped; durations no longer show as 0:60; the story editor keeps your page while playing; several missing translations added.
- Smaller install and faster first screen: the 1.9 MB icon source no longer ships inside the app, the music, timeline, score, book-import and onboarding pages load on demand, the assistant's avatar libraries stay out of the main bundle, and translator notes are stripped from the component language packs.

### 简体中文

- 数据更稳妥：状态库文件丢失而备份还在时自动从备份恢复，不再新建空库覆盖备份；删除素材中途退出不再误删仍在使用的音频；数据目录迁移期间的改动不再丢失，迁移失败后可继续正常保存。
- 下载更可靠：网络抖动、服务器临时出错或长时间没有数据时自动续传重试；暂停或取消后不会再误删已经下完的文件；更换下载来源后会核对是否同一文件再续传。
- 退出不再卡住：关闭时先中止正在进行的数据目录迁移，不必等复制完成；某个操作内部出错也不会让之后的操作全部无响应。
- 清理更干净：移除模型时一并删除下载和更新留下的临时文件，“清理残留”也会回收模型目录里过期的临时文件；Kokoro 发音库更新失败时保留原有版本。
- 助手更可靠：发送消息时保存失败会提示；同一提议不会被重复执行；助手进程结束前的最后几行回复不再丢失。
- 远程接口的错误统一返回 JSON 错误码并按类型区分状态码，参数错误不再报 500；命令行失败时输出错误码与参数。
- Ocho 面板：消息发送失败（过长、助手忙、服务不可用）时内容留在输入框里，原因显示在面板内；新建、切换、删除对话，选择模型，确认提案和试听结果失败也都就地提示。输入时按 2000 字上限截断。
- 音乐播放页：校准歌词保存失败时不再丢掉已标记的行，错误显示在播放页内，可撤销一行后重试；读取、对齐、逐字编辑和导出 LRC 的错误同样显示在播放页里，不再被全屏弹窗挡住。
- 稳定性：侧栏宽度记录损坏不再导致启动白屏；播放页、声音选择、Ocho 面板、各对话框、开场画面和引导出错只影响它自己；按需加载的部分取不到代码时“重试”会重新加载页面。导入小说中途失败后重试不再重复创建已入库的章节；目录里没有当前 Voxtral 模型时创作页不再崩溃。
- 其他修复：时间线、资源和更新对话框在框内显示自己的错误；旋律谱无法校验或五线谱无法渲染时给出说明；旋律试听和回复试听停止后不再继续出声；时长不再出现 0:60 这样的显示；故事配音播放中翻页不再被拉回；补齐若干缺失的翻译。
- 安装包更小、首屏更快：1.9 MB 的图标源图不再打进应用；音乐、时间线、编曲、导入书稿和开场引导页面按需加载，助手形象库不再进入主包，组件语言包去掉了给译者看的说明。

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
