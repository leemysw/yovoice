#!/bin/bash
# 在 Xvfb 中启动打包好的 Linux 应用，验证 WebKitGTK 界面、桥接、音频、草稿保存与正常退出。
set -euo pipefail
cd "$(dirname "$0")/../.."
# 没有图形会话时（CI）在 Xvfb 中重新执行自身。
if [[ -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then exec xvfb-run -a -s '-screen 0 1440x900x24' "$0" "$@"; fi
app="$PWD/artifacts/linux-x64/yovoice/yovoice-desktop"
result=$(mktemp -d /tmp/yovoice-smoke.XXXXXX)
# 测试按中文界面查找控件，新数据目录的界面语言跟随系统语言。
LANG=zh_CN.UTF-8 LANGUAGE=zh_CN WORKBENCH_DATA="$result" WORKBENCH_SMOKE_SCRIPT="$PWD/scripts/desktop/smoke-linux.js" "$app" &
pid=$!
for ((i=0;i<90;i++)); do
  if ! kill -0 "$pid" 2>/dev/null; then break; fi
  sleep 1
done
if kill -0 "$pid" 2>/dev/null; then kill -9 "$pid"; echo '原生测试或退出超时'; exit 1; fi
wait "$pid"
if [[ -f "$result/smoke-error.txt" ]]; then cat "$result/smoke-error.txt"; exit 1; fi
python3 - "$result" <<'PY'
import json,pathlib,sqlite3,sys
root=pathlib.Path(sys.argv[1])
result=json.loads((root/'smoke-result.json').read_text())
db=sqlite3.connect(root/'yovoice.db')
draft=json.loads(db.execute('SELECT data FROM drafts ORDER BY pos LIMIT 1').fetchone()[0])
assert result['desktop'] and result['platform']=='linux' and result['backend']=='cpu' and result['audioSeconds']==2, result
assert result['modelOptions'] >= 2 and result['settingsRoundTrip'], result
assert draft['text']==result['draft']
print('原生模型菜单、设置往返、桥接、音频、草稿保存和退出通过：'+json.dumps(result, ensure_ascii=False))
PY
