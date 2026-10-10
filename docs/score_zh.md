# 编曲

[English](score.md)

“编曲”作品把配乐写成乐谱：每个声部是一种乐器，音符按小节和拍记录。yovoice 用 General MIDI 音色库逐个声部渲染，按角色对齐响度后混音。和“音乐生成”不同，编曲不经过 AI 推理：同一份乐谱每次渲染的结果相同，改一个音、换一种乐器或调一个声部的电平都可以精确控制。

适合的用法：

- 让 Agent（Claude、Codex 等）按视频的段落和时长写出垫底配乐，再在 yovoice 里试听、调整、导出。
- 导入现成的 MIDI，换音色、调电平后渲染为 WAV。
- 把乐谱导出为 MIDI，交给 DAW 继续制作。

## 准备音色库

渲染需要 MuseScore General 音色库（`musescore-general-sf2`，SF2，约 216 MB），包含 128 种 GM 乐器和鼓组。在“设置 › 模型”中下载，或运行：

```sh
yovoice models download musescore-general-sf2
```

编曲不需要推理内核，也不占用显卡。

## 在桌面端编曲

1. 新建作品 › 编曲。空白作品可以“填入示例”，或“导入 MIDI 或乐谱”（`.mid`、`.midi`、`.json`）。
2. 音块总览按段落着色，横向是时间（段落变速会按实际时长换算），每行一个声部。点选一行可在声部表中定位。
3. 声部表调整音色（GM 音色号）、角色、目标电平，或关闭某个声部的发声。
4. 右侧可修改速度、拍号和调性，并显示每个段落的起止时间，方便与口播稿对齐。
5. “渲染配乐”生成混音 WAV，保留为作品版本，可试听和导出。
6. “导出”可保存为 MIDI 或乐谱 JSON；“复制 Agent 提示词”会复制一段说明乐谱格式的提示词，交给 Agent 写谱。

## 乐谱格式

```json
{
  "tempo": 100,
  "timeSignature": [4, 4],
  "key": "D 小调",
  "sections": [
    { "name": "前奏", "start": 1, "end": 6 },
    { "name": "展开", "start": 7, "end": 18 },
    { "name": "回落", "start": 19, "end": 22, "tempo": 88 }
  ],
  "tracks": [
    {
      "id": "violin", "name": "小提琴", "role": "melody", "program": 40,
      "reverb": 0.35, "pan": 0.2,
      "humanize": { "velocity": 6, "timingMs": 4 },
      "dynamics": [{ "start": 7, "end": 9, "from": 0.35, "to": 1 }],
      "notes": [{ "bar": 7, "beat": 1, "pitch": 69, "length": 2, "velocity": 84 }]
    },
    {
      "id": "drums", "name": "鼓", "role": "drums", "program": 0, "drums": true,
      "notes": [{ "bar": 7, "beat": 1, "pitch": 36, "length": 0.25, "velocity": 100 }]
    }
  ]
}
```

| 字段 | 说明 |
| --- | --- |
| `tempo` | 全曲速度，30–300 BPM。 |
| `timeSignature` | 拍号，如 `[4, 4]`、`[3, 4]`、`[6, 8]`。拍以四分音符计，6/8 每小节 3 拍。 |
| `key` | 调性，仅作说明，最多 40 字。 |
| `sections` | 可选段落：名称、起止小节（含）和可选的段落速度，用于变速和对齐画面。 |
| `tracks[].program` | General MIDI 音色号 0–127，如 0 钢琴、40 小提琴、42 大提琴、48 弦乐合奏、89 暖音铺底。 |
| `tracks[].drums` | 鼓组声部，走第 10 通道，音高对应鼓件：36 底鼓、38 军鼓、37 边击、42 闭镲、46 开镲、49 吊镲。 |
| `tracks[].role` | `melody`、`piano`、`strings`、`bass`、`drums`、`pad`、`arp`、`other`，决定默认目标电平。 |
| `tracks[].level` | 目标电平（dBFS，按有声部分的 RMS 计），-60 到 0；省略时按角色取值。 |
| `tracks[].pan` / `reverb` | 声像 -1（左）到 1（右）；混响发送量 0–1。 |
| `tracks[].humanize` | 力度随机幅度（0–40）和时值偏移（0–50 毫秒），按种子固定，每次渲染相同。 |
| `tracks[].dynamics` | 渐强渐弱：在起止小节间把表情控制从 `from` 渐变到 `to`（0–1）。 |
| `tracks[].mute` | 关闭该声部发声，乐谱仍保留。 |
| `notes[]` | `bar`、`beat` 从 1 开始，`beat` 可带小数（1.5 为第一拍后半拍）；`pitch` 为 MIDI 音高（60 = C4）；`length` 以拍计；`velocity` 1–127。 |

上限：512 小节、32 个声部、20000 个音符、10 分钟。

### 混音约定

每个声部单独渲染后按目标电平对齐，再叠加混音，最后把峰值限制在 -1 dBFS，结尾留 2 秒混响尾音。默认电平让主奏在前、铺底和琶音退后：

| 角色 | 默认电平 |
| --- | --- |
| melody、piano | -21 dBFS |
| strings | -23 dBFS |
| other | -24 dBFS |
| bass、drums | -25 dBFS |
| pad、arp | -29 dBFS |

作为口播配乐时，通常还要在时间线上再整体压低。

## 命令行与 Agent

```sh
yovoice score render score.json --output music.wav --stems stems/
yovoice score midi score.json --output score.mid
yovoice score from-midi song.mid --output score.json
```

- `render` 读取乐谱 JSON 或 MIDI，输出混音 WAV；`--stems DIR` 同时写出每个声部对齐电平后的分轨（`01-钢琴.wav` 等）。`--soundfont ID` 可指定其他已安装的音色库。
- `midi` / `from-midi` 在乐谱 JSON 与标准 MIDI 之间转换，不需要音色库。
- 输出文件不覆盖已有文件。成功时 stdout 输出 JSON：`{"path": "...", "duration": 54.9, "bars": 22, "tracks": 7, "stems": "..."}`。

远程服务的 MCP 提供 `render_score` 工具，参数为 `title` 和 `score`，返回 `id`、`duration` 和 `downloadPath`，见 [API 文档](api_zh.md)。

从 MIDI 导入时，每个“轨道 × 通道”成为一个声部；速度取第一个速度事件，拍号取开头的拍号，第 10 通道识别为鼓组。导入后的声部角色为 `other`，可按需修改。

## 限制

- 音色来自 SF2 音色库，适合垫底配乐、示意小样；不提供合成器插件（VST）或真实乐器采样库的质感。
- 桌面端暂不支持在音块总览里直接画音符，编辑音符请导入乐谱或 MIDI。
- 混响为简单的发送效果，未提供均衡、压缩等效果器。
