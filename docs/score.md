# Score

[简体中文](score_zh.md)

A Score project writes music as a score: each track is one instrument and notes are placed by bar and beat. yovoice renders every track with a General MIDI sound font, levels it by role and mixes the result. Unlike Music generation, scores involve no AI inference: the same score always renders the same way, and you can change any single note, instrument or track level precisely.

Good uses:

- Ask an Agent (Claude, Codex, …) to write an underscore that follows your video's sections and length, then audition, adjust and export it in yovoice.
- Import an existing MIDI file, swap instruments, adjust levels and render a WAV.
- Export the score as MIDI and continue in a DAW.

## Sound font

Rendering needs the MuseScore General sound font (`musescore-general-sf2`, SF2, about 216 MB) with all 128 GM instruments and drum kits. Download it in Settings › Models, or run:

```sh
yovoice models download musescore-general-sf2
```

Scores do not need the inference engine or a GPU.

## In the desktop app

1. New project › Score. Start from the example, or import MIDI or a score (`.mid`, `.midi`, `.json`).
2. The overview shows notes over time, one row per track, with sections shaded (tempo changes are drawn at their real length). Click a row to highlight the track in the table.
3. In the track table, change the instrument (GM program), role and target level, or turn a track off.
4. The inspector edits tempo, meter and key, and lists when each section starts and ends so you can line them up with narration.
5. Render music to create a mixed WAV, kept as a version of the project that you can play and export.
6. Export saves MIDI or score JSON. Copy Agent prompt copies instructions describing the score format for an Agent.
7. With an [AI service](ai.md) set up, AI compose writes a whole arrangement from a description and a length.

## Format

```json
{
  "tempo": 100,
  "timeSignature": [4, 4],
  "key": "D minor",
  "sections": [
    { "name": "Intro", "start": 1, "end": 6 },
    { "name": "Build", "start": 7, "end": 18 },
    { "name": "Outro", "start": 19, "end": 22, "tempo": 88 }
  ],
  "tracks": [
    {
      "id": "violin", "name": "Violin", "role": "melody", "program": 40,
      "reverb": 0.35, "pan": 0.2,
      "humanize": { "velocity": 6, "timingMs": 4 },
      "dynamics": [{ "start": 7, "end": 9, "from": 0.35, "to": 1 }],
      "notes": [{ "bar": 7, "beat": 1, "pitch": 69, "length": 2, "velocity": 84 }]
    },
    {
      "id": "drums", "name": "Drums", "role": "drums", "program": 0, "drums": true,
      "notes": [{ "bar": 7, "beat": 1, "pitch": 36, "length": 0.25, "velocity": 100 }]
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `tempo` | Tempo in BPM, 30–300. |
| `timeSignature` | Meter such as `[4, 4]`, `[3, 4]` or `[6, 8]`. Beats are quarter notes, so 6/8 has 3 beats per bar. |
| `key` | Key, descriptive only, up to 40 characters. |
| `sections` | Optional sections: name, first and last bar (inclusive) and an optional tempo, for tempo changes and lining up with picture. |
| `tracks[].program` | General MIDI program 0–127, e.g. 0 piano, 40 violin, 42 cello, 48 string ensemble, 89 warm pad. |
| `tracks[].drums` | Drum kit on MIDI channel 10; pitch selects the drum: 36 kick, 38 snare, 37 side stick, 42 closed hat, 46 open hat, 49 crash. |
| `tracks[].role` | `melody`, `piano`, `strings`, `bass`, `drums`, `pad`, `arp` or `other`; sets the default target level. |
| `tracks[].level` | Target level in dBFS (RMS of the audible part), -60 to 0; defaults by role. |
| `tracks[].pan` / `reverb` | Pan from -1 (left) to 1 (right); reverb send 0–1. |
| `tracks[].humanize` | Random velocity (0–40) and timing offset (0–50 ms), seeded so every render is the same. |
| `tracks[].dynamics` | Crescendo or diminuendo: ramps expression from `from` to `to` (0–1) between two bars. |
| `tracks[].mute` | Silences the track while keeping its notes. |
| `notes[]` | `bar` and `beat` start at 1 and `beat` may be fractional (1.5 is the second half of beat 1); `pitch` is MIDI (60 = C4); `length` is in beats; `velocity` 1–127. |

Limits: 512 bars, 32 tracks, 20,000 notes, 10 minutes.

### Mixing

Each track is rendered on its own, levelled to its target, then summed; the mix is peak-limited to -1 dBFS with a 2 second reverb tail. Default levels keep lead parts forward and pads back:

| Role | Default level |
| --- | --- |
| melody, piano | -21 dBFS |
| strings | -23 dBFS |
| other | -24 dBFS |
| bass, drums | -25 dBFS |
| pad, arp | -29 dBFS |

Under narration you will usually lower the whole bed further on the timeline.

## CLI and Agents

```sh
yovoice score render score.json --output music.wav --stems stems/
yovoice score midi score.json --output score.mid
yovoice score from-midi song.mid --output score.json
```

- `render` reads score JSON or MIDI and writes a mixed WAV; `--stems DIR` also writes each levelled track (`01-Piano.wav`, …). `--soundfont ID` picks another installed sound font.
- `midi` / `from-midi` convert between score JSON and standard MIDI without a sound font.
- Existing files are never overwritten. On success stdout has JSON: `{"path": "...", "duration": 54.9, "bars": 22, "tracks": 7, "stems": "..."}`.

The remote service's MCP exposes `render_score` with `title` and `score`, returning `id`, `duration` and `downloadPath`; see the [API guide](api.md).

When importing MIDI, each track × channel becomes a track; tempo comes from the first tempo event, meter from the opening time signature, and channel 10 becomes a drum kit. Imported tracks get the `other` role, which you can change.

## Limitations

- Instruments come from an SF2 sound font. They suit underscores and sketches, not the character of synth plugins (VST) or sampled instrument libraries.
- Notes cannot yet be drawn in the overview; edit notes by importing a score or MIDI.
- Reverb is a simple send; there is no EQ or compression.
