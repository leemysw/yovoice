#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
GO_BIN="${GO_BIN:-go}"
if [[ "$(uname -m)" != arm64 ]]; then echo '仅支持 M 系列 Mac（Apple Silicon arm64）。' >&2; exit 1; fi
arch=arm64
destination="artifacts/macos-$arch/yovoice.app"
# 运行中替换 App 会使 TCC 无法识别原进程，导致麦克风授权失败。
ensure_app_stopped() {
    local processes
    processes=$(ps -axo comm=)
    if [[ $'\n'"$processes"$'\n' == *$'\n'"$PWD/$destination/Contents/MacOS/VoiceWorkbenchMac"$'\n'* ]]; then
        echo '请先退出 yovoice，再重新构建；不能替换正在运行的应用。' >&2
        exit 1
    fi
}
ensure_app_stopped
digest=639926715b1cb537f82aa31656aabbae5d9a85ac36568c402026968f3072e2b3
pnpm --dir web run build
configuration="${CONFIGURATION:-debug}"
swift build --package-path desktop/macos -c "$configuration" --arch arm64
mkdir -p artifacts
staging=$(mktemp -d "$PWD/artifacts/.macos-build.XXXXXX")
trap 'rm -rf "$staging"' EXIT
app="$staging/yovoice.app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources/engine" artifacts/downloads
mkdir -p "$app/Contents/Resources/service"
GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 "$GO_BIN" build -trimpath -ldflags="-s -w" -o "$app/Contents/Resources/service/yovoice-service" ./cmd/yovoice-service
cp "desktop/macos/.build/$configuration/VoiceWorkbenchMac" "$app/Contents/MacOS/VoiceWorkbenchMac"
cp desktop/macos/Resources/AppIcon.icns "$app/Contents/Resources/AppIcon.icns"
cp desktop/macos/Resources/install-update.sh "$app/Contents/Resources/install-update.sh"
rm -rf "$app/Contents/Resources/web"
cp -R web/dist "$app/Contents/Resources/web"
archive="artifacts/downloads/audio-v0.7.4-bin-macos-$arch-metal.tar.gz"
if [[ ! -f "$archive" ]]; then curl -fL --retry 3 "https://github.com/0xShug0/audio.cpp/releases/download/v0.7.4/$(basename "$archive")" -o "$archive.part"; mv "$archive.part" "$archive"; fi
actual=$(shasum -a 256 "$archive" | cut -d ' ' -f 1)
if [[ "$actual" != "$digest" ]]; then echo 'audio.cpp 校验失败，请删除下载缓存后重试'; exit 1; fi
# 仅携带推理服务、模型描述和许可证，不打包 Python 工具或模型权重。
tar -xzf "$archive" -C "$app/Contents/Resources/engine" ./audiocpp_server ./model_specs ./LICENSE
chmod +x "$app/Contents/Resources/engine/audiocpp_server"
python3 scripts/build-ffmpeg.py "$app/Contents/Resources/tools"
cp LICENSE THIRD_PARTY_NOTICES.md "$app/Contents/Resources/"
cat > "$app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>app.voiceworkbench.desktop</string>
<key>CFBundleName</key><string>yovoice</string>
<key>CFBundleIconFile</key><string>AppIcon.icns</string>
<key>CFBundleExecutable</key><string>VoiceWorkbenchMac</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSMicrophoneUsageDescription</key><string>录制用于语音合成的参考音色。</string>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
PLIST
# 版本取自发布标签或前端版本；写入后再签名。
YOVOICE_VERSION="${YOVOICE_VERSION:-$(node -p "require('./web/package.json').version")}" \
YOVOICE_BUILD_NUMBER="${YOVOICE_BUILD_NUMBER:-1}" python3 - "$app/Contents/Info.plist" <<'PYVERSION'
import os, plistlib, re, sys
version = os.environ['YOVOICE_VERSION'].split('-')[0]
build = os.environ['YOVOICE_BUILD_NUMBER']
if not re.fullmatch(r'\d+\.\d+\.\d+', version) or not re.fullmatch(r'\d+', build):
    raise SystemExit('版本号或构建号无效。')
with open(sys.argv[1], 'rb') as file: info = plistlib.load(file)
info.update(CFBundleShortVersionString=version, CFBundleVersion=build, LSArchitecturePriority=['arm64'])
with open(sys.argv[1], 'wb') as file: plistlib.dump(info, file)
PYVERSION
scripts/desktop/sign-macos.sh "$app"
if [[ "${YOVOICE_PACKAGE:-0}" == 1 ]]; then
    ditto -c -k --keepParent "$app" "artifacts/yovoice-macos-arm64.zip"
    scripts/desktop/package-macos-dmg.sh "$app"
fi

# 安装前再次检查，避免构建期间启动应用后被替换。
ensure_app_stopped
mkdir -p "$(dirname "$destination")"
if [[ -e "$destination" ]]; then mv "$destination" "$staging/previous.app"; fi
if ! mv "$app" "$destination"; then
    if [[ -e "$staging/previous.app" ]]; then mv "$staging/previous.app" "$destination"; fi
    exit 1
fi
echo "已构建：$destination"
