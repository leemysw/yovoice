# Development

## Requirements

- Node.js 22+, pnpm 9.15.2, Go 1.26+.
- macOS: Apple Silicon, macOS 14+, Xcode Command Line Tools.
- Windows: Windows 10/11 x64, .NET SDK 10, WebView2 Runtime, Inno Setup 6 (`winget install JRSoftware.InnoSetup`). Make targets require GNU Make.

Run the following commands from the repository root.

## Run

```sh
make install
make app-run
```

For browser-only development:

```sh
make dev
```

The preview runs at http://127.0.0.1:5173. Model downloads and speech generation require the desktop app.

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

Packages are written to `artifacts/`: macOS DMG and ZIP, Windows Setup EXE and portable ZIP.
The macOS DMG uses a Retina background and a fixed Finder drag-to-install layout. A logged-in macOS desktop session with Finder automation permission is required to create the layout (as on GitHub macOS runners).
Exit the local macOS app before rebuilding; the build refuses to replace a running bundle.

To package an existing signed app without replacing it:

```sh
scripts/desktop/package-macos-dmg.sh artifacts/macos-arm64/yovoice.app
```

The DMG background is drawn by `scripts/desktop/dmg-background.swift`. Release builds still sign, notarize and staple the final DMG.
Windows Setup installs per user and supplies the signed Microsoft WebView2 bootstrapper when needed; installing a missing runtime requires internet access. CI verifies silent installation and uninstallation. User data in `~/.yovoice` is retained on uninstall.

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
