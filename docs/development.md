# Development

English · [简体中文](development_zh.md)

This guide is for building yovoice from source. For prebuilt packages, see [CLI installation](cli.md#installation) or [Releases](https://github.com/leemysw/yovoice/releases).

## Requirements

- Node.js 22+, pnpm 9.15.2, Go 1.26+, Python 3.12+.
- Make, Bash, curl, and a C compiler for the bundled audio converter.
- macOS: Apple Silicon, macOS 14+, and Xcode Command Line Tools.
- Windows: Windows 10/11 x64, .NET SDK 8, WebView2 Runtime, and MSYS2 MinGW64. Install Inno Setup 6 to create installers. Make targets require GNU Make.

On Windows, install the audio build tools in the MSYS2 MinGW64 terminal:

```sh
pacman -Syu
pacman -S --needed make curl diffutils mingw-w64-x86_64-gcc mingw-w64-x86_64-python
```

Reopen the terminal if the update requests it. The build finds MSYS2 at `artifacts/tooling/msys64` or `C:/msys64`; set `YOVOICE_MSYS2` for another location.

## Run the app

```sh
git clone https://github.com/leemysw/yovoice.git
cd yovoice
make install
make app-run
```

Run all following commands from the repository root. `app-run` builds and starts the app without tests or packaging. On macOS, it streams logs to the terminal. Closing the window keeps the app running; quit from the app menu before rebuilding. Logs are in `~/.yovoice/logs`.

For browser-only UI development, run `make dev` and open `http://127.0.0.1:5173`. Local speech generation requires the desktop app or CLI.

## Build and package

| Command | Output |
| --- | --- |
| `make app-build` | Runnable app in `artifacts/macos-arm64/` or `artifacts/windows-x64/` |
| `make app-package` | macOS DMG/ZIP or Windows Setup EXE in `artifacts/` |
| `make cli-build` | CLI executable and `artifacts/tools/` |
| `python3 scripts/package-cli.py` | Standalone CLI ZIP in `artifacts/` |

Keep `tools/` beside the CLI executable. Complete packages must be built on their target platform. macOS DMG packaging requires a logged-in desktop session and Finder automation permission.

On Windows without GNU Make, use PowerShell:

```powershell
./scripts/desktop/build-windows.ps1
./scripts/desktop/build-windows.ps1 -Package
python scripts/package-cli.py
```

Model conversion is separate from app packaging. For compatible Kokoro model preparation, run `python scripts/prepare-kokoro-models.py --help` from the repository.

## Tests

```sh
pnpm --dir web exec playwright install chromium
make check
```

Use `make check-core` for Go tests with the race detector, or `make check-web` for the frontend build and browser tests. Native installation and GPU inference also need testing on the target platform.

## Project layout

| Directory | Purpose |
| --- | --- |
| `cmd/` | CLI and local service entry points |
| `internal/workbench/` | Application logic and Go tests |
| `desktop/macos/`, `desktop/windows/` | Native app hosts |
| `web/src/` | Frontend application |
| `web/browser-tests/` | Browser tests |
| `scripts/` | Build and packaging tools |

Public guides use English `*.md` and Chinese `*_zh.md` files. Keep both versions and their links in sync when changing user-facing behavior.
