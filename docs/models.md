# Model selection

English · [简体中文](models_zh.md)

Choose a model based on whether you have a reference recording or want a built-in or designed voice. All models generate complete audio before playback.

| Model | Main use | Required input |
| --- | --- | --- |
| IndexTTS 2.0 / 2.5 | Voice cloning and emotion control | Reference audio; 2.0 supports Chinese/English, 2.5 adds Japanese, Spanish, and Arabic |
| VoxCPM2 | Voice design and cloning | A description for designed voices is optional; transcript-assisted cloning uses reference audio and its transcript |
| OmniVoice | Attribute-based voice design and cloning | Predefined attributes for design; audio and a matching transcript for cloning |
| Qwen3-TTS Base · 0.6B / 1.7B | Voice cloning | Reference audio; transcript optional |
| Qwen3-TTS CustomVoice · 1.7B | Built-in voices with style instructions | Speaker ID; optional style description |
| Qwen3-TTS VoiceDesign · 1.7B | Voice design | A voice description |
| Kokoro | Lightweight built-in voices | Speaker ID; no reference audio |

Use `yovoice models list --json` for model IDs, available precisions, file sizes, voices, and advanced parameter definitions. The app lists models in Settings. See the [CLI guide](cli.md) to download an engine and model.

## Voice cloning

```sh
yovoice generate --model index-2.5-q8 --text-file narration.txt --reference voice.wav --output index.wav
yovoice generate --model voxcpm2-q8 --text-file narration.txt --reference voice.wav --reference-text "The exact words spoken in the recording." --output vox.wav
yovoice generate --model omnivoice-q8 --text-file narration.txt --reference voice.wav --reference-text "The exact words spoken in the recording." --output omni.wav
yovoice generate --model qwen3-tts-base-0.6b-q8 --text-file narration.txt --reference voice.wav --output qwen.wav
```

For VoxCPM2, omit `--reference-text` for ordinary cloning. For Qwen3-TTS Base, adding an accurate transcript enables transcript-guided cloning. OmniVoice cloning always requires a matching transcript.

Use a clear recording with one speaker and little background noise. Reference audio must be 1–60 seconds and no larger than 20 MB.

## Voice design and built-in voices

```sh
yovoice generate --model voxcpm2-q8 --voice-description "A warm, calm adult narrator" --text-file narration.txt --output vox-design.wav
yovoice generate --model omnivoice-q8 --voice-description "female, young adult, moderate pitch" --text-file narration.txt --output omni-design.wav
yovoice generate --model qwen3-tts-voicedesign-q8 --voice-description "A deep, resonant adult narrator" --text-file narration.txt --output qwen-design.wav
yovoice generate --model qwen3-tts-customvoice-q8 --speaker Ryan --voice-description "Speak softly and slowly" --language en --text-file narration.txt --output custom.wav
```

Qwen3-TTS CustomVoice speakers are `Vivian`, `Serena`, `Uncle_Fu`, `Dylan`, `Eric`, `Ryan`, `Aiden`, `Ono_Anna`, and `Sohee`.

OmniVoice design accepts predefined comma-separated attributes, rather than free-form descriptions. Choose at most one attribute per category:

- Gender: `male`, `female`.
- Age: `child`, `teenager`, `young adult`, `middle-aged`, `elderly`.
- Pitch: `very low pitch`, `low pitch`, `moderate pitch`, `high pitch`, `very high pitch`.
- Delivery: `whisper`.

Leave the description empty for an automatic voice. For Kokoro voices and model variants, see [Kokoro](#kokoro) below.

## Expression and advanced options

IndexTTS supports `--emotion-text`, `--emotion-reference`, or `--emotion-vector` to select an expression mode. The eight emotion-vector values are ordered as happy, angry, sad, afraid, disgusted, low, surprised, and calm. Use `--emotion-strength` to adjust intensity and `--speed` for speed. IndexTTS 2.5 also supports pronunciation annotations in the text.

VoxCPM2 uses voice descriptions for speed, emotion, and dialect. `--guidance-scale`, `--inference-steps`, and `--seed` provide additional control. Transcript-assisted cloning follows the reference performance instead of adding a design description.

OmniVoice supports `--speed`, `--language`, `--guidance-scale`, and `--inference-steps`. Sound tags such as `[laughter]` and `[sigh]` can be inserted into the text. Qwen3-TTS supports `--language auto|zh|en|ja|ko|de|fr|ru|pt|es|it`.

The app shows supported options under Advanced settings. The CLI accepts repeated `--option KEY=JSON` values; query `models list --json` for each model's supported keys and limits:

```sh
yovoice generate --model qwen3-tts-customvoice-q8 --speaker Ryan --text-file narration.txt --option 'temperature=0.7' --option 'text_chunk_size=512' --output advanced.wav
```

## Kokoro

Kokoro generates speech with built-in voices and does not require reference audio.

### Choose a model

| Model ID | Size | Voices and languages | Installation |
| --- | --- | --- | --- |
| `kokoro-82m-q8` | About 190 MB | 49 voices; multilingual, excluding Japanese | Download |
| `kokoro-82m-bf16` | About 212 MB | Same voices as Q8 | Download |
| `kokoro-1.0-q8` | About 933 MB | 54 voices; includes Japanese | Import a compatible GGUF |
| `kokoro-1.1-zh-q8` | About 255 MB | 100 Chinese and 3 English voices; experimental | Import a compatible GGUF |

The downloadable models support Chinese, American/British English, Spanish, French, Hindi, Italian, and Brazilian Portuguese. Version 1.1-zh uses different voice IDs from version 1.0.

### Generate speech

```sh
yovoice models download kokoro-82m-q8
yovoice generate --model kokoro-82m-q8 --speaker af_heart --text "Hello, welcome." --output hello.wav
```

Use `yovoice models list --json` to see available voice IDs. Language follows the selected voice. For Chinese, use `zf_xiaobei` with the official models or `zf_001` with version 1.1-zh.

The default chunk size is 64 characters. Adjust it with `--option 'text_chunk_size=120'` if needed; each chunk is still subject to the engine's phoneme limit.

Kokoro does not support voice cloning or text-guided emotion control. Keep the CLI package's `tools/` directory intact. Generation works offline after the engine and model are installed. Full multilingual models may take longer to load the first time.

## Music generation

Music projects in the desktop app use ACE-Step 1.5 Turbo (`ace-step-1.5-turbo-bf16`, about 10.1 GB) and need inference engine v0.9.1 or later.

- **Style**: a short description plus tags such as `city pop, warm synths, chill, female vocals`, up to 512 characters.
- **Lyrics**: mark sections with `[verse]`, `[chorus]`, `[bridge]` and so on, up to 4000 characters. Turn on Instrumental to generate music without vocals; your lyrics are kept.
- **Duration and language**: choose Auto or 10–300 seconds, and a vocal language that matches the lyrics.
- **Arrangement**: tempo (30–300 BPM), key and time signature are planned by the model unless you set them.

Upstream reports that a fully quantized Q8 ACE-Step package makes the planner produce a different song, so only the BF16 package is offered. Continuation, covers, repainting and stem extraction are not available yet.

## Licenses

OmniVoice weights are licensed under CC-BY-NC for non-commercial use. IndexTTS has a separate [model license](../web/public/model-license.txt). Check the model publisher's license before using generated speech commercially.
