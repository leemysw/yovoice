# 第三方组件

- Astryx 0.6.1：https://astryx.atmeta.com/ ，保留 npm 包中的许可。
- audio.cpp v0.7.4：https://github.com/0xShug0/audio.cpp ，Apache-2.0，Copyright 2026 ShugoAI LLC。macOS 包内置 Metal 服务，Windows 包内置 CPU 服务及 DLL；原始 LICENSE 随 engine 目录分发；其他运行包从官方发行页下载并保留许可。
- IndexTTS：https://github.com/index-tts/index-tts ，模型不随应用分发。中文模型协议原文保存在 web/public/model-license.txt，下载和使用模型须遵守该协议。
- React、Vite、TypeScript、Lucide、StyleX、WebView2 的许可与版权声明以对应依赖包为准。

- FFmpeg 8.1.2：https://ffmpeg.org/ ，LGPL-2.1-or-later。构建时从校验摘要的官方源码裁剪，只保留音频解码与 WAV 输出，作为独立可执行程序随 App/CLI 分发。许可证与构建参数位于安装包 `tools/FFmpeg-LICENSE.txt`、`tools/build.json`（macOS App 为 `Contents/Resources/tools/`）；对应源码与构建脚本随 Release 的 `yovoice-<版本>-ffmpeg-source.tar.gz` 提供。
