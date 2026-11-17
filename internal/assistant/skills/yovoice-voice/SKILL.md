---
name: yovoice-voice
description: Voice settings in the right-hand inspector of text and story works (model, voice source, voice design, emotion, speed, sampling, modelOptions), per model. Use when the user wants to change how a voice sounds or tune a model's parameters.
---

# Voice settings (声音设置)

Everything in the inspector is edited with `update_work` {"id","settings":{...}}; only given fields change, and out-of-range values are rejected with the reason. For one story speaker use `speakerSettings` [{"speaker","settings":{...}}].

Fields, ranges, voice-source modes and `modelOptions` differ per model. Read only the reference for the work's model, `references/<name>.md` in this skill's directory (from the workspace: `.agents/skills/yovoice-voice/references/<name>.md`), found by the prefix of its `modelId` (`get_work`):

| modelId prefix | name |
| --- | --- |
| `index-` | `indextts` |
| `omnivoice-` | `omnivoice` |
| `qwen3-tts-` | `qwen3-tts` |
| `voxcpm2-` | `voxcpm2` |
| `breeze-tts-` | `breeze` |
| `ming3-tts-` | `ming3_tts` |
| `voxtral-tts-` | `voxtral_tts` |
| `plapre-` | `plapre` |
| `xtts-v2-` | `xtts_v2` |
| `gradium-phonon-` | `gradium_phonon` |
| `fish-drama3-` | `fish_drama3` |
| `audio8-tts-` | `audio8_tts` |
| `kokoro-` | `kokoro` |

When switching the work to another model, read that model's reference before setting its fields; fields the new model does not use are ignored.
