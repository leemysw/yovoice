# IndexTTS (index-2.5-*, index-2-*)

Always clones a reference voice: the work (or story speaker) needs `voiceId` (from `list_voices`). Everything below goes in `update_work` {"id","settings":{...}}; only given fields change.

## Where the voice comes from: `mode`
- `speaker`: voice only, no emotion control.
- `reference`: emotion copied from another reference audio, `emotionVoiceId`, scaled by `emotionStrength` (0-1).
- `vector`: `emotions` = 8 numbers 0-1 in this order: happy, angry, sad, afraid, disgusted, down, surprised, calm. Scaled by `emotionStrength`; `randomEmotion` adds variation.
- `text`: either `inferEmotion` true (emotion read from the text) or `emotionText` (e.g. "温柔、平静，像是在和熟悉的人说话。", max 500 chars); `emotionStrength` and `randomEmotion` apply.

## Plain parameters (top-level fields of `settings`)
- `language`: `zh` or `en`; IndexTTS 2.5 also `ja`, `es`, `ar`.
- `speed` 0.5-2 (1 = normal), `temperature` 0.05-2 (default .8), `topP` 0.01-1 (.8), `topK` 1-200 (30), `repetitionPenalty` 0.1-20 (10), `maxTokens` 50-4000 (1500), `intervalSilenceMs` 0-2000 (200 between sentences), `doSample` (true), `numBeams` 1-10 (3), `lengthPenalty` -2..2 (0), `seed` 0-2147483647 (-1 = random each time).

## Advanced (`modelOptions` {"index_tts2":{...}})
- `text_chunk_size` 0-12000: characters per segment, 0 = automatic.
- `text_chunk_mode`: `default`, `tag_aware`, `japanese`, `endline`.

- `max_text_tokens_per_segment`: 1–600, default 120. Requires a runtime that advertises it.
- `text_normalization`: IndexTTS 2.5 only, defaults to true; disable to keep the raw text. Requires a runtime that advertises it.

Tips: for a calmer read lower `temperature` and `emotionStrength`; for steadier repeat takes fix the `seed`; `intervalSilenceMs` controls pauses, not `speed`.
