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
| Breeze TTS 2 | Chinese and English voice design, cloning, and voice direction | A description is optional for designed voices; cloning requires reference audio and its full transcript; a GPU is recommended |
| Ming 3.0 TTS | Voice design and cloning in 7 languages | A description is optional for design; cloning requires audio, with an optional transcript; requires engine v0.9.3 |
| Voxtral 4B TTS | 20 built-in voices in 9 languages | Speaker ID; no reference audio or cloning; CC BY-NC 4.0; requires engine v0.9.3 |
| Plapre 3 | Danish built-in voices and cloning | Speaker ID, or reference audio with an optional transcript; requires engine v0.9.3 |
| XTTS v2 | Voice cloning in 17 languages | 6–30 seconds of reference audio and an explicit language; Coqui Public Model License; requires engine v0.9.3 |
| Gradium Phonon | Lightweight English speech | Default voice only; no reference audio or cloning; requires engine v0.9.3 |
| Drama 3 / Drama3-small | Speaker/event tags, default voice and cloning | Cloning requires reference audio and its full transcript; Fish Audio Community License; requires engine v0.9.3 |
| Kokoro | Lightweight built-in voices | Speaker ID; no reference audio |

Use `yovoice models list --json` for model IDs, available precisions, file sizes, voices, and advanced parameter definitions. The app lists models in Settings. See the [CLI guide](cli.md) to download an engine and model.

## Import existing local models

In Settings → Voice models, Music models or Score sound fonts, choose the matching model/version and precision, then click **Import local model**. Select the audio.cpp GGUF file (or a supported catalog SF2); for a multi-file package select its main GGUF and keep the companion files in the package's original layout. Files remain at their existing location and the model download directory stays unchanged. Removing an imported model only unregisters it, preserving its files. Keep external drives connected while using their models.

Single-file imports check the GGUF header and model family and record the file's SHA-256. Locally converted GGUFs are accepted, but you must choose the correct version and precision; a matching family does not guarantee that every custom conversion is usable. Multi-file packages and SF2 imports must match the supported package checksums. Raw PyTorch (`.pth`, `.pt`, `.safetensors`) and MLX weights cannot run in the native audio.cpp engine directly: convert them with the matching upstream audio.cpp converter first. Importing does not install or run Python and does not convert weights automatically. Imported models use the same voice and advanced generation controls as downloaded models.

## Model files and hardware

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
| Breeze TTS 2 | ~3B | Q4 · 3.79 GB<br>Q8 · 5.08 GB<br>BF16 · 7.34 GB | Chinese and English voice design, cloning and voice direction; GPU recommended, requires the v0.9.1 engine |
| Ming 3.0 TTS | 0.5B | Q8 · 1.74 GB<br>BF16 · 3.00 GB | Voice design and cloning in Chinese, English, Japanese, Korean, German, French and Spanish; 44.1 kHz output; requires engine v0.9.3 |
| Kokoro-82M 1.0 Official | 82M | Q8 · 189.55 MB<br>BF16 · 211.95 MB | 49 built-in voices, multilingual speech excluding Japanese |
| Kokoro-82M 1.1-zh | 82M | Q8 · 255.32 MB | 100 Chinese and 3 English voices; experimental |
| ACE-Step 1.5 Turbo | — | Q8 · 6.19 GB<br>BF16 · 10.09 GB | Songs and instrumentals from a style prompt and lyrics, 50+ vocal languages; requires engine v0.9.1 |
| ACE-Step 1.5 XL Turbo | — | Q8 · 10.71 GB<br>BF16 · 15.28 GB | Larger ACE-Step model for higher-quality songs and instrumentals; requires engine v0.9.1 |
| Stable Audio 3 Small Music | — | Q8 · 1.68 GB<br>F16 · 2.36 GB | Instrumental music from an English description, up to 2 minutes; rework or inpaint an existing take; requires engine v0.9.1 |
| Stable Audio 3 Small SFX | — | Q8 · 1.68 GB<br>F16 · 2.36 GB | Sound effects from an English description, up to 2 minutes; rework or inpaint an existing take; requires engine v0.9.1 |
| Stable Audio 3 Medium | — | Q8 · 3.58 GB<br>F16 · 5.83 GB | Larger Stable Audio model for higher-quality, longer instrumentals (about 6 minutes); requires engine v0.9.1 |
| YuE2 3B | 3B | Q4 · 2.93 GB<br>Q8 · 4.53 GB<br>BF16 · 7.53 GB | Full vocal songs from lyrics and style, length follows the lyrics; instrumentals via a melody score; requires engine v0.9.1 |
| SheetSage2 | — | F32 · 2.71 GB | Transcribes a song's melody and chords into a score, used for YuE2 covers; requires engine v0.9.1 |
| HTDemucs 6-stem (optional) | — | Q8 · 42 MB<br>F16 · 55 MB | Splits a song into drums, bass, vocals, guitar, piano and other; requires engine v0.9.1 |
| MuScriptor Small (optional) | — | F32 · 412 MB | Transcribes a song into multi-instrument MIDI that opens as a score project; requires engine v0.9.1 |
| Lyric Aligner (optional) | 0.6B | Q8 · 1.30 GB | BS-RoFormer vocal separation plus Qwen3 Forced Aligner: aligns lyrics word by word to a generated song for the playback page and word LRC export; requires engine v0.9.1 |

| Use Case | Recommended Hardware | Recommended Models |
| --- | --- | --- |
| 🟢 **Lightweight & Blazing Fast** | Any CPU / 4 GB+ RAM | **Kokoro-82M** (only 189 MB Q8, millisecond latency, runs great on CPU) |
| 🟡 **High-Fidelity Voice Cloning** | 4 GB – 6 GB VRAM / 8 GB+ Apple Silicon | **VoxCPM2** (2B, 48 kHz), **IndexTTS 2.0/2.5**, **Qwen3-TTS** |
| 🔴 **Full Song & Music Generation** | 12 GB+ VRAM / 16 GB+ Apple Silicon | **ACE-Step 1.5 Turbo** (Q8 6 GB / BF16 10 GB), **ACE-Step 1.5 XL Turbo**, **YuE2 3B** |

## Voice cloning

```sh
yovoice generate --model index-2.5-q8 --text-file narration.txt --reference voice.wav --output index.wav
yovoice generate --model voxcpm2-q8 --text-file narration.txt --reference voice.wav --reference-text "The exact words spoken in the recording." --output vox.wav
yovoice generate --model omnivoice-q8 --text-file narration.txt --reference voice.wav --reference-text "The exact words spoken in the recording." --output omni.wav
yovoice generate --model qwen3-tts-base-0.6b-q8 --text-file narration.txt --reference voice.wav --output qwen.wav
yovoice generate --model breeze-tts-2-q8 --text-file narration.txt --reference voice.wav --reference-text "The exact words spoken in the recording." --voice-description "Slightly faster, relaxed tone" --output breeze.wav
yovoice generate --model ming3-tts-0.5b-q8 --text-file narration.txt --reference voice.wav --reference-text "The exact words spoken in the recording." --language en --output ming.wav
```

For VoxCPM2, omit `--reference-text` for ordinary cloning. For Qwen3-TTS Base, adding an accurate transcript enables transcript-guided cloning. OmniVoice and Breeze TTS 2 cloning always require a matching transcript. For Breeze, `--voice-description` acts as voice direction when cloning: it keeps the voice and steers pace, emotion and tone. Ming 3.0 TTS accepts an optional transcript: include it for an acoustic reference prefix, or omit it to condition only on the reference speaker.

Use a clear recording with one speaker and little background noise. Reference audio must be 1 second to 10 minutes and no larger than 20 MB; recordings over 60 seconds are trimmed automatically to their clearest 5–15 seconds.

## Voice design and built-in voices

```sh
yovoice generate --model voxcpm2-q8 --voice-description "A warm, calm adult narrator" --text-file narration.txt --output vox-design.wav
yovoice generate --model omnivoice-q8 --voice-description "female, young adult, moderate pitch" --text-file narration.txt --output omni-design.wav
yovoice generate --model breeze-tts-2-q8 --voice-description "A warm female voice, steady pace, clear diction" --text-file narration.txt --output breeze-design.wav
yovoice generate --model ming3-tts-0.5b-q8 --voice-description "A warm, calm adult narrator" --language en --text-file narration.txt --output ming-design.wav
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

VoxCPM2 generates autoregressively at 6.25 frames per second. When one chunk runs too long, the voice drifts or breaks into noise, and pitch and loudness slowly sag within the chunk. YoVoice defaults to 200 characters per chunk with a 400-character limit. The default continuation strategy feeds the previous chunk into the next to keep transitions smooth; when cloning, set the long-text strategy to `stateless` to anchor every chunk directly on the reference audio.

OmniVoice supports `--speed`, `--language`, `--guidance-scale`, and `--inference-steps`. Sound tags such as `[laughter]` and `[sigh]` can be inserted into the text. Qwen3-TTS supports `--language auto|zh|en|ja|ko|de|fr|ru|pt|es|it`.

Ming 3.0 TTS supports `--language auto|zh|en|ja|ko|de|fr|es`, with `guidance_scale`, `temperature`, `trim_silence` and long-text chunking under Advanced settings. By default, CJK text is chunked at 50 codepoints and other text at 300; later chunks without reference audio keep the first chunk's voice. YoVoice does not override the chunk size.

### Breeze TTS 2 and dragging speech

Breeze TTS 2 sounds very natural, but its autoregressive decoder tends to drag, repeat, or trail off into long silence in the cases below. YoVoice adjusts its defaults accordingly:

- **Chunks that are too long.** The model generates 12.5 frames per second with a 2048-frame official context. audio.cpp defaults to 600-character chunks and a 1500-frame (120 s) cap, so long Chinese chunks exceed the training length. YoVoice defaults to 160-character chunks and a 900-frame (about 72 s) cap per chunk; adjust `text_chunk_size` and `max_tokens` under Advanced settings.
- **Non-bf16 inference.** The official implementation runs in bf16; fp32 activations drift into mispronunciation and repetition. YoVoice turns on the bf16 reference path on CUDA, Vulkan and Metal (about 20% slower on Metal). The CPU backend cannot use it and drags more often on long text, so a GPU is recommended.
- **Reference audio and transcript.** Use 5–15 seconds of clean, non-looping speech without background noise, and a word-for-word transcript, including any repeats.
- **Tuning order.** If it still drags, shorten chunks first (for example 80–120 characters), then lower `temperature` to 0.6–0.8. Raise `guidance_scale` to 3–4 to follow the description more closely (roughly doubles generation time). Describe pace and emotion in the same language as the text, for example "slightly faster, relaxed tone".

For long text without reference audio, the v0.9.1 engine picks a voice for each chunk separately, so the voice may change between chunks. For a stable voice, design one on a short line, save it as a voice, and clone from it.

The app shows supported options under Advanced settings. The CLI accepts repeated `--option KEY=JSON` values; query `models list --json` for each model's supported keys and limits:

```sh
yovoice generate --model qwen3-tts-customvoice-q8 --speaker Ryan --text-file narration.txt --option 'temperature=0.7' --option 'text_chunk_size=512' --output advanced.wav
```

## Additional TTS families

### Voxtral 4B TTS

Q8 (4.72 GB, default) and BF16 (8.03 GB) packages provide 20 embedded voices across 9 languages. Select one with `--speaker`, defaulting to `casual_male`; reference-audio cloning is unavailable. Advanced options are `num_inference_steps`, `guidance_scale`, `max_tokens`, and `text_chunk_size`. Model weights and preset voices use CC BY-NC 4.0.

```sh
yovoice generate --model voxtral-tts-4b-q8 --speaker fr_female --text "Bonjour." --output voxtral.wav
```

### Plapre 3

Plapre generates Danish speech at 24 kHz. BF16 (1.15 GB, default) and F32 (2.28 GB) are available. Use `--speaker tor|ida|liv|ask|kaj`, or clone with reference audio and an optional exact transcript. Advanced options cover sampling, inter-chunk silence and text chunking.

```sh
yovoice generate --model plapre-3-bf16 --speaker tor --text "Hej." --output plapre.wav
yovoice generate --model plapre-3-bf16 --voice-mode clone --reference voice.wav --reference-text "Ordene i referenceoptagelsen." --text "I morgen kommer jeg igen." --output plapre-clone.wav
```

### XTTS v2

XTTS supports 17 languages and requires 6–30 seconds of reference audio. Q8 (0.57 GB, default), Q4_K_M (0.37 GB), and Original (1.75 GB) are multi-file packages containing GPT, vocoder, and normalization data. Set `--language en|es|fr|de|it|pt|pl|tr|ru|nl|cs|ar|zh-cn|hu|ko|ja|hi`; the default is `zh-cn`. Advanced options include sampling, repetition penalty, and text chunking. Weights use the Coqui Public Model License.

```sh
yovoice generate --model xtts-v2-q8 --reference voice.wav --language en --text "Hello from XTTS." --output xtts.wav
```

### Gradium Phonon

The English Q8 package (85.5 MB) contains the model and its default voice. It does not clone voices. Advanced settings expose only `temperature` and `text_chunk_tokens`, plus `seed`.

```sh
yovoice generate --model gradium-phonon-31m-en-q8 --language en --text "Hello from Phonon." --output phonon.wav
```

### Fish Audio Drama 3

Drama3-small IQ3_XXS (10.46 GB, default), Drama 3 Q2_K (17.05 GB), and Q4_K_S (24.60 GB) share one family. The default voice needs no reference. Cloning requires audio and its full transcript. Text accepts `<|speaker:0|>` through `<|speaker:15|>` and event tags such as `[laughs]` and `[sighs]`. Advanced options are `top_p`, `temperature`, `max_tokens`, and `text_chunk_size`. CUDA performance-first mode enables `fish_drama3.perf_mode=cuda_perf`; disk-backed and CPU expert offload remain opt-in. Weights use the Fish Audio Community License.

```sh
yovoice generate --model fish-drama3-small-iq3 --text "<|speaker:0|>Hello. [laughs]" --output drama.wav
yovoice generate --model fish-drama3-small-iq3 --voice-mode clone --reference voice.wav --reference-text "The exact reference transcript." --text "<|speaker:0|>A cloned take." --output drama-clone.wav
```

## Kokoro

Kokoro generates speech with built-in voices and does not require reference audio.

### Choose a model

| Model ID | Size | Voices and languages | Installation |
| --- | --- | --- | --- |
| `kokoro-82m-q8` | About 190 MB | 49 voices; multilingual, excluding Japanese | Download |
| `kokoro-82m-bf16` | About 212 MB | Same voices as Q8 | Download |
| `kokoro-1.1-zh-q8` | About 255 MB | 100 Chinese and 3 English voices; experimental | Download |

The official models support Chinese, American/British English, Spanish, French, Hindi, Italian, and Brazilian Portuguese. Version 1.1-zh uses different voice IDs from version 1.0.

The first Kokoro download also fetches the pronunciation libraries (eSpeak NG and MeCab, about 10 MB) from PyPI, or from the Aliyun PyPI mirror when the download source is ModelScope or the mirror. They are shared by all Kokoro models.

### Generate speech

```sh
yovoice models download kokoro-82m-q8
yovoice generate --model kokoro-82m-q8 --speaker af_heart --text "Hello, welcome." --output hello.wav
```

Use `yovoice models list --json` to see available voice IDs. Language follows the selected voice. For Chinese, use `zf_xiaobei` with the official models or `zf_001` with version 1.1-zh.

The default chunk size is 64 characters. Adjust it with `--option 'text_chunk_size=120'` if needed; each chunk is still subject to the engine's phoneme limit.

Kokoro does not support voice cloning or text-guided emotion control. Keep the CLI package's `tools/` directory intact. Generation works offline after the engine and model are installed. Full multilingual models may take longer to load the first time.

## Music generation

Music projects in the desktop app use ACE-Step 1.5 Turbo or XL Turbo for songs and instrumentals, YuE2 3B for songs and score-based instrumentals, or Stable Audio 3 for instrumental music. The separate Sound effects tab uses Stable Audio 3 Small SFX or Medium with an English description and short duration presets (default 5 seconds). All need inference engine v0.9.1 or later.

- **Style**: a short description plus tags such as `city pop, warm synths, chill, female vocals`, up to 512 characters.
- **Lyrics**: mark sections with `[verse]`, `[chorus]`, `[bridge]` and so on, up to 4000 characters. Turn on Instrumental to generate music without vocals; your lyrics are kept.
- **Duration and language**: choose Auto or 10–300 seconds, and a vocal language that matches the lyrics.
- **Arrangement**: tempo (30–300 BPM), key and time signature are planned by the model unless you set them.

Stable Audio 3 (Small Music, Small SFX, Medium) generates instrumental music or sound effects from an English description only; there are no lyrics or vocal language. Small models make up to 2 minutes and Medium up to about 6 minutes (default 30 seconds). Under **Generation mode** you can also start from an existing take of the same work:

- **Rework**: regenerates the whole take with the new description; *Amount of change* (0–1) keeps lower values closer to the original.
- **Inpaint**: regenerates only the chosen time range and keeps the rest of the take.

Stable Audio 3 weights use the Stability AI Community License: free while your yearly revenue stays under USD 1M.

YuE2 needs lyrics for a vocal song, and the song length follows the lyrics. It can also work from an editable melody score:

- **Write melody score**: YuE2 first writes the vocal melody and chords for the lyrics as an ABC score, without singing yet. Review it as tracks or as ABC text, change the tempo, keep only the melody, import an `.abc` file, or ask the assistant to rewrite it (an AI provider is required). Generating then follows the score: with chords YuE2 keeps your harmony, with melody only it arranges the accompaniment freely.
- **Extract from a song (cover)**: with SheetSage2 installed, pick a song up to 10 minutes long. Its melody is transcribed into a score, the original chords are dropped, and YuE2 re-sings it in your style with your lyrics. The original singer's voice and phrasing are not kept.
- **Instrumental**: YuE2 writes a score first, then gives the vocal melody to instruments, keeping the chords, tempo and key. Lyrics are optional; section markers such as `[Verse]` and `[Chorus]` shape the structure. An existing score is converted the same way, and the melody score menu can convert it in place.
- **Generation**: *From score* follows the score (or writes one first); *Free* skips the score and generates directly, with no editable score. Advanced settings expose the inference steps and the score and audio sampling parameters.
- Every take stores the score it used; reusing a version restores it.
- **LoRA**: under advanced settings, import a YuE2 `.safetensors` LoRA (or LoKr) and pick it for the composition stage (melody and arrangement style) or the timbre stage (sound and vocal texture), each with its own strength. Files are copied into the data folder, so moving the original does not break a project; changing the LoRA restarts the engine.

On the playback page, lyric timing starts from the vocals detected in the mix and can be synced line by line. With the optional Lyric Aligner installed, **Auto-align** separates the vocals, drops interludes and long pauses, and aligns every word of the lyrics to the singing (songs up to 20 minutes; the aligner handles about 100 seconds of singing at a time, so longer songs are aligned in groups of lines split at pauses in the vocals, and re-aligning the same version reuses the separated vocals); the result is saved with the version, and the newest of auto-align and manual sync wins. Words that are still off can be fixed under **Lyric tools › Adjust lyric timing**: while playing, click a line to anchor it to the playhead, or move the whole line earlier or later (shifting the following lines along, or this line only); single words can be dragged on the timeline or tapped along while listening. All of these live in the **Lyric tools** menu at the top of the playback page.

With HTDemucs 6-stem installed, **Separate stems** in a music version's menu splits it (up to 10 minutes) into drums, bass, vocals, guitar, piano and other; each stem is saved as a version of the same project next to the original, so it can be played, exported or added to the timeline. With MuScriptor installed, **Transcribe to MIDI** turns a version into a new score project with one track per instrument, which you can edit and render with a sound font.

Continuation and repainting are not available yet.

## Score sound font

Score projects and `yovoice score render` use the MuseScore General sound font (`musescore-general-sf2`, SF2 · about 216 MB) with all 128 General MIDI instruments and drum kits; GeneralUser GS (`generaluser-gs-sf2`, about 32 MB) and SGM-V2.01 (`sgm-v2-sf2`, about 247 MB) are optional alternatives. No inference engine is needed. See [Score](score.md).

## Licenses

OmniVoice weights are licensed under CC-BY-NC and YuE2 weights under CC BY-NC 4.0, both for non-commercial use only. MuScriptor weights are CC BY-NC as well; HTDemucs is MIT. Breeze TTS 2 weights use the [BreezeBlue Research and Non-Commercial License](https://huggingface.co/BreezeBlue/Breeze-TTS-2), and generated speech is not licensed for commercial use either. IndexTTS has a separate [model license](../web/public/model-license.txt). Check the model publisher's license before using generated speech commercially.
