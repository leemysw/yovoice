# 编曲参考

用户要配乐、垫底音乐、按段落写曲子或把 MIDI 渲染成音频时，写一份乐谱 JSON 再用 CLI 渲染。编曲不经过推理引擎，结果可重复；需要歌声或整首流行歌曲时说明这里做不到，建议桌面端的“音乐生成”。

## 准备

```sh
yovoice models download musescore-general-sf2
```

## 写谱

```json
{
  "tempo": 100, "timeSignature": [4, 4], "key": "D minor",
  "sections": [{ "name": "Intro", "start": 1, "end": 6 }, { "name": "Outro", "start": 19, "end": 22, "tempo": 88 }],
  "tracks": [
    { "id": "pad", "name": "Pad", "role": "pad", "program": 89, "reverb": 0.5,
      "notes": [{ "bar": 1, "beat": 1, "pitch": 62, "length": 4, "velocity": 64 }] },
    { "id": "drums", "name": "Drums", "role": "drums", "program": 0, "drums": true,
      "notes": [{ "bar": 7, "beat": 1, "pitch": 36, "length": 0.25, "velocity": 100 }] }
  ]
}
```

- `bar`、`beat` 从 1 开始，`beat` 可为小数；拍以四分音符计（6/8 每小节 3 拍）；`length` 以拍计；`pitch` 为 MIDI 音高（60 = C4）；`velocity` 1–127。
- `program` 为 General MIDI 音色号：0 钢琴、40 小提琴、41 中提琴、42 大提琴、48 弦乐合奏、89 暖音铺底、81 锯齿波。鼓组设 `drums: true`：36 底鼓、38 军鼓、37 边击、42 闭镲、46 开镲、49 吊镲。
- `role`（melody、piano、strings、bass、drums、pad、arp、other）决定默认电平，主奏 -21 dBFS，铺底和琶音 -29 dBFS；`level` 可覆盖（-60 到 0）。
- 可选：`pan`（-1 到 1）、`reverb`（0–1）、`humanize: { velocity, timingMs }`、`dynamics: [{ start, end, from, to }]`（0–1 的渐强渐弱）、`mute`。
- 上限 512 小节、32 声部、20000 音符、10 分钟。按用户给出的时长换算小节数：秒数 = 小节数 × 每小节拍数 × 60 ÷ BPM。
- 每个声部只写一种乐器；先定和声进行，再写低音、铺底、旋律和节奏，段落之间用声部进出和力度做起伏。

## 渲染

```sh
yovoice score render score.json --output music.wav --stems stems/
```

stdout 输出 `{"path","duration","bars","tracks","stems"}`。乐谱错误返回 `scoreInvalid`，按上面的范围修正后重试。也可 `yovoice score midi score.json --output score.mid` 导出 MIDI，或 `yovoice score from-midi song.mid --output score.json` 把用户的 MIDI 转成乐谱再修改。远程服务使用 MCP 工具 `render_score`，参数为 `title` 与 `score`。

没有实际试听时，不宣称编曲效果或混音已经验证。
