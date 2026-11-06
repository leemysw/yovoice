# VoxCPM2 (voxcpm2-q8 / -bf16 / -orig)

Apply with `update_work` {"id","settings":{...}}; only given fields change.

## Voice source: `voxMode`
- `design` (default): no reference audio. `voiceDescription` (max 500 chars) is put in front of the text as a style prefix, e.g. "年轻女声，温柔，语速稍慢".
- `clone`: needs `voiceId`; `voiceDescription` can still steer style.
- `continuation` (精细克隆): needs `voiceId` and `referenceText` (exact transcript); the model continues the reference audio so its delivery is kept; `voiceDescription` is ignored.

## Plain parameters
- `guidanceScale` 0.5-5 (0 = default 2): stronger prompt adherence; `inferenceSteps` 0-50 (0 = default 10): more steps = finer, slower. `seed` 0-2147483647 (-1 = random).
- The generic `speed`, `temperature`, emotion fields are NOT used.

## Advanced (`modelOptions` {"voxcpm2":{...}})
- `text_chunk_size` 0-400 (200): characters per segment; keep it modest for long texts, very long segments drift and distort. `text_chunk_mode` default/tag_aware/japanese/endline (tag_aware).
- `voxcpm2.chunk_strategy`: `continuation` (default, each segment continues the previous) or `stateless`.
- `max_tokens` 50-4096 (4096) must be ≥ `min_tokens` 0-4096 (2).
- Retry of bad takes: `retry_badcase` (true), `retry_badcase_max_times` 1-10 (3), `retry_badcase_ratio_threshold` 0.1-20 (6).

Streaming engines can set `stream_chunk_policy` (`grow` or `fixed`) and `stream_frames_per_event` (1–64). These options only apply when runtime streaming is enabled. Also accepts `stream_left_context` (0–8).
