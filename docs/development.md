# Development

## Requirements

- Node.js 22+, pnpm 9.15.2, Go 1.26+, Python 3.12+.
- The bundled audio converter is built from FFmpeg source; Make, Bash, curl, and a C compiler are required. Windows builds use MSYS2 MinGW64 (GCC, Make, Python, curl).
- macOS: Apple Silicon, macOS 14+, Xcode Command Line Tools.
- Windows: Windows 10/11 x64, .NET SDK 8, WebView2 Runtime. Packaging installers additionally requires Inno Setup 6 (`winget install JRSoftware.InnoSetup`). Make targets require GNU Make.

Run the following commands from the repository root.

### Windows audio build tools

Install [MSYS2](https://www.msys2.org/) and run these commands in its MinGW64 terminal (reopen the terminal if the update requests it):

```sh
pacman -Syu
pacman -S --needed make curl diffutils mingw-w64-x86_64-gcc mingw-w64-x86_64-python
```

The Windows build finds MSYS2 at `artifacts/tooling/msys64` or `C:/msys64`. For another location, set `$env:YOVOICE_MSYS2 = 'D:/tools/msys64'` in PowerShell before running `make app-run`. Python 3.12+ and the build tools can also be supplied through `PATH`; the Windows Store Python alias is not a Python installation. FFmpeg is compiled once and reused until its build script changes.

## Run

```sh
make install
make app-run
```

On macOS, `app-run` runs in the foreground and streams host and inference logs to the terminal. Logs remain in `~/.yovoice/logs` (or `$WORKBENCH_DATA/logs`). Closing the window keeps the app and background tasks running; click its Dock icon to reopen it. Use Command-Q or the Quit menu to exit and finish the command.

`app-run` builds and starts the app without running tests or creating installers. Run `make install` after dependency changes, `make check` for tests, and `make app-package` for distribution packages.

For browser-only development:

```sh
make dev
```

The preview runs at http://127.0.0.1:5173. Model downloads and speech generation require the desktop app.

## Standalone CLI

The CLI uses Go 1.26+. Full packages also build a minimal FFmpeg from pinned source and require Python 3.12+, Make, Bash, curl, and a C compiler (Xcode Command Line Tools on macOS; GCC on Linux; MSYS2 MinGW64 GCC on Windows). To obtain and build the source:

```sh
git clone https://github.com/leemysw/yovoice.git
cd yovoice
make cli-build
```

Keep the generated `artifacts/tools/` directory next to the CLI. The executable is `artifacts/yovoice` on macOS/Linux or `artifacts/yovoice.exe` on Windows. Run `make cli-package` on macOS, or `python scripts/package-cli.py` on Windows, to create the standalone ZIP. The archive includes the CLI, minimal FFmpeg, Skill, licenses, and usage guide. CI builds packages natively for each target. FFmpeg is cached by the build script fingerprint, signed and notarized with the macOS packages, and its corresponding source archive is attached to Releases. Engines and models are downloaded separately.

CI artifacts use `yovoice-cli-macos-arm64.zip`, `yovoice-cli-windows-x64.zip`, and `yovoice-cli-linux-x64.zip`. The release workflow adds the version tag, producing `yovoice-<version>-cli-<platform>.zip`. End-user installation is documented in the [CLI guide](cli.md).

Push and pull-request checks run the Go, browser, signing, updater, and installation tests. Release builds skip those tests and their test-only dependencies; they compile and package the tagged source, sign and notarize macOS binaries, and verify the release asset list and checksums before publishing.

## Test

```sh
pnpm --dir web exec playwright install chromium
make check
```

`make check-web` runs the frontend build and browser tests. `make check-core` runs Go tests with the race detector.

## Build

```sh
make app-build
```

On Windows without GNU Make:

```powershell
./scripts/desktop/build-windows.ps1
```

`app-build` produces the runnable app in `artifacts/macos-arm64/` or `artifacts/windows-x64/`.

To also create installers, run `make app-package` (or `./scripts/desktop/build-windows.ps1 -Package` on Windows). Packages are written to `artifacts/`: macOS DMG and ZIP, Windows Setup EXE.
The macOS DMG uses a Retina background and a fixed Finder drag-to-install layout. A logged-in macOS desktop session with Finder automation permission is required to create the layout (as on GitHub macOS runners).
Exit the local macOS app before rebuilding; the build refuses to replace a running bundle.
On Windows, use **File → Quit yovoice** or the tray menu before rebuilding. Closing the window only hides the app. The build checks for processes running from its output directory before compiling or removing any files.

To package an existing signed app without replacing it:

```sh
scripts/desktop/package-macos-dmg.sh artifacts/macos-arm64/yovoice.app
```

The DMG background is drawn by `scripts/desktop/dmg-background.swift`. Release builds still sign, notarize and staple the final DMG.
Windows Setup installs per user and supplies the signed Microsoft WebView2 bootstrapper when needed; installing a missing runtime requires internet access. CI verifies silent installation and uninstallation. User data in `~/.yovoice` is retained on uninstall.

## Application updates

The app checks GitHub's latest stable release on launch and every four hours, using the versioned macOS ARM64 ZIP and `SHA256SUMS.txt` generated by Publish Release. Downloads stay in `~/.yovoice/updates` until installation. The app verifies SHA-256, bundle identity, version, architecture, the current developer's signing team, and Gatekeeper acceptance before offering a restart. Ad-hoc development builds cannot install updates automatically.

Installation waits for the app to save and exit, then replaces the bundle and relaunches it. Copy, replacement, or launch-command failures restore the previous app. Cancelling exit leaves the update ready for later. Diagnostics are in `~/.yovoice/logs/update-check.log` and `update-install.log`.

```sh
swift test --package-path desktop/macos
python3 scripts/desktop/check-macos-update.py
```

Windows checks on launch and every four hours as well. It downloads the versioned `-windows-x64-setup.exe`, verifies its exact entry in `SHA256SUMS.txt`, and offers a restart from the app menu. After saving and stopping the service, a separate PowerShell helper runs Setup in the existing installation directory. It keeps a backup until installation and the relaunch command succeed. Windows is distributed only as Setup; no portable ZIP is built or published.

```powershell
dotnet run --project desktop/windows/UpdateChecks
./scripts/desktop/check-windows-update.ps1
```

## Layout

```text
cmd/yovoice-service/   Local service entry point
internal/workbench/   Application logic and tests
desktop/macos/        AppKit / WKWebView host
desktop/windows/      WPF / WebView2 host
web/src/app/          Application composition and layout
web/src/features/     Creation, media, and settings
web/src/shared/       Shared models, bridge, and audio utilities
web/browser-tests/    Playwright tests
scripts/desktop/      Packaging and native verification
```

Frontend dependencies flow from `app` to `features` to `shared`. Native hosts call the Go service over authenticated loopback HTTP.
