<p align="center">
  <img src="web/public/icon/voice-workbench-app-icon-v1.png" width="96" alt="yovoice" />
</p>

<h1 align="center">yovoice</h1>
<p align="center">Give your words a voice.</p>
<p align="center">
  <a href="web/package.json"><img src="https://img.shields.io/badge/version-0.1.7-blue?style=flat-square" alt="Version 0.1.7" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-orange?style=flat-square" alt="License: Apache-2.0" /></a>
  <img src="https://img.shields.io/badge/macOS-14%2B-black?style=flat-square" alt="macOS 14+ (Apple Silicon)" />
  <img src="https://img.shields.io/badge/Windows-10%2F11-0078D4?style=flat-square" alt="Windows 10/11 (x64)" />
</p>
<p align="center">English · <a href="README_zh.md">简体中文</a></p>

<p align="center"><a href="docs/cli.md">CLI & Agent Skill</a> · <a href="docs/api.md">API / MCP Deployment</a> · <a href="docs/development.md">Development</a></p>

---

yovoice is an open-source voice creation tool for macOS and Windows that turns text into natural, expressive speech locally. With voice cloning, emotion control, audio project management, and a choice of TTS models, it requires no cloud API calls and incurs no per-character charges, giving you more control over narration, voiceovers, and audio content creation at a lower cost.

![yovoice creation workspace — browser preview](docs/images/yovoice-workspace.png)

---

## Features

- **Voice and expression** — use a reference voice, match a reference performance, adjust emotions, or describe the delivery in words.
- **A complete audio workflow** — import or record reference audio, trim clips, preview speech, and export your work.
- **Voice design and cloning** — VoxCPM2 offers text-guided voice design, controllable cloning, and transcript-assisted cloning with automatic multilingual handling, and 48 kHz output.
- **Music generation** — describe a style, write lyrics with section markers, and generate full songs or instrumentals with ACE-Step 1.5; every take is kept as a version to compare.
- **Score** — write each part by bar and beat, import MIDI or let an Agent write the score, then render it with a General MIDI sound font and a role-based mix; results are exactly repeatable and export to MIDI and stems. See [Score](docs/score.md).
- **Local models** — run IndexTTS 2.0 / 2.5, VoxCPM2, OmniVoice, Qwen3-TTS and Kokoro through audio.cpp, with resumable model downloads and GGUF import.
- **Hardware acceleration** — Metal on Apple Silicon; CPU, NVIDIA CUDA, and experimental Vulkan on Windows.
- **Agent Skill** — ask your AI agent to set up local speech generation and create voiceovers from text and reference audio.

---

## Supported Models

| Model | Parameters | Model file size by precision | Core capabilities |
| --- | --- | --- | --- |
| IndexTTS 2.0 | — | Q8 · 3.63 GB<br>F16 · 4.65 GB<br>ORIG · 8.08 GB | Chinese/English voice cloning, emotion control, reference performance |
| IndexTTS 2.5 | — | Q8 · 3.50 GB<br>F16 · 4.55 GB<br>ORIG · 7.89 GB | Multilingual voice cloning, emotion control, pronunciation editing |
| VoxCPM2 | 2B | Q8 · 2.96 GB<br>BF16 · 4.77 GB<br>ORIG · 4.96 GB | Text-guided voice design, voice cloning, transcript-assisted cloning |
| OmniVoice | 0.6B | Q8 · 1.35 GB<br>BF16 · 1.64 GB<br>F16 · 1.64 GB | Attribute-based voice design, voice cloning, non-verbal sound tags |
| Qwen3-TTS Base | 0.6B | Q8 · 1.99 GB<br>BF16 · 2.52 GB | Reference voice cloning, optional transcript guidance, multilingual speech |
| Qwen3-TTS Base | 1.7B | Q8 · 2.70 GB<br>BF16 · 4.20 GB<br>ORIG · 4.54 GB | Reference voice cloning, optional transcript guidance, multilingual speech |
| Qwen3-TTS CustomVoice | 1.7B | Q8 · 2.82 GB<br>BF16 · 4.18 GB | 9 built-in voices, text-guided style and emotion |
| Qwen3-TTS VoiceDesign | 1.7B | Q8 · 2.82 GB<br>BF16 · 4.18 GB | Voice design from natural-language descriptions, no reference audio required |
| Kokoro-82M 1.0 Official | 82M | Q8 · 189.55 MB<br>BF16 · 211.95 MB | 49 built-in voices, multilingual speech excluding Japanese |
| Kokoro-82M 1.0 | 82M | Q8 · 932.66 MB | 54 built-in voices, full multilingual resources including Japanese; import only |
| Kokoro-82M 1.1-zh | 82M | Q8 · 255.32 MB | 100 Chinese and 3 English voices; experimental, import only |
| ACE-Step 1.5 Turbo | — | BF16 · 10.09 GB | Songs and instrumentals from a style prompt and lyrics, 50+ vocal languages; requires engine v0.9.1 |


All models are available in the App and CLI. See [model selection](docs/models.md) for input requirements and examples. OmniVoice weights use the CC-BY-NC license and are restricted to non-commercial use.

---

## Installation

Choose the package for your platform from the repository’s [Releases](../../releases) tab.

| Platform | Package | Install |
| --- | --- | --- |
| macOS 14+ · Apple Silicon | `.dmg` | Open the disk image and drag yovoice to Applications |
| Windows 10/11 · x64 | `-setup.exe` | Run the installer, then open yovoice from the Start menu |
| Windows 10/11 · x64 · NVIDIA GPU | `-cuda12.4-setup.exe` | Bundles the CUDA 12.4 runtime; works with older GPUs and drivers and uses the GPU from first launch |
| Windows 10/11 · x64 · NVIDIA GPU | `-cuda13.3-setup.exe` | Bundles the CUDA 13.3 runtime; needs a newer driver, smaller download |

The Windows installer downloads and installs [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) if needed. Models are downloaded inside the app; uninstalling preserves user data in `~/.yovoice`.

Check for updates from the app menu on macOS or Windows. Updates are also checked and downloaded in the background; restart to install when ready. Windows updates download only the app (`-update.exe`) and keep the installed runtime; when a release recommends a newer runtime you can upgrade it in Settings → Inference engine, and it is required only when the runtime is below the minimum version the app needs.

![Install yovoice on macOS](docs/images/yovoice-macos-install.png)

---

## Quick Start

1. **Set up a model.** Download a model in Settings.
2. **Create a project.** Choose Story dubbing or Speech generation.
3. **Add content.** Enter text or import subtitles, then choose a character and adjust the voice.
4. **Generate audio.** Select Generate speech, then preview, edit and export.

---

## CLI & Agent Skill

Give your agent the [yovoice Skill](https://github.com/leemysw/yovoice/tree/main/skills/yovoice) link and ask it to install the Skill and set up the local CLI, engine, and model:

> Install this Skill and set up yovoice for local speech generation: https://github.com/leemysw/yovoice/tree/main/skills/yovoice

Then describe what you want:

> Read narration.txt using voice.wav as the reference voice, with a calm delivery, and save it as narration.wav.

The agent runs the standalone CLI without opening the desktop app. See the [CLI guide](docs/cli.md) for details.

---

Run `yovoice serve` to provide an authenticated HTTP API and MCP inference service for other machines. See the [API / MCP deployment guide](docs/api.md) for deployment and client examples.

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
- [OmniVoice](https://github.com/k2-fsa/OmniVoice) — voice design and cloning models.
- [Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS) — voice cloning, built-in voices, and text-guided voice design.
- [ACE-Step](https://github.com/ace-step/ACE-Step-1.5) — music generation from style prompts and lyrics.
- [go-meltysynth](https://github.com/sinshu/go-meltysynth) and [MuseScore General](https://musescore.org/en/handbook/3/soundfonts-and-sfz-files#gm_soundfonts) — the SoundFont synthesizer and sound font behind score rendering.
- Kokoro — lightweight speech synthesis with built-in voices: [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) and [Kokoro-82M-v1.1-zh](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh).

---

## License

[Apache-2.0](LICENSE). Dependencies retain their [original licenses](THIRD_PARTY_NOTICES.md); IndexTTS models are covered separately by their [model license](web/public/model-license.txt).
