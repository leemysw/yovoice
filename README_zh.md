<p align="center">
  <img src="web/public/icon/voice-workbench-app-icon-v1.png" width="96" alt="yovoice" />
</p>
<h1 align="center">yovoice</h1>
<p align="center">让文字拥有你的声音。</p>
<p align="center">
  <a href="web/package.json"><img src="https://img.shields.io/badge/version-0.1.6-blue?style=flat-square" alt="Version 0.1.6" /></a>
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
- **声音设计与克隆** — VoxCPM2 支持文字设计音色、带风格指导的克隆及参考原文辅助的精细克隆，自动多语言、48 kHz 输出。
- **本地模型** — 通过 audio.cpp 运行 IndexTTS 2.0 / 2.5、VoxCPM2、OmniVoice、Qwen3-TTS 和 Kokoro，支持模型下载续传与 GGUF 导入。
- **硬件加速** — Apple Silicon 支持 Metal；Windows 支持 CPU、NVIDIA CUDA 和实验性 Vulkan。
- **Agent Skill** — 让 AI Agent 准备本地语音生成环境，根据文稿和参考音频完成配音。

---

## 支持模型

| 模型 | 参数量 | 模型文件大小（按精度） | 核心能力 |
| --- | --- | --- | --- |
| IndexTTS 2.0 | — | Q8 · 3.63 GB<br>F16 · 4.65 GB<br>ORIG · 8.08 GB | 中英音色克隆、情绪控制、参考演绎 |
| IndexTTS 2.5 | — | Q8 · 3.50 GB<br>F16 · 4.55 GB<br>ORIG · 7.89 GB | 多语言音色克隆、情绪控制、发音调整 |
| VoxCPM2 | 2B | Q8 · 2.96 GB<br>BF16 · 4.77 GB<br>ORIG · 4.96 GB | 文字设计音色、音色克隆、参考原文辅助的精细克隆 |
| OmniVoice | 0.6B | Q8 · 1.35 GB<br>BF16 · 1.64 GB<br>F16 · 1.64 GB | 属性设计音色、音色克隆、非语言声音标签 |
| Qwen3-TTS Base | 0.6B | Q8 · 1.99 GB<br>BF16 · 2.52 GB | 参考音色克隆、可选原文辅助、多语言生成 |
| Qwen3-TTS Base | 1.7B | Q8 · 2.70 GB<br>BF16 · 4.20 GB<br>ORIG · 4.54 GB | 参考音色克隆、可选原文辅助、多语言生成 |
| Qwen3-TTS CustomVoice | 1.7B | Q8 · 2.82 GB<br>BF16 · 4.18 GB | 9 种内置音色、文字控制风格与情绪 |
| Qwen3-TTS VoiceDesign | 1.7B | Q8 · 2.82 GB<br>BF16 · 4.18 GB | 自然语言描述设计音色，无需参考音频 |
| Kokoro-82M 1.0 Official | 82M | Q8 · 189.55 MB<br>BF16 · 211.95 MB | 49 种内置音色、多语言生成，不含日语 |
| Kokoro-82M 1.0 | 82M | Q8 · 932.66 MB | 54 种内置音色、包含日语的完整多语言资源；仅支持导入 |
| Kokoro-82M 1.1-zh | 82M | Q8 · 255.32 MB | 100 种中文音色及 3 种英文音色；实验性，仅支持导入 |


App 与 CLI 均支持以上模型，详细精度与参数见[模型能力说明](skills/yovoice/references/models.md)。OmniVoice 权重采用 CC-BY-NC 许可，仅限非商业用途。

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

1. **准备模型。** 在设置中下载所需模型。
2. **新建作品。** 选择“故事配音”或“语音生成”。
3. **填写内容。** 输入文字或导入字幕，选择角色并调整声音。
4. **生成音频。** 点击“生成语音”，试听、编辑并导出。

---

## CLI 与 Agent Skill

将 [yovoice Skill](https://github.com/leemysw/yovoice/tree/main/skills/yovoice) 链接发给 Agent，让它安装 Skill，并准备本地 CLI、引擎和模型：

> 安装这个 Skill，并帮我配置好 yovoice 本地语音生成环境：https://github.com/leemysw/yovoice/tree/main/skills/yovoice

之后直接描述需求：

> 用 voice.wav 的音色朗读 narration.txt，语气平静，保存为 narration.wav。

Agent 通过独立 CLI 完成配音，无需打开桌面应用。详细用法见 [CLI 指南](docs/cli.md)。

---

运行 `yovoice serve` 可为其他机器提供带认证的 HTTP API 与 MCP 推理服务，支持上传参考音频与生成 WAV。部署和调用示例见[远程 API](docs/api.md)。

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
- [VoxCPM](https://github.com/OpenBMB/VoxCPM) — 声音设计与克隆模型，Apache-2.0 许可。
- [IndexTTS](https://github.com/index-tts/index-tts) — 为 yovoice 提供语音合成模型。
- [OmniVoice](https://github.com/k2-fsa/OmniVoice) — 声音设计与音色克隆模型。
- [Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS) — 支持音色克隆、内置音色与文字设计声音。
- Kokoro — 使用内置音色的轻量语音合成模型：[Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) 与 [Kokoro-82M-v1.1-zh](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh)。

---

## 开源协议

[Apache-2.0](LICENSE)。依赖组件保留[各自的许可证](THIRD_PARTY_NOTICES.md)，IndexTTS 模型单独遵循其[模型使用许可协议](web/public/model-license.txt)。
