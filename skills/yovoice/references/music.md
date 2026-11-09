# 写歌与音效

音乐模型与语音共用 `generate`：`--text`（或 `--text-file`）是风格描述，不是唱词；歌词用 `--lyrics` 或 `--lyrics-file`，长歌词写进 UTF-8 文件。先用 `yovoice models list --json` 确认已安装的模型和它的 `generationOptions`。

## 选模型

| 需要 | 模型 | 说明 |
| --- | --- | --- |
| 完整的歌、旋律可改 | `yue2-3b-*` | 先写旋律谱再演唱；歌词长度决定歌曲长度；非纯音乐必须有歌词 |
| 快速出一首歌或纯音乐 | `ace-step-1.5-*` | `--option 'duration_seconds=60'` 定时长（0 交给模型），`--language zh` 指定演唱语言 |
| 短配乐、氛围、Loop | `stable-audio-3-small-music-*`、`stable-audio-3-medium-*` | 没有人声，`--option 'duration_seconds=30'` |
| 音效 | `stable-audio-3-small-sfx-*` | 1–30 秒，`--text` 用英文写声源、动作、材质和空间 |

```sh
yovoice generate --model yue2-3b-q8 --text-file style.txt --lyrics-file song.txt --output song.wav --json
yovoice generate --model ace-step-1.5-turbo-q8 --text "city pop, warm synths, female vocals" --lyrics-file song.txt --language zh --output song.wav
yovoice generate --model stable-audio-3-small-sfx-q8 --text "a heavy wooden door closing in a small tiled hallway, close microphone" --option 'duration_seconds=4' --output door.wav
```

`--instrumental` 生成纯音乐；YuE2 纯音乐可只写 `[Intro]`、`[Verse]` 等段落标记。一首歌通常要几分钟，首次加载模型更久，不要因为慢重复启动。

## 写风格与歌词

- 风格用英文逗号分隔：语言、流派、人声、主要乐器、情绪、制作感，末尾写速度，如 `96 BPM`。ACE-Step 不超过 512 字；YuE2 可到 2000 字，可以按时间顺序描述这首歌怎么展开：前奏用什么开场、人声何时进入、副歌如何加厚、间奏交给谁、怎么结束。
- 也可以只写一两个词（`funk`、`ballad, Blues`），让模型自己编配；用 `No instruments`、`no guitars` 排除不要的声音。
- 歌词用段落标记分段：`[Verse 1]`、`[Pre-Chorus]`、`[Chorus]`、`[Bridge]`、`[Outro]`；标记里可写角色或编配，如 `[Chorus – both voices together]`、`[Instrumental Break: Piano & Flute]`（器乐段不写词）。不要把舞台说明、音效描述写成唱词。
- 中文歌词每行长度大致相当，副歌更短、更好唱；避免满篇套用的意象，写具体的人、地方和动作。
- 不必每首都用主歌—副歌—主歌的套路：可以开口即唱、两段主歌再进副歌、副歌后加器乐间奏或 Breakdown。用户给的方向越开放，越可以尝试不同的结构和速度。

## YuE2 的旋律谱

YuE2 先写一份 ABC 旋律谱，再按谱演唱；旋律、和弦、速度和段落都在谱里，风格决定乐器、嗓音和制作。结果 JSON 的 `abc` 是这次所用的谱，`seed` 是实际种子。

- 换一首不同的旋律：不指定 `--seed` 重新生成，每次会写新谱。
- 保留旋律、改风格或歌词：把 `abc` 存成文件，用 `--abc-file` 传回，并改 `--text`。
- 只改一段：编辑谱里对应的小节（音符、和弦、`Q:` 速度、`K:` 调号）后用 `--abc-file` 和上一版的 `--seed` 生成；没改的部分基本保持。主题重复时让音程、节奏或音区有变化，副歌可以把主歌的动机提高八度、拉长尾音。
- 不要谱、直接唱：`--option 'cot="off"'`，结果不带可编辑的谱。
- YuE2 自己写的谱只用 4/4 或 2/4，三拍子等节拍要手改谱。谱面写错时命令返回出错的小节和声部，修正后再生成。

同一组输入每次生成都会不同，可以多生成几版让用户挑；一次只改一处，保留上一版对照。没有实际试听，不要宣称效果达标，把改了什么告诉用户，请他们听。
