<p align="center">
  <img src="web/public/icon/voice-workbench-app-icon-v1.png" width="96" alt="yovoice" />
</p>
<h1 align="center">yovoice</h1>
<p align="center">让文字拥有你的声音。</p>
<p align="center">
  <a href="web/package.json"><img src="https://img.shields.io/badge/version-0.1.0-blue?style=flat-square" alt="Version 0.1.0" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-orange?style=flat-square" alt="License: Apache-2.0" /></a>
  <img src="https://img.shields.io/badge/macOS-14%2B-black?style=flat-square" alt="macOS 14+ (Apple Silicon)" />
  <img src="https://img.shields.io/badge/Windows-10%2F11-0078D4?style=flat-square" alt="Windows 10/11 (x64)" />
</p>
<p align="center"><a href="README.md">English</a> · 简体中文</p>

---

yovoice 是一款适用于 macOS 和 Windows 的开源声音创作工具，在本地将文字转化为自然、富有表现力的语音。支持音色复刻、情绪控制与音频作品管理，可自主选择 TTS 模型，无需调用云端 API，也没有按字数计费的开销，让旁白、配音和有声内容创作更自主、更低成本。

![yovoice 创作工作台，浏览器预览](docs/images/yovoice-workspace.png)

---

## 功能

- **音色与表达** — 跟随参考音色、模仿参考演绎、调整情绪，或用文字描述想要的表达方式。
- **完整音频流程** — 导入或录制参考音频、裁剪片段、试听语音、导出作品。
- **本地模型** — 通过 audio.cpp 运行 IndexTTS 2.0 和 2.5，支持模型下载续传与 GGUF 导入。
- **硬件加速** — Apple Silicon 支持 Metal；Windows 支持 CPU、NVIDIA CUDA 和实验性 Vulkan。

---

## 安装

在仓库的 [Releases](../../releases) 页面选择对应平台的安装包。

| 平台 | 安装包 | 安装方式 |
| --- | --- | --- |
| macOS 14+ · Apple Silicon | `.dmg` | 打开磁盘映像，将 yovoice 拖入 Applications |
| Windows 10/11 · x64 | `-setup.exe` | 运行安装向导，安装后从开始菜单打开 |

Windows 安装器会在缺少时联网安装 [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)。模型在应用内下载。卸载应用保留 `~/.yovoice` 中的作品和模型。

macOS 和 Windows 均支持在应用菜单中检查更新，也会自动检查并后台下载；下载完成后可选择重启安装。

![yovoice macOS 安装界面](docs/images/yovoice-macos-install.png)

---

## 快速上手

1. **准备模型。** 在设置中下载 IndexTTS 模型，Windows 已内置 CPU 内核，可在设置中下载 CUDA 内核以使用 NVIDIA GPU 加速。
2. **添加音色。** 导入或录制一段 1–60 秒的参考音频。
3. **生成语音。** 输入正文，选择表达方式，点击生成。
4. **试听与导出。** 预览生成结果，在历史记录中查找以往作品。

作品、音色与设置保存在 `~/.yovoice`。

---

## 开发

```sh
make install
make app-run
```

环境要求见[开发指南](docs/development.md)，其中也介绍了浏览器预览、测试和项目结构。

---

## 参与贡献

欢迎提交问题、功能建议和 Pull Request。报告问题时，请附上操作系统、模型及复现步骤；提交代码前运行 `make check`。

---

## 鸣谢

- [audio.cpp](https://github.com/0xShug0/audio.cpp) — ShugoAI 开发的本地音频推理引擎。
- [IndexTTS](https://github.com/index-tts/index-tts) — 为 yovoice 提供语音合成模型。

---

## 开源协议

[Apache-2.0](LICENSE)。依赖组件保留[各自的许可证](THIRD_PARTY_NOTICES.md)，IndexTTS 模型单独遵循其[模型使用许可协议](web/public/model-license.txt)。
