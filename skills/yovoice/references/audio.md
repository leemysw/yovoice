# 参考音频

CLI 与 App 共用后端导入和转换逻辑。接受 WAV、MP3、M4A/AAC、FLAC、OGG/Opus、AIFF、WMA、WebM 音频。编码损坏、加密或不包含音轨的文件会报错。

- 输入为本地文件，最大 20 MB，时长 1–60 秒。
- 兼容的 PCM/Float WAV 直接使用；其他音频在内部转为单声道、24 kHz、16 位 PCM WAV。
- 超过 60 秒会拒绝导入，不静默截断；需先裁剪用户选定的片段。
- 原文件保持不变，音色库保存 WAV 副本，名称默认取原文件名。
- 转换器随安装包集成，首次转换也无需联网，见[准备文档](setup.md#音频转换器)。

直接生成：

```sh
yovoice generate --text-file narration.txt --reference voice.mp3 --output narration.wav --json
```

登记音色后复用：

```sh
yovoice voices import voice.m4a --name 旁白音色
yovoice voices list --json
yovoice generate --text-file narration.txt --voice <实际音色ID> --output narration.wav --json
```

选择清晰、单人、少混响的声音片段，避免背景音乐。文件格式兼容不代表音色克隆效果已验证；没有试听时只报告生成完成。输出仍为 WAV。
