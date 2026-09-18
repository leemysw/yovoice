<p align="center">
  <img src="web/public/icon/voice-workbench-app-icon-v1.png" width="96" alt="yovoice" />
</p>

<h1 align="center">yovoice</h1>
<p align="center">Give your words a voice.</p>
<p align="center">
  <a href="web/package.json"><img src="https://img.shields.io/badge/version-0.1.1-blue?style=flat-square" alt="Version 0.1.1" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-orange?style=flat-square" alt="License: Apache-2.0" /></a>
  <img src="https://img.shields.io/badge/macOS-14%2B-black?style=flat-square" alt="macOS 14+ (Apple Silicon)" />
  <img src="https://img.shields.io/badge/Windows-10%2F11-0078D4?style=flat-square" alt="Windows 10/11 (x64)" />
</p>
<p align="center">English · <a href="README_zh.md">简体中文</a></p>

---

yovoice is an open-source voice creation tool for macOS and Windows that turns text into natural, expressive speech locally. With voice cloning, emotion control, audio project management, and a choice of TTS models, it requires no cloud API calls and incurs no per-character charges, giving you more control over narration, voiceovers, and audio content creation at a lower cost.

![yovoice creation workspace — browser preview](docs/images/yovoice-workspace.png)

---

## Features

- **Voice and expression** — use a reference voice, match a reference performance, adjust emotions, or describe the delivery in words.
- **A complete audio workflow** — import or record reference audio, trim clips, preview speech, and export your work.
- **Voice design and cloning** — VoxCPM2 offers text-guided voice design, controllable cloning, and transcript-assisted cloning with automatic multilingual handling, and 48 kHz output.
- **Local models** — run IndexTTS 2.0 / 2.5, VoxCPM2, OmniVoice and Qwen3-TTS through audio.cpp, with resumable model downloads and GGUF import.
- **Hardware acceleration** — Metal on Apple Silicon; CPU, NVIDIA CUDA, and experimental Vulkan on Windows.
- **Agent Skill** — ask your AI agent to set up local speech generation and create voiceovers from text and reference audio.

---

## Supported Models

| Model | Core capabilities |
| --- | --- |
| IndexTTS 2.0 | Chinese/English voice cloning, emotion control, reference performance |
| IndexTTS 2.5 | Multilingual voice cloning, emotion control, pronunciation editing |
| VoxCPM2 | Text-guided voice design, voice cloning, transcript-assisted cloning |
| OmniVoice | Attribute-based voice design, voice cloning, non-verbal sound tags |
| Qwen3-TTS Base · 0.6B / 1.7B | Reference voice cloning, optional transcript guidance, multilingual speech |
| Qwen3-TTS CustomVoice · 1.7B | 9 built-in voices, text-guided style and emotion |
| Qwen3-TTS VoiceDesign · 1.7B | Voice design from natural-language descriptions, no reference audio required |

All models are available in the App and CLI. See [model capabilities](skills/yovoice/references/models.md) for precisions and parameters. OmniVoice weights use the CC-BY-NC license and are restricted to non-commercial use.

---

## Installation

Choose the package for your platform from the repository’s [Releases](../../releases) tab.

| Platform | Package | Install |
| --- | --- | --- |
| macOS 14+ · Apple Silicon | `.dmg` | Open the disk image and drag yovoice to Applications |
| Windows 10/11 · x64 | `-setup.exe` | Run the installer, then open yovoice from the Start menu |

The Windows installer downloads and installs [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) if needed. Models are downloaded inside the app; uninstalling preserves user data in `~/.yovoice`.

Check for updates from the app menu on macOS or Windows. Updates are also checked and downloaded in the background; restart to install when ready.

![Install yovoice on macOS](docs/images/yovoice-macos-install.png)

---

## Quick Start

1. **Set up a model.** Open Settings and download your chosen model. The CPU engine is bundled on Windows; CUDA can be downloaded from Settings for NVIDIA GPU acceleration.
2. **Add a voice.** Import or record a 1–60 second reference clip, or use VoxCPM2 / OmniVoice / Qwen3-TTS VoiceDesign without one.
3. **Create speech.** Enter your text, choose an expression mode, and select Generate.
4. **Listen and export.** Preview the result and find previous generations in History.

Projects, voices, and settings are saved in `~/.yovoice`.

---

## CLI & Agent Skill

Give your agent the [yovoice Skill](https://github.com/leemysw/yovoice/tree/main/skills/yovoice) link and ask it to install the Skill and set up the local CLI, engine, and model:

> Install this Skill and set up yovoice for local speech generation: https://github.com/leemysw/yovoice/tree/main/skills/yovoice

Then describe what you want:

> Read narration.txt using voice.wav as the reference voice, with a calm delivery, and save it as narration.wav.

The agent runs the standalone CLI without opening the desktop app. See the [CLI guide](docs/cli.md) for details.

---

## Development

```sh
make install
make app-run
```

See the [development guide](docs/development.md) for prerequisites. It also covers browser preview, tests, and project structure.

---

## Contributing

Bug reports, feature suggestions, and pull requests are welcome. Include your platform, model, and steps to reproduce when reporting a problem. Run `make check` before submitting code changes.

---

## Acknowledgements

- [audio.cpp](https://github.com/0xShug0/audio.cpp) by ShugoAI — the local audio inference engine.
- [VoxCPM](https://github.com/OpenBMB/VoxCPM) — voice design and cloning models, licensed under Apache-2.0.
- [IndexTTS](https://github.com/index-tts/index-tts) — the speech synthesis models behind yovoice.

---

## License

[Apache-2.0](LICENSE). Dependencies retain their [original licenses](THIRD_PARTY_NOTICES.md); IndexTTS models are covered separately by their [model license](web/public/model-license.txt).
