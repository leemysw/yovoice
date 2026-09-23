"""构建当前平台的独立 CLI 包，不需要 Node.js 或桌面构建工具。"""
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import tempfile
import zipfile

root = Path(__file__).resolve().parents[1]
goos = os.environ.get("GOOS", {"Darwin": "darwin", "Windows": "windows", "Linux": "linux"}.get(platform.system(), platform.system().lower()))
goarch = os.environ.get("GOARCH", "arm64" if platform.machine().lower() in ("arm64", "aarch64") else "amd64")
platform_name = {("darwin", "arm64"): "macos-arm64", ("windows", "amd64"): "windows-x64", ("linux", "amd64"): "linux-x64"}.get((goos, goarch))
if platform_name is None:
    raise SystemExit("仅支持 macOS ARM64、Windows x64 和 Linux x64")
host = {"Darwin": "darwin", "Windows": "windows", "Linux": "linux"}.get(platform.system())
if goos != host or goarch != ("arm64" if platform.machine().lower() in ("arm64", "aarch64") else "amd64"):
    raise SystemExit("CLI 完整包需在目标平台构建，以集成对应的 FFmpeg")
version = os.environ.get("YOVOICE_VERSION") or json.loads((root / "web/package.json").read_text())["version"]
output = root / "artifacts" / f"yovoice-cli-{platform_name}.zip"
output.parent.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory() as directory:
    executable = Path(directory) / ("yovoice.exe" if goos == "windows" else "yovoice")
    subprocess.run([os.environ.get("GO", "go"), "build", "-trimpath", "-ldflags", f"-s -w -X main.version={version}", "-o", str(executable), "./cmd/yovoice"], cwd=root, env={**os.environ, "GOOS": goos, "GOARCH": goarch, "CGO_ENABLED": "0"}, check=True)
    subprocess.run([sys.executable, "scripts/build-ffmpeg.py", str(Path(directory) / "tools")], cwd=root, check=True)
    subprocess.run([sys.executable, "scripts/package-kokoro-runtime.py", str(Path(directory) / "tools/kokoro")], cwd=root, check=True)
    converter = Path(directory) / "tools" / ("ffmpeg.exe" if goos == "windows" else "ffmpeg")
    subprocess.run([str(converter), "-version"], stdout=subprocess.DEVNULL, check=True)
    if goos == "darwin":
        subprocess.run(["bash", "scripts/desktop/sign-macos.sh", str(executable)], cwd=root, check=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.write(executable, executable.name)
        for source in sorted((Path(directory) / "tools").rglob("*")):
            archive.write(source, source.relative_to(directory).as_posix())
        for source in ("LICENSE", "THIRD_PARTY_NOTICES.md", "web/public/model-license.txt", "docs/cli.md", "docs/kokoro.md", "skills/yovoice/SKILL.md", "skills/yovoice/references/setup.md", "skills/yovoice/references/audio.md"):
            archive.write(root / source, source)
print(output)
