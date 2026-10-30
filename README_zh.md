<p align="center">
  <img src="desktop/icon/voice-workbench-app-icon-v1.png" width="96" alt="yovoice" />
</p>
<h1 align="center">yovoice</h1>
<p align="center">把文字，变成有情绪的声音</p>
<p align="center">
  <a href="https://yovoice.leemysw.com"><img src="https://img.shields.io/badge/website-yovoice.leemysw.com-10b981?style=flat-square" alt="官网" /></a>
  <a href="https://github.com/leemysw/yovoice/releases/latest"><img src="https://img.shields.io/github/v/release/leemysw/yovoice?style=flat-square&label=release&color=blue" alt="最新版本" /></a>
  <a href="https://github.com/leemysw/yovoice/releases"><img src="https://img.shields.io/github/downloads/leemysw/yovoice/total?style=flat-square&color=8b5cf6" alt="下载量" /></a>
  <a href="https://github.com/leemysw/yovoice/actions/workflows/check.yml"><img src="https://img.shields.io/github/actions/workflow/status/leemysw/yovoice/check.yml?branch=main&style=flat-square" alt="构建状态" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-orange?style=flat-square" alt="License: Apache-2.0" /></a>
  <a href="https://glama.ai/mcp/servers/leemysw/yovoice"><img src="https://glama.ai/mcp/servers/leemysw/yovoice/badges/score.svg" alt="Glama MCP 服务评分" /></a>
  <a href="https://mcpservers.org/servers/leemysw/yovoice"><img src="https://mcpservers.org/badge.svg" alt="已收录于 mcpservers.org" /></a>
  <img src="https://img.shields.io/badge/macOS-14%2B-black?style=flat-square" alt="macOS 14+ (Apple Silicon)" />
  <img src="https://img.shields.io/badge/Windows-10%2F11-0078D4?style=flat-square" alt="Windows 10/11 (x64)" />
  <img src="https://img.shields.io/badge/Linux-x64-FCC624?style=flat-square" alt="Linux (x64)" />
</p>
<p align="center">
  <a href="https://www.producthunt.com/products/yovoice?embed=true&amp;utm_source=badge-featured&amp;utm_medium=badge&amp;utm_campaign=badge-yovoice" target="_blank" rel="noopener noreferrer">
    <img alt="yovoice - Local-first voice, music, and score creation studio | Product Hunt" width="250" height="54" src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1293995&amp;theme=light&amp;t=1793070018670" />
  </a>
</p>
<p align="center">
  <a href="https://www.star-history.com/leemysw/yovoice">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/badge?repo=leemysw/yovoice&type=rank&theme=dark" />
      <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/badge?repo=leemysw/yovoice&type=rank" />
      <img alt="Star History Rank" src="https://api.star-history.com/badge?repo=leemysw/yovoice&type=rank" width="250" height="55" />
    </picture>
  </a>
  <a href="https://trendshift.io/repositories/239687?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-239687" target="_blank" rel="noopener noreferrer">
    <img src="https://trendshift.io/api/badge/trendshift/repositories/239687/daily?language=TypeScript" alt="leemysw%2Fyovoice | Trendshift" width="250" height="55"/>
  </a>
</p>
<p align="center"><a href="README.md">English</a> · 简体中文</p>

<p align="center"><a href="https://yovoice.leemysw.com">官方网站</a> · <a href="docs/cli_zh.md">CLI 与 Agent Skill</a> · <a href="docs/api_zh.md">API / MCP 部署</a> · <a href="docs/development_zh.md">开发指南</a></p>

---

yovoice 是一款适用于 macOS、Windows 和 Linux 的开源、本地优先（Local-first）声音与音乐创作工作台。

在本地将文字转化为自然逼真的语音、整首带人声歌曲或多轨乐谱。支持零样本音色克隆、情绪风格控制、带歌词人声的 AI 音乐生成、多轨 MIDI 编曲渲染与音频工程管理。**完全在本地运行，无云端 API 调用，无按字/按秒扣费开销，无需复杂的 Python 环境配置**，让旁白、配音、有声内容与音乐创作更自主、更私密、更低成本。

![yovoice 创作工作台，浏览器预览](docs/images/yovoice-workspace.png)

---

## 为什么选择 yovoice？

- 🔒 **100% 本地离线与数据隐私**：所有模型均在本地显卡/CPU 推理，文本稿件和声音样本永远不会上传到第三方云端。
- 💸 **零按字/按秒扣费**：无需订阅昂贵的云端 API（告别 ElevenLabs、Suno、商用配音会员计费）。
- ⚡ **原生 C++ 极速引擎，免配 Python**：基于 [audio.cpp](https://github.com/0xShug0/audio.cpp) v0.9.3 原生构建，支持 macOS Metal 与 Windows NVIDIA CUDA 12.4/13.3 开箱即用，告别 Conda 与 PyTorch 依赖地狱。
- 🎛️ **全流程专业创作流**：多版本试听对比（Takes）、多轨时间轴吸附裁剪、General MIDI 音色库本地渲染与分轨导出（Stems）。
- 🤖 **原生 MCP 与 AI Agent 协创**：接入 DeepSeek、通义千问、Claude、OpenAI 或本地 Ollama，用对话完成写歌写谱到生成的全流程，并提供 Model Context Protocol (MCP) 服务，支持在 Cursor 或 Claude Code 中直接调用。

---

## 功能

- **语音、声音设计与克隆** — 克隆参考音色、用文字设计声音、调整情绪与演绎，并在音轨上剪辑各个版本。
- **故事配音** — 导入文本或字幕文件，为每句台词分配角色并逐句生成。
- **音乐生成** — 写下风格和带段落标记的歌词，用 ACE-Step 1.5 生成歌曲或纯音乐，或用 YuE2 生成歌曲和按谱演奏的纯音乐，或用 Stable Audio 3 根据英文描述生成纯音乐与音效；播放页按人声同步歌词。
- **编曲** — 按小节和拍写声部，或导入 MIDI、交给 Agent 写谱，用 General MIDI 音色库渲染，导出 MIDI 和分轨。详见[编曲](docs/score_zh.md)。
- **可选 AI 服务** — 内置助手面板通过 DeepSeek、通义千问、Kimi、OpenAI、Anthropic、Ollama 或任意兼容接口对话创作：写谱写词、改台词、配音色、发起生成；密钥只保存在本机。详见[AI 服务](docs/ai_zh.md)。
- **12 种界面语言** — 简体中文、繁體中文、English、日本語、한국어、Español、Français、Deutsch、Português (Brasil)、Русский、Italiano 和 Tiếng Việt，可在设置中随时切换，无需重启。

---

## 支持模型

| 用途 | 模型 |
| --- | --- |
| 音色克隆与情绪控制 | IndexTTS 2.0 / 2.5、Qwen3-TTS Base |
| 声音设计与克隆 | VoxCPM2、OmniVoice、Qwen3-TTS VoiceDesign、Breeze TTS 2 |
| 内置音色 | Kokoro-82M、Qwen3-TTS CustomVoice |
| 歌曲与纯音乐 | ACE-Step 1.5 Turbo / XL Turbo、YuE2 3B |
| 纯音乐与音效 | Stable Audio 3 Small Music / Small SFX / Medium |

所有模型都在 App 内或通过 CLI 下载。文件大小、硬件要求、输入要求与示例见[模型选择](docs/models_zh.md)。OmniVoice、YuE2 和 Breeze TTS 2 的权重仅限非商业用途；Stable Audio 3 采用 Stability AI 社区许可，年收入低于 100 万美元可免费使用。

---

## 安装

在仓库的 [Releases](../../releases) 页面选择对应平台的安装包，或访问[官方网站](https://yovoice.leemysw.com)。

| 平台 | 安装包 | 安装方式 |
| --- | --- | --- |
| macOS 14+ · Apple Silicon | `.dmg` | 打开磁盘映像，将 yovoice 拖入 Applications |
| Windows 10/11 · x64 | `-setup.exe` | 运行安装向导，安装后从开始菜单打开 |
| Windows 10/11 · x64 · NVIDIA 显卡 | `-cuda12.4-setup.exe` | 内置 CUDA 12.4 内核，兼容较旧的显卡与驱动，首次启动即用 GPU |
| Windows 10/11 · x64 · NVIDIA 显卡 | `-cuda13.3-setup.exe` | 内置 CUDA 13.3 内核，需要较新的驱动，安装包更小 |
| Linux · x64（Debian/Ubuntu） | `-linux-x64.deb` | `sudo apt install ./yovoice-<版本>-linux-x64.deb`，安装后从应用菜单打开 |
| Linux · x64（其他发行版） | `-linux-x64.tar.gz` | 解压后运行 `./install.sh`，为当前用户添加到应用菜单 |

Windows 安装器会在缺少时联网安装 [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)。模型在应用内下载。卸载应用保留 `~/.yovoice` 中的作品和模型。

Linux 版需要 WebKitGTK 4.1（Debian/Ubuntu 为 `libwebkit2gtk-4.1-0`，Fedora 为 `webkit2gtk4.1`，Arch 为 `webkit2gtk-4.1`），`.deb` 会自动安装。Linux 开箱使用 CPU，可在 设置 → 推理引擎 中下载 Vulkan GPU 内核。Linux 版暂不支持自动更新，请从 Releases 下载新版本。

macOS 和 Windows 均支持在应用菜单中检查更新，也会自动检查并后台下载；下载完成后可选择重启安装。Windows 自动更新只下载应用本体（`-update.exe`），保留已安装的内核；新版本推荐更高的内核时，可在 设置 → 推理引擎 中选择升级。

---

## 快速上手

1. **准备模型。** 在设置中下载所需模型（例如轻量朗读用 Kokoro-82M，声音克隆用 VoxCPM2）。
2. **新建作品。** 选择“故事配音”、“语音生成”、“音乐生成”或“编曲”。
3. **填写内容。** 输入文字、歌词或音符，选择角色并调整风格。
4. **生成音频。** 点击“生成”，试听对比多版本（Takes）、编辑并导出。

---

## CLI 与 Agent Skill

将 [yovoice Skill](https://github.com/leemysw/yovoice/tree/main/skills/yovoice) 链接发给 Agent，让它安装 Skill，并准备本地 CLI、引擎和模型：

> 安装这个 Skill，并帮我配置好 yovoice 本地语音生成环境：https://github.com/leemysw/yovoice/tree/main/skills/yovoice

之后直接描述需求：

> 用 voice.wav 的音色朗读 narration.txt，语气平静，保存为 narration.wav。

Agent 通过独立 CLI 完成配音，无需打开桌面应用。详细用法见 [CLI 指南](docs/cli_zh.md)。

---

运行 `yovoice serve` 可为其他机器提供带认证的 HTTP API 与 MCP 推理服务，支持上传参考音频与生成 WAV。部署和调用示例见[API / MCP 部署指南](docs/api_zh.md)。

<a href="https://glama.ai/mcp/servers/leemysw/yovoice"><img width="380" height="200" src="https://glama.ai/mcp/servers/leemysw/yovoice/badges/card.svg" alt="yovoice 在 Glama 上的 MCP 服务页" /></a>

## 开发

```sh
make install
make app-run
```

环境要求见[开发指南](docs/development_zh.md)，其中也介绍了浏览器预览、测试和项目结构。进程与各包如何协作见[架构](docs/architecture_zh.md)。

---

## 交流群

使用微信扫码加入 yovoice 用户交流群。二维码过期时，欢迎提交 [Issue](../../issues)，我们会及时更新。

<p align="center"><img src="docs/images/Group%20chat_%E3%80%90YOVOICE%E3%80%91%E4%BA%A4%E6%B5%81%E7%BE%A4.png" width="240" alt="yovoice 微信交流群二维码" /></p>

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
- [ACE-Step](https://github.com/ace-step/ACE-Step-1.5) — 根据风格描述与歌词生成音乐。
- [YuE](https://github.com/multimodal-art-projection/YuE) — 根据歌词生成整首带人声歌曲。
- [Stable Audio 3](https://huggingface.co/stabilityai/stable-audio-3-medium)（Stability AI）— 根据文字生成纯音乐与音效。Powered by Stability AI。
- [Breeze TTS 2](https://huggingface.co/BreezeBlue/Breeze-TTS-2) — 中英文声音设计与音色克隆。
- [go-meltysynth](https://github.com/sinshu/go-meltysynth)、[MuseScore General](https://musescore.org/en/handbook/3/soundfonts-and-sfz-files#gm_soundfonts)、[GeneralUser GS](https://www.schristiancollins.com/generaluser) 与 David Shan 的 SGM-V2.01 — 编曲渲染使用的 SoundFont 合成器与音色库。
- Kokoro — 使用内置音色的轻量语音合成模型：[Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) 与 [Kokoro-82M-v1.1-zh](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh)。

---

## Star History

<a href="https://www.star-history.com/?repos=leemysw%2Fyovoice&type=date&legend=bottom-right">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=leemysw/yovoice&type=date&theme=dark&legend=bottom-right" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=leemysw/yovoice&type=date&legend=bottom-right" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=leemysw/yovoice&type=date&legend=bottom-right" />
 </picture>
</a>

---

## 开源协议

[Apache-2.0](LICENSE)。依赖组件保留[各自的许可证](THIRD_PARTY_NOTICES.md)，IndexTTS 模型单独遵循其[模型使用许可协议](web/public/model-license.txt)。
