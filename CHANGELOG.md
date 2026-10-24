# Changelog

各版本的重要更新记录。日常改动记入 `Unreleased`；发布前合并重复项，整理为简短的功能、改进和修复说明。

## [Unreleased]

- 设置“资源”页精简表格：去掉“所属作品”列，打开作品、打开所在位置和删除收进每行的“更多”菜单，表格在窗口内一屏放下；窄窗口下也可以左右滚动。
- 生成完成后自动体检音频：发现爆音、咔哒声、结尾截断、长静音、几乎无声或音量过小时，在播放栏和故事配音的对应句子旁显示提醒，悬停可看问题和时间位置。
- 导出时可选目标响度：有声书 -18、播客 -16、视频平台 -14 LUFS，只整体调整音量，峰值不超过 -1 dBTP。
- 参考音频支持最长 10 分钟的录音：超过 60 秒时自动截取人声最清楚的 5–15 秒；裁剪时也可点“自动挑选”。
- Ocho 交付前会检查生成的音频，故事配音只重新生成有问题的句子。
- 背景音乐压低更自然：说话前提前让位，句间短停顿不再忽高忽低，说完后平滑恢复。
- Ocho 面板选中 ChatGPT 订阅时直接说明助手用不了，并可就地切回接口类服务，不再等发送后才报错。
- 修复 Windows 上点击生成后界面可能毫无反应（推理已完成、音频已保存）：状态推送中断时界面改为定时拉取，生成进度和新版本照常显示，并记录诊断日志。

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
