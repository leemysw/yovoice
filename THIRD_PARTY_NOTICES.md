# 第三方组件

- Astryx 0.6.1：https://astryx.atmeta.com/ ，保留 npm 包中的许可。
- audio.cpp v0.7.4：https://github.com/0xShug0/audio.cpp ，Apache-2.0，Copyright 2026 ShugoAI LLC。macOS 包内置 Metal 服务，Windows 包内置 CPU 服务及 DLL；原始 LICENSE 随 engine 目录分发；其他运行包从官方发行页下载并保留许可。
- IndexTTS：https://github.com/index-tts/index-tts ，模型不随应用分发。中文模型协议原文保存在 web/public/model-license.txt，下载和使用模型须遵守该协议。
- React、Vite、TypeScript、Lucide、StyleX、WebView2 的许可与版权声明以对应依赖包为准。

- FFmpeg 8.1.2：https://ffmpeg.org/ ，LGPL-2.1-or-later。构建时从校验摘要的官方源码裁剪，只保留音频解码与 WAV 输出，作为独立可执行程序随 App/CLI 分发。许可证与构建参数位于安装包 `tools/FFmpeg-LICENSE.txt`、`tools/build.json`（macOS App 为 `Contents/Resources/tools/`）；对应源码与构建脚本随 Release 的 `yovoice-<版本>-ffmpeg-source.tar.gz` 提供。

- VoxCPM2：https://github.com/OpenBMB/VoxCPM ，模型不随应用分发，使用 Apache-2.0 许可：https://github.com/OpenBMB/VoxCPM/blob/main/LICENSE 。

## OmniVoice and Qwen3-TTS

- [OmniVoice](https://huggingface.co/k2-fsa/OmniVoice): code Apache-2.0, pretrained weights CC-BY-NC (non-commercial), as stated by the model author.
- [Qwen3-TTS 12Hz 1.7B Base](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base): Apache-2.0.
- Weights are downloaded separately from audio.cpp GGUF repositories and are not included in yovoice installers.

## Kokoro 与发音资源

- [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) 和 [Kokoro-82M-v1.1-zh](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh)：Apache-2.0，模型单独导入，不随应用安装包分发。
- [eSpeak-ng 1.52.0](https://github.com/espeak-ng/espeak-ng/tree/4870adfa25b1a32b4361592f1be8a40337c58d6c)：GPL-3.0-or-later。原生库来自 espeakng-loader 0.2.4，许可证位于 `tools/kokoro/espeak-ng-COPYING.txt`。完整对应源码见[固定版本源码](https://github.com/espeak-ng/espeak-ng/archive/4870adfa25b1a32b4361592f1be8a40337c58d6c.tar.gz)，构建方法见[上游构建脚本](https://github.com/thewh1teagle/espeakng-loader/blob/e5e9200dc3fd894b7415942c2602fc31526d60fc/build.sh)。由独立 audio.cpp 进程加载，Go 服务不链接该库。
- [MeCab](https://taku910.github.io/mecab/)：BSD / LGPL / GPL 多许可，按 BSD 条款分发；原生库来自 fugashi 1.5.2，`LICENSE.mecab` 与 fugashi 的许可随库保留。
- [Misaki](https://github.com/hexgrad/misaki)：Apache-2.0；[jieba](https://github.com/fxsjy/jieba) 和 [pypinyin](https://github.com/mozillazg/python-pinyin)：MIT。模型中的字词发音映射由这些组件生成，对应许可内嵌在模型资源中。
- [UniDic 3.1.0](https://github.com/polm/unidic-py)：日文词典与许可内嵌在 v1.0 多语言模型包中。详情和原生前端差异见 [Kokoro 文档](docs/kokoro.md)。
