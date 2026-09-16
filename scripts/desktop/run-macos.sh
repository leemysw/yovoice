#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."

logs="${WORKBENCH_DATA:-$HOME/.yovoice}/logs"
mkdir -p "$logs"
# 提前创建日志文件；跟随文件名以兼容服务启动和引擎重启时的截断。
files=("$logs/host-service.log" "$logs/engine.log" "$logs/engine.log.out")
touch "${files[@]}"
tail -n 0 -F "${files[@]}" &
log_pid=$!
trap 'kill "$log_pid" 2>/dev/null || true; wait "$log_pid" 2>/dev/null || true' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

"artifacts/macos-arm64/yovoice.app/Contents/MacOS/VoiceWorkbenchMac"
