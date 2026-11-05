# Qwen3-TTS (qwen3-tts-base-*, -customvoice-*, -voicedesign-*)

Apply with `update_work` {"id","settings":{...}}; only given fields change. The model name tells the variant:

- **base** (`qwen3-tts-base-*`, also the 0.6B ones): clones a reference voice. Needs `voiceId`; give `referenceText` (transcript) for the best match, without it only the speaker timbre is taken.
- **customvoice**: built-in speakers. `speaker` is one of Vivian, Serena, Uncle_Fu, Dylan, Eric, Ryan, Aiden, Ono_Anna, Sohee (default Vivian). `voiceDescription` can add a style instruction (e.g. "语气温柔，语速放慢").
- **voicedesign**: the voice is designed from `voiceDescription` (required, max 500 chars), e.g. "沉稳的中年男声，略带沙哑，讲故事的语气".

## Plain parameters
- `synthesisLanguage`: auto, zh, en, ja, ko, de, fr, ru, pt, es, it.
- `seed` 0-2147483647 (-1 = random). The generic `speed`, `temperature`, `topP`… top-level fields are NOT used; sampling goes through `modelOptions`.

## Advanced (`modelOptions` {"qwen3_tts":{...}})
- `text_chunk_size` 0-12000 (8192), `text_chunk_mode` default/tag_aware/japanese/endline, `max_tokens` 50-16384 (8192).
- Main sampler: `do_sample` (true), `temperature` 0.05-2 (.9), `top_k` 1-200 (50), `top_p` 0.01-1 (1), `repetition_penalty` 0.1-20 (1.05).
- Sub-talker (acoustic detail): `subtalker_do_sample` (true), `subtalker_temperature` .05-2 (.9), `subtalker_top_k` 1-200 (50), `subtalker_top_p` .01-1 (1).
Lower temperatures give steadier, flatter reads; raise them for livelier but riskier delivery.

Streaming engines can set `stream_chunk_policy` (`grow` or `fixed`) and `stream_frames_per_event` (1–64). These options only apply when runtime streaming is enabled.
