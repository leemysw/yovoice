# Ming 3.0 TTS 0.5B (ming3-tts-0.5b-q8 / -bf16)

Apply with `update_work` {"id","settings":{...}}; only given fields change. Requires audio.cpp v0.9.3. Output is mono 44.1 kHz.

## Voice source: `voiceMode`
- `design` (default): optional `voiceDescription` (max 500 chars) describes the voice. With a description, the request uses `template_name=voice_design` and `instruct`; without one, it uses ordinary TTS.
- `clone`: needs `voiceId`. `referenceText` (max 2000 chars) is optional: supply the exact transcript for an acoustic reference prefix, or leave it empty for speaker conditioning only. The design description is not used for cloning.

## Language and plain parameters
- `synthesisLanguage`: `auto` (default), `zh`, `en`, `ja`, `ko`, `de`, `fr`, `es`. Non-auto values are sent as the top-level language code.
- `seed` 0-2147483647 (-1 = random). Generic `speed`, `temperature`, emotion fields are NOT used.

## Advanced (`modelOptions` {"ming3_tts":{...}})
- `text_chunk_size` 0-12000 (0 = upstream automatic): 50 codepoints for predominantly CJK text, otherwise 300; automatically anchored multi-chunk output is capped at 120. Do not force a value unless tuning is needed.
- `text_chunk_mode` default/tag_aware/japanese/endline (`tag_aware`).
- `guidance_scale` 0-10 (2).
- `temperature` 0-2 (0): nonnegative flow sampling temperature; zero still uses seeded initial noise.
- `trim_silence` true/false (true): trim trailing low-energy frames per fragment while retaining a short tail.

Streaming engines can set `stream_chunk_policy` (`grow` or `fixed`) and `stream_frames_per_event` (1–64). These options only apply when runtime streaming is enabled.
