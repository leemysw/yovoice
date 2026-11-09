#!/bin/bash
# 构建 Linux x64 桌面应用：GTK/WebKitGTK 宿主、本地服务、界面、内置 CPU 内核与音频转换工具。
# YOVOICE_PACKAGE=1 时另外打包 tar.gz（附 install.sh）与 deb。
set -euo pipefail
cd "$(dirname "$0")/../.."
GO_BIN="${GO_BIN:-go}"
if [[ "$(uname -s)" != Linux || "$(uname -m)" != x86_64 ]]; then echo '仅支持在 Linux x64 上构建。' >&2; exit 1; fi
version="${YOVOICE_VERSION:-$(python3 -c 'import json; print(json.load(open("web/package.json"))["version"])')}"
# audio.cpp 版本与校验值统一取自服务端运行时清单。
read -r engine_version engine_archive digest < <(python3 -c 'import json,sys; e=json.load(open("internal/catalog/engine.json")); n="audio-"+e["version"]+"-"+sys.argv[1]; print(e["version"], n, e["archives"][n])' bin-ubuntu-x64-cpu-portable.tar.gz)
if [[ "${YOVOICE_SKIP_WEB:-0}" != 1 ]]; then pnpm --dir web run build; fi
mkdir -p artifacts/downloads artifacts/linux-x64
staging=$(mktemp -d "$PWD/artifacts/.linux-build.XXXXXX")
trap 'rm -rf "$staging"' EXIT
app="$staging/yovoice"
mkdir -p "$app/service" "$app/engine" "$app/resources"
CGO_ENABLED=0 "$GO_BIN" -C desktop/linux build -trimpath -ldflags="-s -w" -o "$app/yovoice-desktop" .
CGO_ENABLED=0 "$GO_BIN" build -trimpath -ldflags="-s -w" -o "$app/service/yovoice-service" ./cmd/yovoice-service
cp -R web/dist "$app/web"
archive="artifacts/downloads/$engine_archive"
if [[ ! -f "$archive" ]]; then curl -fL --retry 5 --retry-all-errors "https://github.com/0xShug0/audio.cpp/releases/download/$engine_version/$engine_archive" -o "$archive.part"; mv "$archive.part" "$archive"; fi
actual=$(sha256sum "$archive" | cut -d ' ' -f 1)
if [[ "$actual" != "$digest" ]]; then echo 'audio.cpp 校验失败，请删除下载缓存后重试' >&2; exit 1; fi
# 仅携带推理服务、ggml 动态库、模型描述和许可证，不打包 Python 工具或模型权重；内核以 $ORIGIN 查找同目录的库。
tar -xzf "$archive" -C "$app/engine" --wildcards ./audiocpp_server './libggml*' ./model_specs ./LICENSE
chmod +x "$app/engine/audiocpp_server"
printf '{"version":"%s","backend":"cpu"}' "$engine_version" > "$app/engine/yovoice-engine.json"
python3 scripts/build-ffmpeg.py "$app/tools"
python3 scripts/package-ocho.py "$app/tools/ocho"
cp desktop/linux/resources/yovoice.png desktop/linux/resources/yovoice.desktop "$app/resources/"
cp desktop/windows/VoiceWorkbench/Resources/ocho-ghost.png "$app/resources/"
cp desktop/linux/resources/install.sh "$app/"
cp LICENSE THIRD_PARTY_NOTICES.md "$app/"
rm -rf artifacts/linux-x64/yovoice
mv "$app" artifacts/linux-x64/yovoice
if [[ "${YOVOICE_PACKAGE:-0}" == 1 ]]; then
    tar -czf artifacts/yovoice-linux-x64.tar.gz -C artifacts/linux-x64 yovoice
    # deb 安装到 /opt/yovoice，由包管理器补齐 WebKitGTK 与 OpenMP 运行库。
    deb="$staging/deb"
    mkdir -p "$deb/DEBIAN" "$deb/opt" "$deb/usr/share/applications" "$deb/usr/share/icons/hicolor/256x256/apps"
    cp -a artifacts/linux-x64/yovoice "$deb/opt/yovoice"
    rm "$deb/opt/yovoice/install.sh"
    sed 's|@EXEC@|/opt/yovoice/yovoice-desktop|' desktop/linux/resources/yovoice.desktop > "$deb/usr/share/applications/yovoice.desktop"
    cp desktop/linux/resources/yovoice.png "$deb/usr/share/icons/hicolor/256x256/apps/yovoice.png"
    cat > "$deb/DEBIAN/control" <<CONTROL
Package: yovoice
Version: ${version}
Architecture: amd64
Maintainer: yovoice <https://github.com/leemysw/yovoice/issues>
Depends: libwebkit2gtk-4.1-0, libgomp1
Section: sound
Priority: optional
Homepage: https://yovoice.leemysw.com
Description: Local-first speech, voice cloning and music creation studio
 yovoice turns text into expressive speech, cloned voices, songs and
 multi-track scores entirely on this computer.
CONTROL
    dpkg-deb --root-owner-group --build "$deb" artifacts/yovoice-linux-x64.deb
fi
echo "artifacts/linux-x64/yovoice"
