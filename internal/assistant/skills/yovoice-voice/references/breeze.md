# Breeze TTS 2 (breeze-tts-2-q8 / -q4 / -bf16)

Apply with `update_work` {"id","settings":{...}}; only given fields change.

## Voice source: `voiceMode`
- `design` (default): `voiceDescription` (max 500 chars) describes the timbre, e.g. "清亮的年轻女声".
- `clone`: needs `voiceId` and the full exact `referenceText` of the reference audio (missing or wrong text makes the model read the reference into the output); `voiceDescription` then acts as a performance instruction (pace, emotion, tone).

## Plain parameters
- `seed` 0-2147483647 (-1 = random). Generic `speed`, `temperature`, emotion fields are NOT used.

## Advanced (`modelOptions` {"breeze_tts":{...}})
- `text_chunk_size` 20-600 (160): characters per segment; long segments drag or repeat, so keep it short. `text_chunk_mode` default/tag_aware/japanese/endline.
- `max_tokens` 50-1500 (900): per-segment cap (~72 s).
- `guidance_scale` 1-5 (1).
- Sampling: `temperature` .05-2 (.9), `depth_temperature` .05-2 (.9), `top_k` 1-200 (50), `top_p` .01-1 (1).

Streaming engines can set `stream_chunk_policy` (`grow` or `fixed`) and `stream_frames_per_event` (1–64). These options only apply when runtime streaming is enabled. Also accepts `stream_lookahead_margin` (0–64).
