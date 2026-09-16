#!/bin/bash
set -euo pipefail

# 所有路径由宿主作为独立参数传入；宿主保存作品并退出后才替换。
app_pid="$1"
source_app="$2"
target_app="$3"
working="$4"
log_path="$5"
exec >> "$log_path" 2>&1

for ((attempt = 0; attempt < 120; attempt++)); do
    if ! kill -0 "$app_pid" 2>/dev/null; then break; fi
    sleep 0.5
done
# 退出被取消或保存未完成时绝不强制结束进程。
if kill -0 "$app_pid" 2>/dev/null; then exit 1; fi
[[ -d "$source_app/Contents" && -d "$target_app/Contents" ]]
parent=$(dirname "$target_app")
staging=$(mktemp -d "$parent/.yovoice-update.XXXXXX")
backup="$staging/previous.app"
replacement="$staging/yovoice.app"
committed=false
cleanup() {
    result=$?
    if [[ "$committed" == false && -d "$backup" ]]; then
        rm -rf "$target_app"
        if ! mv "$backup" "$target_app"; then
            echo "恢复失败，旧应用保留在：$backup"
            exit 1
        fi
        open "$target_app" || true
    fi
    rm -rf "$staging"
    exit "$result"
}
trap cleanup EXIT
# 先在目标卷复制完整，再重命名；复制失败不触碰原应用。
ditto "$source_app" "$replacement"
mv "$target_app" "$backup"
mv "$replacement" "$target_app"
open "$target_app"
committed=true
rm -rf "$backup"
rm -rf "$working"
