# 转写、分轨与转 MIDI

这三个命令处理本机已有的音频或视频，输入支持 WAV、MP3、M4A/AAC、FLAC、OGG/Opus、AIFF、WMA、WebM、MOV 等常见格式，格式自动转换。和 `generate` 一样阻塞到完成，进度在 stderr，结果 JSON 在 stdout，不覆盖已有文件。先用 `yovoice models list --json` 确认对应模型已安装，没有时先下载。

| 命令 | 需要的模型 | 输入上限 |
| --- | --- | --- |
| `transcribe` | `qwen3-asr-0.6b-q8`（约 2.3 GB） | 默认 4 GB、60 分钟，可在 App“设置 › 常规 › 语音转写”调整 |
| `separate` | `htdemucs-6stems-q8`（42 MB）；另装 `bs-roformer-q8`（173 MB）时人声更干净 | 10 分钟 |
| `to-midi` | `muscriptor-small-f32`（412 MB） | 10 分钟 |

## 语音转写为字幕

```sh
yovoice models download qwen3-asr-0.6b-q8
yovoice transcribe interview.mp4 --output interview.srt --json
```

- 输出扩展名决定格式：`.srt`、`.vtt`、`.txt`（每行一句），`.json`（原文 `text`、逐词时间 `words`、字幕行 `captions`）。
- 断句沿用 App 的转写设置（每行字数、每行时长、停顿换行）。结果 JSON 带 `text`（整段原文）、`language`、`lines`、`duration`。
- 转写同时保存为一份转写记录，用户可以在 App 的“语音转写”里继续编辑、试听和导出；结果 JSON 的 `id` 就是这份记录。
- 识别结果可能有错字或断句不准，交付时提醒用户校对，不宣称逐字准确。

## 分成六轨

```sh
yovoice models download htdemucs-6stems-q8
yovoice separate song.mp3 --output-dir stems --json
```

在 `--output-dir` 下新建“<文件名> Stems”文件夹，写入 `00 Mix`、`01 Vocals`、`02 Drums`、`03 Bass`、`04 Guitar`、`05 Piano`、`06 Other` 七个同长度 WAV，直接拖进 DAW 即对齐。各轨相加即原曲：没归到任何一轨的声音都在 Other 里。结果 JSON 的 `folder` 是文件夹，`files` 列出各个文件。

## 转为 MIDI 或乐谱

```sh
yovoice models download muscriptor-small-f32
yovoice to-midi song.mp3 --output song.mid --json
yovoice to-midi song.mp3 --output song.json --json
```

`.mid` 是多乐器 MIDI（含鼓）；`.json` 是编曲乐谱，可以按[编曲参考](score.md)修改，再用 `yovoice score render` 渲染。扒出的音符是近似结果，复杂编配会有遗漏或错音。
