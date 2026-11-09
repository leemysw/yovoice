# Changelog

各版本的重要更新记录。日常改动记入 `Unreleased`；发布前合并重复项，整理为简短的功能、改进和修复说明。

## [Unreleased]

### English

- Reference audio up to 60 seconds imports directly. Longer recordings open a section picker with the clearest part already selected; adjust it on the waveform or by typing in/out points, preview it, then save it as a voice.
- “Listen while generating” in the creation inspector plays speech as it is synthesized, when the engine supports streaming for the model. Settings › Engine › Runtime sets threads, GPU device, idle unload and model-specific session options for all models. Supported IndexTTS engines also expose the segment token limit and 2.5 text normalization.
- Export audio as FLAC (lossless, about half the size of WAV) or M4A (AAC 256 kbps) as well as WAV, from a version's “Export audio” or the timeline export. FLAC and M4A carry the title and project name; music versions also carry their lyrics and the same cover shown on the playback page. Version export can now also target audiobook, podcast or video loudness.
- YuE2 advanced settings add Top P, Top K and repetition penalty for the score-writing stage.
- The YuE2 melody score can be edited like lyrics: expand it into a large editor (also to write ABC by hand before any score exists), with a character count and validation shown while typing.
- YuE2 melody score: “From audio › Hum a tune” records a hummed or sung melody and turns it into a score (needs SheetSage2); “Style from image” asks an AI service that accepts images for style tags.
- YuE2 “Re-sing changed bars”: after editing the melody score or one section's lyrics, only the changed bars are re-sung and placed into the original version; everything outside them stays sample-for-sample the same.
- YuE2 can make up to 4 candidate takes in one go (advanced settings), each with the next seed; every take records the seed it used.
- “Export all stems” saves the mix and every stem into a new folder with DAW-friendly names such as `Song - 01 Vocals.wav`.
- FLAC and M4A exports with tags now also note in the comment tag that the audio is AI-generated and which model made it.
- YuE2 LoRA: import a `.safetensors` LoRA under advanced settings and apply it to the composition and/or timbre stage with its own strength.
- “Separate stems” on a music version (optional HTDemucs 6-stem model, 42 MB) splits it into drums, bass, vocals, guitar, piano and other, each saved as a version you can play, export or add to the timeline.
- “Transcribe to MIDI” on a music version (optional MuScriptor model, 412 MB, non-commercial) creates a score project with one track per instrument.
- Kokoro now has a speaking-rate control and passes it to the inference engine.
- Import existing local audio.cpp GGUF models and supported SF2 sound fonts from model settings (the folder button next to Download), without copying files or changing the download directory. Imported files are preserved when removing the model; PyTorch/MLX weights need conversion first.
- Feature tour cards now stay inside the window, keeping Next and Done clickable with longer translations and smaller windows.
- Speech recognition and subtitles with the optional Qwen3 ASR 0.6B model (Voice models, about 2.3 GB including its timing aligner; supports 30 languages, needs inference engine v0.9.1 or later):
  - “Recognize text” under a reference transcript field or in the voice editor fills in what the sample says; a sample with no transcript keeps the result.
  - New Transcribe page: upload audio or video (up to 1 hour, 20 MB) to get the text split into timed subtitle lines, then export SRT / WebVTT or copy the full text.
  - “Export subtitles” on a speech version aligns its text to the audio and saves SRT / WebVTT split by sentence; the timing is kept with the version. The lyric aligner package also works for this.
- Safer data: when the state database is missing but a backup exists, yovoice restores from the backup instead of creating an empty database that overwrites it; quitting midway through deleting media no longer removes audio still in use; edits made while the data folder is being moved are no longer lost, and saving keeps working after a failed move.
- More reliable downloads: transient network errors, server hiccups and stalls resume and retry automatically; pausing or cancelling no longer deletes a fully downloaded file; after switching the download source, the file is checked to be the same one before resuming.
- Quitting no longer hangs: an in-progress data folder move is stopped first instead of waiting for the copy to finish, and an internal error in one operation no longer makes every later operation unresponsive.
- Cleaner cleanup: removing a model also deletes the temporary files left by downloads and updates, and “Clean residuals” reclaims expired temporary files in the models folder; a failed Kokoro pronunciation library update keeps the existing version.
- More reliable assistant: when sending a message fails to save, an error is shown instead of it silently disappearing; the same proposal is never executed twice; the last lines of a reply are no longer lost when the assistant process exits.
- Remote API errors now return a JSON error code with a status code matched to the error type (bad parameters no longer return 500); the CLI prints the error code and parameters on failure.
- Ocho panel: a message that fails to send (too long, the assistant is busy, the service is unreachable) stays in the input box and the reason shows inside the panel; starting, switching or deleting a chat, picking a model, confirming a proposal and playing a result also report failures in place. Messages are capped at 2000 characters while typing.
- Music player: saving a lyric sync no longer discards the markers when it fails; the error shows inside the player, and you can undo one line and retry. Loading, alignment, word editing and LRC export errors also show in the player instead of behind it.
- Better stem separation: with the optional BS-RoFormer model (173 MB, also inside the Lyric Aligner package), vocals are separated by BS-RoFormer and HTDemucs splits only the accompaniment, for cleaner vocals and less bleed. “Other” now keeps everything the other stems miss, so the six stems add back exactly to the original.
- Settings read more cleanly: shorter descriptions, no repeated precision note on every model, and import instructions moved into the import button tooltip. The right-panel toggle in the title bar hides while the stem studio is open.
- Roll a model back: models replaced by a catalog update get a version picker in Settings. “Before 2026-10-27 update” re-downloads the earlier file from its pinned commit and stops the update prompt; “Latest” switches back.
- Sidebar: Transcribe now sits right under Text to speech; the Chinese label for the voice library is now 我的声音.
- “Transcribe to MIDI” gives each track a role from its instrument: the vocal melody and synth leads play as the lead, 3 dB above the accompaniment, instead of sitting at the same level and getting lost under guitar and bass; bass, piano, strings and pads get their matching roles too.
- Stem studio: after “Separate stems” or “Transcribe to MIDI” finishes, a full-screen multitrack page opens with the original and every stem (or every MIDI instrument, rendered with your sound font) side by side — one transport and playhead, a waveform per track, volume, mute and solo, click to seek, Space to play. Reopen it from “Open stems” in the version menu or “Preview tracks” on a score project; “Export all stems” moved inside it.
- Lighter when idle: Ocho's avatar and the launcher glow only animate while the assistant works, on hover or for an occasional glance, and stop when the window is in the background, so the idle app no longer keeps a CPU core busy; the assistant panel and the Transcribe page load on demand.
- Smoother layout changes: collapsing the sidebar or side panel moves the workspace edge instead of jumping, the Generate button travels between the side panel and the title row, the sidebar highlight slides to the new page, a project opened from the list carries its title into the editor, and collapsible sections expand smoothly. Dialogs resize smoothly when their content changes, the generation progress row unfolds instead of pushing the panel down, the melody score grows open, and notices drop in and slide away.
- Settings › Features can now hide the Transcribe page as well; if the page you were on gets hidden, yovoice returns to speech generation.
- Drag the left edge of the right-hand settings panel to widen it (remembered between sessions); option labels that are cut off, such as the IndexTTS expression modes, show the full text on hover.
- macOS: when the window content fails to load (the local page can't be reached, is refused, or its web process keeps crashing), yovoice now shows the reason with Retry and Open Logs Folder instead of a blank white window, and records it with the macOS version in `logs/host.log`.
- Robustness: a corrupted sidebar-width record no longer blanks the app at startup; a failure inside the player, voice picker, Ocho panel, dialogs, intro or tour only affects that part; when a lazily loaded part can't be fetched, "Try again" reloads the page. Book import no longer creates duplicate chapters when you retry after a partial failure, and the create page no longer crashes when a Voxtral model is missing from the catalog.
- Smaller fixes: timeline, resource and update dialogs show their own errors; the melody score reports when it can't be checked or the staff can't render; melody preview and reply playback no longer keep playing after being stopped; durations no longer show as 0:60; the story editor keeps your page while playing; several missing translations added.
- Smaller install and faster first screen: the 1.9 MB icon source no longer ships inside the app, the music, timeline, score, book-import and onboarding pages load on demand, the assistant's avatar libraries stay out of the main bundle, and translator notes are stripped from the component language packs.

### 简体中文

- 60 秒以内的参考音频直接导入；更长的录音先选段，已预先选中最清楚的一段，可在波形上调整或输入入点、出点，试听后保存为音色。
- 引擎支持流式输出时，创作面板可“边生成边试听”；“设置 › 推理引擎 › 运行参数”可为所有模型设置线程、GPU 设备、空闲卸载时间和模型专属会话参数。引擎支持时还可设置 IndexTTS 每段 Token 上限，并切换 2.5 的文本规范化。
- 导出音频除 WAV 外新增 FLAC（无损，体积约为 WAV 的一半）和 M4A（AAC 256 kbps），版本的“导出音频”和时间线导出都能选；FLAC 与 M4A 写入标题和作品名，音乐版本还写入歌词和播放页同款封面。版本导出也能选有声书、播客或视频平台的目标响度。
- YuE2 高级参数新增写谱阶段的 Top P、Top K 和重复惩罚。
- YuE2 旋律谱可以像歌词一样放大编辑：没有谱时也能直接手写 ABC，编辑时显示字数和谱面校验结果。
- YuE2 旋律谱“从音频提取”新增“哼一段”：录下哼唱或清唱，扒成旋律谱（需要 SheetSage2）；风格栏新增“看图取风格”：请支持看图的 AI 服务读出风格标签。
- YuE2 新增“按当前谱局部重唱”：改了旋律谱或某段歌词后，只重唱改动的小节并换进原版本，其余部分逐采样不变。
- YuE2 高级设置可以一次生成最多 4 个候选，每版换下一个种子，并记下实际用的种子。
- 新增“导出全部分轨”：把原混音和各轨存进新建的文件夹，按 DAW 习惯命名（如 `歌名 - 01 Vocals.wav`）。
- 带标签导出 FLAC / M4A 时，注释标签里注明为 AI 生成及所用模型。
- YuE2 支持 LoRA：在高级设置里导入 `.safetensors` LoRA，分别用于作曲和音色阶段并调节强度。
- 音乐版本新增“分离音轨”（可选 HTDemucs 6 轨模型，42 MB）：分成鼓、贝斯、人声、吉他、钢琴和其他六轨，每轨存成版本，可试听、导出或加到时间线。
- 音乐版本新增“转为 MIDI”（可选 MuScriptor 模型，412 MB，仅限非商业用途）：新建编曲作品，每种乐器一轨。
- Kokoro 新增语速调节，并将所选语速传入推理引擎。
- 模型设置新增本地导入（“下载”旁的文件夹按钮），原地使用已有 audio.cpp GGUF 模型及受支持的 SF2 音色库，无需复制或更改下载目录；移除导入模型时保留源文件。PyTorch／MLX 原始权重须先转换。
- 功能引导卡片按实际大小限制在窗口内，较长的翻译和较小的窗口也能点击“下一步”和“开始使用”。
- 可选语音识别模型 Qwen3 ASR 0.6B（设置的语音模型里下载，含时间对齐模型约 2.3 GB；支持 30 种语言，需要推理引擎 v0.9.1 及以上）：
  - 在参考原文框下或编辑音色信息时点“识别文字”，把样本里说的话填进去；样本原来没有原文时会一并保存。
  - 新增“语音转写”页：上传音频或视频（最长 1 小时、20 MB），得到按句分行、带时间的字幕，可导出 SRT / WebVTT 或复制全文。
  - 语音版本的“导出字幕”：把正文对齐到音频，按句导出 SRT / WebVTT，时间保存在版本上；装了歌词对齐模型也能用。
- 数据更稳妥：状态库文件丢失而备份还在时自动从备份恢复，不再新建空库覆盖备份；删除素材中途退出不再误删仍在使用的音频；数据目录迁移期间的改动不再丢失，迁移失败后可继续正常保存。
- 下载更可靠：网络抖动、服务器临时出错或长时间没有数据时自动续传重试；暂停或取消后不会再误删已经下完的文件；更换下载来源后会核对是否同一文件再续传。
- 退出不再卡住：关闭时先中止正在进行的数据目录迁移，不必等复制完成；某个操作内部出错也不会让之后的操作全部无响应。
- 清理更干净：移除模型时一并删除下载和更新留下的临时文件，“清理残留”也会回收模型目录里过期的临时文件；Kokoro 发音库更新失败时保留原有版本。
- 助手更可靠：发送消息时保存失败会提示；同一提议不会被重复执行；助手进程结束前的最后几行回复不再丢失。
- 远程接口的错误统一返回 JSON 错误码并按类型区分状态码，参数错误不再报 500；命令行失败时输出错误码与参数。
- Ocho 面板：消息发送失败（过长、助手忙、服务不可用）时内容留在输入框里，原因显示在面板内；新建、切换、删除对话，选择模型，确认提案和试听结果失败也都就地提示。输入时按 2000 字上限截断。
- 音乐播放页：校准歌词保存失败时不再丢掉已标记的行，错误显示在播放页内，可撤销一行后重试；读取、对齐、逐字编辑和导出 LRC 的错误同样显示在播放页里，不再被全屏弹窗挡住。
- 分轨更准、更完整：装有可选的 BS-RoFormer（173 MB，歌词对齐包里也带）时先用它分出人声，HTDemucs 只拆伴奏，人声更干净、不串轨；“其他”轨收下其余各轨没分走的部分，六轨相加即还原原曲。
- 设置页更简洁：说明文字精简，每个模型下不再重复精度说明，导入说明收进导入按钮的提示；分轨工作台打开时隐藏标题栏的右侧面板开关。
- 模型可以回退：经目录更新替换过的模型在设置里多一个版本选择，选“2026/10/27 更新前”按当时的提交重新下载旧文件，并不再提示更新；选回“最新版”即恢复。
- 侧栏：语音转写移到语音生成下方；“声音库”改名为“我的声音”。
- “转为 MIDI”按乐器给各轨定角色：人声旋律和合成主音作为主旋律，比伴奏高 3 dB，不再和伴奏同一电平、被吉他和贝斯盖住；贝斯、钢琴、弦乐和铺底也各归其位。
- 分轨工作台：“分离音轨”或“转为 MIDI”完成后打开全屏多轨页，原曲与各分轨（或用音色库逐轨渲染的 MIDI 各乐器）并排，统一播放和播放头，每轨有波形、音量、静音、独奏，点击定位、空格播放；之后可从版本菜单“打开分轨”或编曲页“分轨试听”进入，“导出全部分轨”移到工作台里。
- 空闲更省资源：Ocho 形象和入口流光只在助手工作、悬停或偶尔张望时动，窗口在后台时停下，空闲时不再持续占用 CPU；助手浮窗和语音转写页按需加载。
- 界面变化更连贯：收起展开侧栏或右侧面板时工作区边缘平滑移动，“生成”按钮在面板顶部与标题栏之间迁移；侧栏选中块滑到新页面；从列表打开作品时标题飞入编辑页；折叠区平滑展开。弹窗内容变化时尺寸平滑过渡，生成进度行展开而不是把面板顶下去，旋律谱出谱时平滑展开，提示条落下出现、上滑离开。Linux 桌面版暂不使用视图过渡动画（WebKitGTK 执行时会使应用崩溃），界面直接切换。
- 设置 › 功能显示 新增“语音转写”，可隐藏转写页入口；所在页面被隐藏时自动回到语音生成。
- 右侧设置面板可拖动左边缘调宽（宽度会记住）；被截断的选项（如 IndexTTS 的表达方式）悬停时显示完整文字。
- macOS：窗口内容未能加载（本地页面连不上、被拒绝或网页进程反复崩溃）时，不再停在全白窗口，而是提示原因并提供“重试”和“打开日志目录”，同时把原因和系统版本记入 `logs/host.log`。
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
