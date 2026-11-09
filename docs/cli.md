# CLI and Agent Skill

English · [简体中文](cli_zh.md)

Generate speech and music, transcribe recordings, and separate songs without opening the desktop app. The CLI supports macOS on Apple Silicon, Windows x64, and Linux x64.

## Installation

Download the CLI archive for your platform from [Releases](https://github.com/leemysw/yovoice/releases).

| Platform | Archive | Executable |
| --- | --- | --- |
| macOS · Apple Silicon | `yovoice-<version>-cli-macos-arm64.zip` | `yovoice` |
| Windows · x64 | `yovoice-<version>-cli-windows-x64.zip` | `yovoice.exe` |
| Linux · x64 | `yovoice-<version>-cli-linux-x64.zip` | `yovoice` |

Extract the archive and keep `tools/` beside the executable. Add that directory to your PATH, or use the executable's full path. Reopen your terminal after changing PATH.

```sh
yovoice --version
yovoice --help
```

The package includes the audio converter; no separate FFmpeg, Python, or Go installation is required. Engines and models are downloaded separately.

## Set up an engine and model

```sh
yovoice setup
yovoice models list --json
yovoice models download index-2.5-q8
```

`setup` uses Metal on macOS and CPU on Windows/Linux by default. Choose another backend with:

| Platform | Supported backends |
| --- | --- |
| macOS · Apple Silicon | `--backend metal`, `--backend cpu` |
| Windows · x64 | `--backend cpu`, `--backend cuda`, `--backend vulkan` |
| Linux · x64 | `--backend cpu`, `--backend vulkan` |

GPU backends require compatible hardware and drivers. Run `setup` again to switch backends.

Model downloads use ModelScope by default. Add `--source huggingface` or `--source mirror` to change the source. Downloads resume after interruption and are verified automatically. Only the model packages listed by yovoice can be installed; see [model selection](models.md) for input requirements and examples.

## Generate speech

```sh
yovoice generate --model index-2.5-q8 --text-file narration.txt --reference voice.wav --output narration.wav
```

- Use either `--text TEXT` or `--text-file FILE`.
- For voice cloning, use either `--reference FILE` or `--voice ID` from `yovoice voices list`.
- Reference audio must be 1 second to 10 minutes and no larger than 20 MB; recordings over 60 seconds are trimmed automatically to their clearest 5–15 seconds. Supported formats include WAV, MP3, M4A/AAC, FLAC, OGG/Opus, AIFF, WMA, and WebM. Conversion is automatic.
- Output must use a `.wav` extension. Existing files are not overwritten.
- Commands wait for completion. Ctrl-C cancels generation. Repeated `generate` commands reload the model; use the [remote service](api.md) for a persistent engine.

To save a reusable voice:

```sh
yovoice voices import voice.wav --name Narrator
yovoice voices list --json
```

Progress is written to stderr and results to stdout as JSON:

```json
{"id":"...","path":"/absolute/narration.wav","duration":4.2,"model":"index-2.5-q8","voice":"..."}
```

Failures return an error on stderr and exit code 1; Ctrl-C returns 130.

## Generate music

Music models (ACE-Step, YuE2, Stable Audio 3) use the same `generate` command. `--text` is the style description; lyrics are passed separately:

```sh
yovoice generate --model yue2-3b-q8 --text "Mandarin, acoustic pop, warm female vocals, piano, 96 BPM" --lyrics-file song.txt --output song.wav
yovoice generate --model ace-step-1.5-turbo-q8 --text "city pop, warm synths" --lyrics-file song.txt --language zh --option 'duration_seconds=60' --output song.wav
yovoice generate --model stable-audio-3-small-sfx-q8 --text "door creaks open slowly" --option 'duration_seconds=5' --output door.wav
```

- `--lyrics TEXT` or `--lyrics-file FILE` with section tags such as `[Verse]`; `--instrumental` for no vocals. YuE2 needs lyrics unless it is instrumental.
- YuE2 returns the score it used as `abc` in the result JSON, along with the `seed`. Edit the score and pass it back with `--abc-file FILE` to keep the melody while changing the style or one passage.
- ACE-Step takes the singing language with `--language`; other settings, such as duration or YuE2 `cot`, use `--option`. `yovoice models list --json` lists each model's `generationOptions`.
- The Stable Audio SFX models make sound effects; other music models make songs.

## Transcribe, separate and convert to MIDI

These commands take an existing audio or video file in any common format:

```sh
yovoice transcribe interview.mp4 --output interview.srt
yovoice separate song.mp3 --output-dir stems
yovoice to-midi song.mp3 --output song.mid
```

- `transcribe` needs `qwen3-asr-0.6b-q8`. The output extension picks the format: `.srt`, `.vtt`, `.txt` (one line per caption) or `.json` (text, word timings and caption lines). Lines are split using the Transcribe settings in the app, and the result is also saved as a transcript you can edit in the app.
- `separate` needs `htdemucs-6stems-q8` (with `bs-roformer-q8` installed, the vocals are cleaner). It writes the mix and six stems (vocals, drums, bass, guitar, piano, other) of equal length into a new “<name> Stems” folder.
- `to-midi` needs `muscriptor-small-f32`. Write `.mid` for multi-instrument MIDI, or `.json` for a score you can edit and render with `yovoice score render`.
- Songs for `separate` and `to-midi` can be up to 10 minutes long.

## Score

Render music from score JSON or MIDI. It needs the sound font but not the inference engine:

```sh
yovoice models download musescore-general-sf2
yovoice score render score.json --output music.wav --stems stems/
yovoice score midi score.json --output score.mid
yovoice score from-midi song.mid --output score.json
```

See [Score](score.md) for the format, mixing defaults and MIDI import rules.

## MCP over stdio

Local MCP clients such as Claude Desktop, Cursor or Claude Code can start yovoice as a subprocess. No token or port is needed:

```json
{
  "mcpServers": {
    "yovoice": {"command": "yovoice", "args": ["mcp"]}
  }
}
```

Use the full path to the executable if it is not on the client's PATH, and add `"--data-dir", "DIR"` to `args` to use a separate directory. The tools are the same as the [remote MCP](api.md#connect-an-mcp-client) tools, with two differences: results return the generated WAV's local `path` instead of a `downloadPath`, and `upload_voice` also accepts a local audio file `path`. Like other commands, `yovoice mcp` uses the data directory exclusively; while the desktop app is open, connect to its [local API](api.md#use-the-desktop-app-on-the-same-computer) at `http://127.0.0.1:8080/mcp` instead.

## Data directory

The default directory is the same as the desktop app's: `~/.yovoice`, or the new location if you moved it in Settings › Storage. Only one app, CLI command, or server can use a directory at a time. Quit the app, or use a separate directory with `--data-dir DIR` on every command:

```sh
yovoice setup --data-dir ./voice-data
yovoice models download index-2.5-q8 --data-dir ./voice-data
yovoice generate --text-file narration.txt --reference voice.wav --output narration.wav --data-dir ./voice-data
```

Engine logs are stored in the data directory's `logs/` folder.

## Agent Skill

Copy the package's `skills/yovoice` folder into your agent's Skill directory. Install the CLI on the agent's PATH for local generation. If you use an existing remote service, the client does not need the CLI or models.

Ask your agent to read a text file, choose a voice, and save the result. See [API / MCP deployment](api.md) for remote access and [development](development.md) for building from source.
