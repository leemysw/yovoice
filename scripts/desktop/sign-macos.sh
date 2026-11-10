#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
target="${1:?请指定 app、dmg 或 yovoice CLI 路径}"
identity="${YOVOICE_CODESIGN_IDENTITY:--}"
notarize="${YOVOICE_NOTARIZE:-0}"
if [[ "$notarize" == 1 && "$identity" != 'Developer ID Application: '* ]]; then
  echo '正式公证必须使用 Developer ID Application 签名。' >&2; exit 1
fi
if [[ "$notarize" == 1 && -z "${YOVOICE_NOTARY_PROFILE:-}" ]]; then
  : "${APPLE_NOTARY_APPLE_ID:?缺少 Apple ID}"
  : "${APPLE_NOTARY_TEAM_ID:?缺少 Team ID}"
  : "${APPLE_NOTARY_PASSWORD:?缺少公证专用密码}"
fi
sign_args=(--force --sign "$identity")
if [[ -n "${MACOS_CODESIGN_KEYCHAIN_PATH:-}" ]]; then sign_args+=(--keychain "$MACOS_CODESIGN_KEYCHAIN_PATH"); fi
if [[ "$identity" != - ]]; then sign_args+=(--timestamp); fi
# ocho 允许通过 YOVOICE_OCHO_SKIP 跳过打包，存在时必须带加固运行时签名才能通过公证。
sign_ocho() {
  local executable="$1"
  if [[ ! -f "$executable" ]]; then return; fi
  if [[ "$(lipo -archs "$executable")" != arm64 ]]; then echo "仅支持 Apple Silicon：$executable" >&2; exit 1; fi
  codesign "${sign_args[@]}" --options runtime "$executable"
  codesign --verify --strict "$executable"
}
case "$target" in
  *.app)
    # 先签嵌入的服务，再签主应用；不使用 --deep 代替逐项签名。
    for executable in "$target/Contents/Resources/service/yovoice-service" "$target/Contents/Resources/engine/audiocpp_server" "$target/Contents/Resources/tools/ffmpeg" "$target/Contents/Resources/tools/ffprobe" "$target/Contents/MacOS/VoiceWorkbenchMac"; do
      if [[ "$(lipo -archs "$executable")" != arm64 ]]; then echo "仅支持 Apple Silicon：$executable" >&2; exit 1; fi
    done
    codesign "${sign_args[@]}" --options runtime "$target/Contents/Resources/service/yovoice-service"
    # Kokoro 发音库下载自 PyPI，没有本团队签名：临时签名不启用加固运行时；正式签名保留加固运行时，
    # 并仅为引擎关闭动态库同团队校验，否则无法加载发音库。
    if [[ "$identity" == - ]]; then
      codesign "${sign_args[@]}" "$target/Contents/Resources/engine/audiocpp_server"
    else
      codesign "${sign_args[@]}" --options runtime --entitlements desktop/macos/engine-entitlements.plist "$target/Contents/Resources/engine/audiocpp_server"
    fi
    codesign "${sign_args[@]}" --options runtime "$target/Contents/Resources/tools/ffmpeg"
    codesign "${sign_args[@]}" --options runtime "$target/Contents/Resources/tools/ffprobe"
    sign_ocho "$target/Contents/Resources/tools/ocho/ocho"
    codesign "${sign_args[@]}" --options runtime --entitlements desktop/macos/entitlements.plist "$target"
    codesign --verify --deep --strict "$target"
    ;;
  *.dmg) codesign "${sign_args[@]}" "$target"; codesign --verify --strict "$target" ;;
  */yovoice)
    if [[ "$(lipo -archs "$target")" != arm64 ]]; then echo "仅支持 Apple Silicon：$target" >&2; exit 1; fi
    for tool in ffmpeg ffprobe; do
      executable="$(dirname "$target")/tools/$tool"
      if [[ "$(lipo -archs "$executable")" != arm64 ]]; then echo "CLI 工具必须为 arm64：$executable" >&2; exit 1; fi
      codesign "${sign_args[@]}" --options runtime "$executable"
      codesign --verify --strict "$executable"
    done
    sign_ocho "$(dirname "$target")/tools/ocho/ocho"
    codesign "${sign_args[@]}" --options runtime "$target"
    codesign --verify --strict "$target"
    ;;
  *) echo '仅支持 .app、.dmg 或 yovoice CLI。' >&2; exit 1 ;;
esac
if [[ "$notarize" != 1 ]]; then exit 0; fi

scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
auth=()
if [[ -n "${YOVOICE_NOTARY_PROFILE:-}" ]]; then
  auth+=(--keychain-profile "$YOVOICE_NOTARY_PROFILE")
else
  auth+=(--apple-id "$APPLE_NOTARY_APPLE_ID" --team-id "$APPLE_NOTARY_TEAM_ID" --password "$APPLE_NOTARY_PASSWORD")
fi
submission="$target"
if [[ "$target" == *.app || "$target" == */yovoice ]]; then
  submission="$scratch/notary.zip"
  if [[ "$target" == */yovoice ]]; then
    # 同时公证 CLI 和随包分发的音频转换器。
    ditto -c -k "$(dirname "$target")" "$submission"
  else
    ditto -c -k --keepParent "$target" "$submission"
  fi
fi
# 同时检查退出码和 Accepted 状态，不能把上传成功当作公证通过。
xcrun notarytool submit "$submission" "${auth[@]}" --wait --timeout 30m --output-format json > "$scratch/result.json"
python3 - "$scratch/result.json" <<'PY'
import json, sys
result = json.load(open(sys.argv[1]))
if result.get('status') != 'Accepted':
    raise SystemExit('Apple 公证未通过：' + str(result.get('status')) + '，任务编号：' + str(result.get('id')))
PY
# 独立 Mach-O 无法装订票据，Gatekeeper 联网查询公证结果。
if [[ "$target" == */yovoice ]]; then exit 0; fi
xcrun stapler staple "$target"
xcrun stapler validate "$target"
if [[ "$target" == *.app ]]; then spctl --assess --type execute --verbose "$target"; fi
