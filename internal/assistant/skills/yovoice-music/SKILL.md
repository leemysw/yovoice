---
name: yovoice-music
description: YuE2 songs and instrumentals in yovoice — melody scores (write, extract from a song, edit, convert to instrumental), generation mode, and musical edits such as reharmonizing, changing style or lyrics while keeping the melody. Use whenever a music work uses a yue2- model.
---

# YuE2 music (YuE2 音乐)

YuE2 renders a song from a style prompt, lyrics and, optionally, a two-voice melody score (`abc` field: `Vocal` with chords, `Ins` instrumental melody). Call `get_work` first: `text` is the style, `settings.lyrics` the lyrics, `settings.abc` the score, `settings.instrumental` the instrumental switch, `settings.modelOptions.yue2` the generation settings.

## Style and lyrics

- Style in English tags, in this order: sung language, genre, instruments, vocal character, mood, tempo — e.g. `English, warm piano pop, expressive female voice, acoustic piano, light drums, unhurried phrasing, 88 BPM`. Put tempo and meter in the score too and keep them consistent.
- Lyrics: section tags on their own lines (`[Verse]`, `[Chorus]`, `[Bridge]`, `[Outro]`) followed by the sung words. Only words to be sung; no notes or instructions. Song length follows the lyrics.

## Pick the workflow

| Request | What to do |
| --- | --- |
| A song in score mode (the default: `cot` is not `off`, or instrumental) | `update_work` style + lyrics → `plan_melody` → `get_generation_status` until `melody` appears → `update_work` {"abc": melody.abc}. Then stop and ask the user to review: the score is in the 旋律谱 section, where they can read it and press 试听 (listen). Call `generate_work` only after they approve or ask for changes you have made. `generate_work` refuses a score-mode YuE2 work without a score. |
| The user explicitly wants to skip reviewing the score (直接生成) | `generate_work` {"id","withoutScore":true}: YuE2 writes the score itself while singing, and it is filled into the work afterwards. |
| Free mode (`cot` is `off`) | `update_work` style + lyrics, then `generate_work`; there is no score to review. |
| Cover a song (翻唱) | `cover_melody` {"id","path"} with a local audio file (needs SheetSage2; propose installing it otherwise) → apply its `melody.abc` → new style and lyrics → `generate_work`. Keeps the melody, not the singer's voice. |
| Instrumental (纯音乐) | `update_work` {"instrumental": true}; lyrics optional (section tags only). Write and review the score first as in the first row; generating moves the vocal melody to Ins and plays it. `transform_melody` {"op":"instrumental"} converts the stored score in place. |
| Skip the score | `update_work` settings `{"modelOptions":{"yue2":{"cot":"off"}}}`; the take then has no editable score. `"auto"` goes back to score-based generation. |
| Keep the melody, let YuE2 re-arrange | `transform_melody` {"op":"stripChords"}. Change the tempo with {"op":"tempo","tempo":96}. |
| Change harmony, style, lyrics or structure | Read [references/editing.md](references/editing.md) first. |
| Write or fix notation | Read [references/abc-dialect.md](references/abc-dialect.md) before writing any ABC. |

Reference files are in this skill's folder (from the workspace: `.agents/skills/yovoice-music/references/`); read only the one the task needs.

## Settings

`modelOptions.yue2`: `cot` (`auto` | `full` | `melody` | `off`; auto picks full with chords, melody without), `num_inference_steps` 1-64 (8; more steps can sound cleaner but take longer), `abc_temperature` 0.05-2 (0.7, score writing), `abc_top_p` 0.01-1 (0.95), `abc_top_k` 1-500 (100), `abc_repetition_penalty` 0.5-3 (1.2), `semantic_temperature` 0.05-2 (1.0), `semantic_top_p` 0.01-1 (0.95), `semantic_top_k` 1-500 (100), `semantic_repetition_penalty` 0.5-3 (1.2). Change them only when asked; the defaults are the tuned route.

## Stable Audio sound effects

For an `sfx` work, write `text` as a concrete English description of the sound source and its action, not a music style. Include useful spatial distance or indoor/outdoor placement and the materials involved, for example: `a heavy wooden door closing in a small tiled hallway, close microphone, short natural reverberation` or `rain hitting a metal roof outdoors, distant traffic far behind`. Request 1–30 seconds. Avoid genre, band, melody, tempo, singing and other music-style wording. Small SFX is best for short effects; Medium trades a larger model for a better balance of duration, detail and quality.

## Be honest about results

YuE2 follows a score loosely: it does not guarantee every note, exact timing, or that an instrument named in the style is absent. A valid score or a finished take is not proof it sounds right; say what you changed and invite the user to listen. Every edit becomes a new take; earlier takes stay in the history for comparison.
