# Editing a YuE2 song without losing what works

An edit is a new take from a revised score, style or lyrics. YuE2 cannot repaint a passage of existing audio: changing anything regenerates the whole song, so keep the previous take for comparison.

## Agree on what must stay

Before editing, decide what "keep the melody" means and state it in your reply:

| Contract | Stays fixed |
| --- | --- |
| Exact melody | Pitch, onset and length of every Vocal note in the named sections |
| Same pitches, new rhythm | The ordered pitches; rhythm changes are listed |
| Recognizable theme | The phrases and their repetitions; embellishments are listed |
| Free adaptation | Agreed phrases, range, contour or cadences; changed bars are reported |

Also decide whether tempo, meter, lyrics, structure and the Ins melody may change. After `update_work` with a new `abc`, the result's `melodyChanges` lists the changed bars per voice and for chords (compared as sounding events, not text). Check it against the contract and report it truthfully; never call a melody "preserved" when Vocal bars changed.

## Develop a motif instead of repeating it

When a song feels flat ("the chorus doesn't lift", "it all sounds the same"), vary the material the listener already knows rather than writing a new tune. Keep the lyric rhythm and the motif's contour, then change one dimension per section:

- Chorus lift: move the motif up (a fourth, fifth or octave), lengthen the note on the title word, land the phrase on a higher, held note.
- Verse 2: same contour with altered intervals or a rhythmic displacement (start half a beat later, add a pickup).
- Bridge: invert or fragment the motif, change the harmonic area (relative minor, IV), thin the rhythm.
- Final chorus: the chorus melody with a new peak in its last phrase, or a step-up key change (`[K:]` change plus matching chords).

State which bars change and which motif stays, then `update_work` with the new `abc` and check `melodyChanges`. After generating, point the user at the exact spot to compare (for example verse into chorus) between the old and new take.

## Reharmonize

- Mark held notes, strong-beat notes, cadences and phrase ends in both voices first.
- For each new chord, check the melody note it sits under for its whole length, the bass movement and how tension resolves. A long melody note clashing with a chord for two beats is a real problem; a short passing tone is not.
- Add colour with a direction: secondary dominants, a short ii–V into a new key area, borrowed minor chords, a tritone approach, common-tone moves. Keep a coherent bass line. More chords per bar is not better.
- Repair the smallest span that fails: move a resolution, change an inversion (`/bass`), or pick a chord that contains the held note.
- Only native chord qualities (see abc-dialect.md). Voicing wishes such as 9ths or 13ths go in the style text, not in chord symbols.

## Change style or instruments

Update the style tags and, when the feel changes, the tempo in both the style and `Q:`. For example a relaxed jazz version: `English, modern jazz, piano, tenor saxophone, upright bass, brushed drums, no guitar, 88 BPM` with `Q:1/4=88`. The score decides the groove and how busy the vocal is; the style dresses what the score allows. A big genre change may need a new score (`plan_melody`) or `stripChords` so YuE2 can re-arrange.

## Instrumental themes and solos

Put a solo or theme in `Ins` with rests in `Vocal`; keep chord symbols in `Vocal` during those bars. A matching lyric tag such as `[Saxophone Solo]` and a style mention help, but they do not schedule the solo exactly.

## Change or translate lyrics

Fit the words to the vocal notes: roughly one syllable per note, stressed syllables on strong beats, open vowels on long notes, few consonants on short notes, breaths at rests. Translate meaning, not word for word; matching the syllable count alone is not enough. When the new lyrics need a different rhythm and the contract allows it, edit the Vocal rhythm too and report it.

## Then

`update_work` (abc, plus text or lyrics as needed) → `generate_work` → tell the user what changed and which earlier take to compare against. When the user cannot tell whether the score edit or the new style made the difference, offer one comparison take that changes only one of them (as the official editing demo does: reharmonized score, style-only, melody-only with `stripChords`). The full walkthrough is in the yovoice-lyrics skill's `references/yue2-examples.md`. If the requested effect is missing when they listen, revise and generate again rather than defending the score.
