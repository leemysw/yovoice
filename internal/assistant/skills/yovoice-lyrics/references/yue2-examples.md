# YuE2 in practice: what the official demos and paper show

A study sheet distilled from the YuE2 paper (arXiv 2609.33757), the 65 score-planned demos on https://map-yue2.github.io and its agentic-editing walkthrough. Read it for ideas when writing or revising a YuE2 song. These are patterns that worked, not templates: combine them, bend them to the user's idea, and never copy the demo lyrics.

## What the paper measured

- Planning helps. With the same checkpoint and prompts, experts preferred songs that first wrote a score (49.3% of judgements) over songs without one (34.6%).
- The score is the composition. A finished song matches its own score's melody at 0.95 similarity and another score written for the same prompt at only 0.22. A different tune, opening or form comes from a new or edited score; the style dresses the score in instruments, voice and production.
- Score edits are followed and the rest stays. Edited notes hit the target pitch 84% of the time, chord edits 80%, rhythm edits 73%, key changes 91/100, tempo 96%, while unedited melody and harmony stay 90–94% intact. Local edits are a reliable tool, not a gamble.
- Planned melodies develop motifs: a low–low–high–high verse figure changes its intervals on each repeat, then returns an octave higher with longer held endings in the chorus. Without planning the verse repeated one figure four times. See "Develop a motif" in the yovoice-music editing reference.
- Takes differ. The benchmark picked the best of 2 or of 8 candidates. Listening to more than one take (or score) is part of the process, not a failure.

## What the 65 planned demos look like

| Aspect | Range in the demos |
| --- | --- |
| Tempo | 68–196 BPM, about 120 in the middle; fast songs are common |
| Meter | 4/4 (55) or 2/4 (10); the score writer did not produce 3/4 or 6/8 |
| Key | 39 minor, 26 major |
| Voice entry | from 0 s (cold open) to 57 s, typically 10–25 s |
| Sections in the score | 4–14; the writer adds intro and interlude sections on its own |
| Length | 1.5–6 minutes |
| Style length | from one word (`funk`) to about 1000 characters |
| Section tags in lyrics | about a quarter use none at all |

Languages: Mandarin, English, Japanese, Korean, Spanish, Russian. Genres range from barbershop and bluegrass to Ethio-jazz, grime and cyber metal.

## Patterns worth borrowing

**Narrate the arrangement over time.** Japanese easy listening, 85 BPM, D#m, voice at 23 s:
`A gentle and melancholic piece beginning with a delicate piano melody and a breathy, expressive flute line. A soft, clear female vocal enters, singing in a gentle, almost lullaby-like style. The arrangement gradually builds, introducing a subtle, downtempo lo-fi hip-hop beat with a soft kick and snare, complemented by a warm bassline and atmospheric synth pads. … The song concludes with a beautiful instrumental outro featuring the piano and flute, fading into silence.`
Lyrics: `[Intro: Piano & Flute]` → Verse 1 (4) → Verse 2 (4) → Chorus (4) → `[Instrumental Break: Piano, Flute, Drums]` → Verse 3 → Verse 4 → Chorus → `[Outro: Piano & Flute]`. Two verses before each chorus, instrumental tags with no words.

**Give each section a role in the style.** Alternative metal, 100 BPM:
`Male lead vocal — expressive, powerful, and slightly gritty. Verses combine melodic rap and atmospheric spoken delivery; choruses are sung with intensity and emotional depth. … Include a short guitar solo or synth break before the final chorus.`
Tags repeat it: `[Verse 1 – Melodic Rap / Spoken Rhythmically]`, `[Pre-Chorus – Sung softly]`, `[Chorus – Big emotional hook]`, `[Final Chorus – Full power, layered vocals]`, `[Outro – Piano + fading echo]`.

**Cast a duet through the tags.** Spanish flamenco–rap, 2/4, 95 BPM:
`flamenco gipsy female vocals, deep male spanish rap voice, hip hop beat with cajón and bass, flamenco guitar, palmas, 95 bpm, joyful energy, … no melancholy, festive rhythm, call and response vocals …`
Tags: `[Intro – female flamenco vocals, slow compás, soft palmas]` → `[Beat drops – male rap enters, groovy hip-hop rhythm]` → `[Chorus – female flamenco vocals, hand claps]` → `[Verse 2 – male rap with female ad-libs]` → `[Female ad-libs – flamenco "jaleos" style]` (one line) → `[Bridge – vocal duel, call & response]` → `[Final Chorus – both voices together]` → `[Outro – slow fade with guitar and cajón]`.

**Open cold.** Three demos start singing at 0 s:
- Japanese dance-punk, 130 BPM: a 7-line chant intro (`Cha-cha-cha…`, `Don't stop`) instead of an instrumental one, then verse, pre-chorus, chorus; later `[Guitar Solo]`, `[Vocal ad-libs]`, `[Breakdown]` before the last chorus. Style: `opens with layered, atmospheric female vocal chops … rap-like sections, a more melodic and atmospheric bridge, and a powerful build-up leading to a final, anthemic chorus.`
- Mandarin dance-pop, 122 BPM: no intro tag, the lyrics start at `[Verse 1]`; the chorus is 9 lines and the outro reuses its hook.
- Korean emo hip-hop, 170 BPM: no intro tag; the style still asks for `a lonely acoustic guitar intro transitioning into an explosive chorus`.

**Describe the sound like a producer.** Mandarin R&B, 98 BPM: a 977-character sheet of textures, e.g. `Intro starts with a clear and emotional lead synth melody, simple and memorable … tight punchy kick, natural snare with soft room reverb, minimal hi-hat pattern, smooth R&B bounce … high-frequency bell-like pluck synth in the background … wide atmospheric pads with slow attack … minimal and clean arrangement, layered but spacious`. Useful when the user cares about the production more than the form.

**Constrain by absence.** Barbershop, 2/4, 90 BPM: `Four male harmony voices (lead, tenor, baritone, bass). Playful swing rhythm, finger snaps, bright close chords … No instruments.` Also `no melancholy`, `no guitars`.

**Say very little.** `funk`, `1980s pop, classic rock`, `dance, female vocals`, `ballad, Blues` all produced full songs; YuE2 picks the arrangement. A good choice when the user wants surprise or you want to hear what the model does with the lyrics alone.

**Plan instrumental moments.** Mandarin big-band Christmas swing, 134 BPM: `[Intro - Big Band Fanfare]`, `[Instrumental Break - Horns]`, `[Instrumental Break - Piano & Horns]`, `[Final Instrumental Flourish]`, with the style naming them: `a brief, reflective bridge, and a short, playful chiptune-style synth break before a grand finale with a classic big band flourish.`

**Expect half and double time.** A grime prompt asking for 130–140 BPM came out as 2/4 at 70, which feels the same; a 155 BPM metal prompt came out at 93. Check `Q:` in the planned score.

## The official editing walkthrough ("The Last Train")

One Mandarin song, revised step by step with an agent; each step kept the previous take for comparison.

1. Generate: style `Mandarin, contemporary acoustic pop, warm expressive female lead vocal, clear Mandarin diction, piano, clean electric guitar, melodic electric bass, tight acoustic drums, bright singable chorus, intimate verses, hopeful bittersweet mood, polished studio recording, 4/4, 96 BPM`. Lyrics: Verse 1 (4) → Pre-Chorus (2) → Chorus (4) → Verse 2 → Pre-Chorus → Chorus → Bridge (2) → Final Chorus → Outro (2), lines of two balanced halves (`末班车的窗 映着你的脸`).
2. Reharmonize: keep melody and lyrics, swap pop chords for major and minor ninths and dominant thirteenths, change the style to vocal jazz. Two comparison takes rendered alongside: the old score with only the new style, and the melody without chords so YuE2 arranges freely.
3. Arrange: "no guitar, more swing": style lists exactly who plays (`voice accompanied only by piano, double bass and drums, no guitars, medium swing, loose triplet feel, relaxed behind-the-beat vocal phrasing`), tempo to 104, small rhythmic loosening of the melody, plus an original-melody comparison.
4. Quote a tune in the bridge, then reshape: slow to 88 BPM, rewrite the bridge lyric to prepare the quotation, give the interlude to tenor saxophone, and say it in the style (`the singer rests during the instrumental saxophone solo`).
5. Develop and correct: the first quotation only repeated the opening; the user gave the full tune by scale degrees and the agent wrote all six phrases. Listen for what is actually there, not what the score intended.
6. Recolor: a second statement with chromatic bass, tonicizations, tritone substitutions and brief 3/4 bars, with the style naming them (`mostly 4/4 with brief 3/4 transitions as written`).
7. Refine: English lyrics fitted to the notes (syllables, stress, open vowels on held notes), chord clashes under long notes repaired, then two phrasing passes. The researcher picked the final take by ear.

Lessons: change one thing at a time and keep a comparison; the style always restates what the score does; the user's ear decides.

## Using this

Pick the patterns that serve the user's idea: a duet wants cast tags, a dance track a cold open and a breakdown, a lullaby a narrated build. Mixing two of them often gives something no single demo has. Tell the user in a line what you tried, so the next round can push further or pull back.
