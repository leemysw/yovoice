# Kokoro

English · [简体中文](kokoro_zh.md)

Kokoro generates speech with built-in voices and does not require reference audio.

## Choose a model

| Model ID | Size | Voices and languages | Installation |
| --- | --- | --- | --- |
| `kokoro-82m-q8` | About 190 MB | 49 voices; multilingual, excluding Japanese | Download |
| `kokoro-82m-bf16` | About 212 MB | Same voices as Q8 | Download |
| `kokoro-1.0-q8` | About 933 MB | 54 voices; includes Japanese | Import a compatible GGUF |
| `kokoro-1.1-zh-q8` | About 255 MB | 100 Chinese and 3 English voices; experimental | Import a compatible GGUF |

The downloadable models support Chinese, American/British English, Spanish, French, Hindi, Italian, and Brazilian Portuguese. Version 1.1-zh uses different voice IDs from version 1.0.

## Generate speech

```sh
yovoice models download kokoro-82m-q8
yovoice generate --model kokoro-82m-q8 --speaker af_heart --text "Hello, welcome." --output hello.wav
```

Use `yovoice models list --json` to see available voice IDs. Language follows the selected voice. For Chinese, use `zf_xiaobei` with the official models or `zf_001` with version 1.1-zh.

The default chunk size is 64 characters. Adjust it with `--option 'text_chunk_size=120'` if needed; each chunk is still subject to the engine's phoneme limit.

Kokoro does not support voice cloning or text-guided emotion control. Keep the CLI package's `tools/` directory intact. Generation works offline after the engine and model are installed. Full multilingual models may take longer to load the first time.

Return to the [CLI guide](cli.md) or [model selection](models.md).
