#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
app="${1:?请指定已签名的 app 路径}"
output="${2:-$PWD/artifacts/yovoice-macos-arm64.dmg}"
[[ "$app" == /* ]] || app="$PWD/$app"
[[ "$output" == /* ]] || output="$PWD/$output"
[[ -d "$app/Contents" ]] || { echo 'App 不存在' >&2; exit 1; }
mkdir -p "$(dirname "$output")"
working=$(mktemp -d "$PWD/artifacts/.dmg-build.XXXXXX")
mounted=false
cleanup() {
    if [[ "$mounted" == true ]]; then
        if ! hdiutil detach "$working/mount" -quiet; then
            echo "卸载失败，保留临时镜像：$working" >&2
            return
        fi
    fi
    rm -rf "$working"
}
trap cleanup EXIT
mkdir -p "$working/source/.background" "$working/mount"
ditto "$app" "$working/source/yovoice.app"
ln -s /Applications "$working/source/Applications"
swift scripts/desktop/dmg-background.swift "$working/source/.background/Installer.tiff"
rm "$working/source/.background/Installer.png"
hdiutil create -volname yovoice -srcfolder "$working/source" -fs HFS+ -format UDRW "$working/editable.dmg" -quiet
hdiutil attach "$working/editable.dmg" -mountpoint "$working/mount" -nobrowse -noautoopen -quiet
mounted=true
osascript - "$working/mount" <<'APPLESCRIPT'
on run argv
  tell application "Finder"
    set volumeFolder to POSIX file (item 1 of argv) as alias
    set volumeDisk to disk of volumeFolder
    tell volumeDisk
      open
      set current view of container window to icon view
      set toolbar visible of container window to false
      set statusbar visible of container window to false
      set bounds of container window to {100, 100, 820, 582}
      delay 1
      set options to icon view options of container window
      set arrangement of options to not arranged
      set icon size of options to 96
      set text size of options to 13
      set label position of options to bottom
      set background picture of options to file ".background:Installer.tiff"
      set position of item "yovoice.app" to {180, 215}
      set position of item "Applications" to {540, 215}
      -- 背景资源居中放在安装区域下方，显示隐藏文件时保持左右对称。
      set position of item ".background" to {360, 365}
      update without registering applications
      delay 2
      close container window
    end tell
  end tell
end run
APPLESCRIPT
# 背景和布局必须写入，不能静默退回空白安装窗口。
test -s "$working/mount/.DS_Store"
rm -rf "$working/mount/.fseventsd" "$working/mount/.Trashes" "$working/mount/.Spotlight-V100"
sync
hdiutil detach "$working/mount" -quiet
mounted=false
hdiutil convert "$working/editable.dmg" -format UDZO -imagekey zlib-level=9 -o "$working/yovoice.dmg" -quiet
scripts/desktop/sign-macos.sh "$working/yovoice.dmg"
mv "$working/yovoice.dmg" "$output"
echo "已生成：$output"
