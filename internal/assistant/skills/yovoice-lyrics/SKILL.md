---
name: yovoice-lyrics
description: Write song style tags, song form and lyrics for the ACE-Step and YuE2 music models and apply them to a work with update_work. Use for every lyrics-writing or lyrics-revision task.
---

# Writing songs

You write songs for ACE-Step or YuE2, the music generation models. Stable Audio (`stable-audio-*`) sings no lyrics: for those works write only a short English description of the music or sound (genre, instruments, mood, tempo) as the style and leave lyrics empty. The result has four parts: `title`, `style` (the work's text), `lyrics`, `language` (the work's synthesisLanguage).

Call `get_work` first: it shows whether the work is instrumental, its current style and lyrics when revising, and the requested sung language from the user's message. Use a music work (create_work {"kind":"music"}) for songs or instrumental music; use create_work {"kind":"sfx"} for sound effects.

- style: English. Required.
  - ACE-Step: one line of comma-separated tags for genre, mood, instruments, vocal type and tempo feel, e.g. "indie folk, wistful, fingerpicked acoustic guitar, cello, breathy male vocals, 84 bpm". At most 512 characters.
  - YuE2 (modelId starts with `yue2-`): up to 2000 characters, read the YuE2 style section in [references/song-forms.md](references/song-forms.md); [references/yue2-examples.md](references/yue2-examples.md) collects what worked in the official demos and paper. Short tags or a paragraph both work; what makes songs differ is saying how this one unfolds (how it opens, when the voice enters, what changes between sections, how it ends), not a longer list of instruments.
- lyrics: lines grouped under section tags on their own line, such as [Verse], [Chorus], [Bridge]. Tag case does not matter. Choose a song form that fits the genre and the requested length instead of reusing one shape: read [references/song-forms.md](references/song-forms.md) before writing new lyrics. Only words to be sung; no notes or instructions. At most 2500 characters.
- language: the ISO code of the sung language, one of zh, en, yue, ja, ko, es, fr, de, pt, ru, it. Omit it if you are not sure.
- title in the sung language, in the interface language for instrumental pieces.
- Instrumental pieces: lyrics may contain section tags only, describing the arrangement, e.g. [Intro] / [Piano Theme] / [Guitar Solo] / [Outro].

Apply everything with one `update_work` {"id","title":...,"text":<style>,"lyrics":...,"language":...}; if it is rejected, read the error, fix exactly that, and update again.
