# Audio8 TTS Realistic 0.6B (audio8-tts-0.6b-q8 / -bf16)

Apply with `update_work` {"id","settings":{...}}. Requires audio.cpp v0.9.3. Output is 44.1 kHz.

- `voiceMode=design` (default): packaged default voice; do not set `voiceId`.
- `voiceMode=clone`: requires `voiceId` and a nonempty `referenceText` (max 2000 chars) containing the exact full transcript.
- Language is detected from the text: Cantonese, Mandarin, English, Japanese, Korean, German, French, Spanish, Italian, Dutch and Polish. Do not set `synthesisLanguage`.
- `seed`: 0-2147483647; omit or -1 for random. Generic speed and emotion fields are not used.

Advanced (`modelOptions` {"audio8_tts":{...}}): `temperature` 0.05-1.95 (0.8), `top_p` 0.01-1 (0.8), `top_k` 1-200 (30), `max_tokens` 1-4096 (1024, semantic steps per chunk), `text_chunk_size` 1-12000 (200 characters per chunk). Lower `temperature` for steadier delivery; shorter `text_chunk_size` when long passages drift.
