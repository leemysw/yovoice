import os
from pathlib import Path
import shutil
import subprocess
import tempfile


# 用临时宿主验证日志转发、退出码及日志跟随进程清理，不启动真实应用。
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    scripts = root / "scripts/desktop"
    scripts.mkdir(parents=True)
    runner = scripts / "run-macos.sh"
    shutil.copy(Path(__file__).with_name("run-macos.sh"), runner)
    app = root / "artifacts/macos-arm64/yovoice.app/Contents/MacOS/VoiceWorkbenchMac"
    app.parent.mkdir(parents=True)
    app.write_text('''#!/bin/bash
echo host-output
sleep 1
echo service-output >> "$WORKBENCH_DATA/logs/host-service.log"
echo engine-output >> "$WORKBENCH_DATA/logs/engine.log"
sleep 2
exit 7
''')
    app.chmod(0o755)
    result = subprocess.run(
        ["bash", str(runner)], capture_output=True, text=True, timeout=10,
        env={**os.environ, "WORKBENCH_DATA": str(root / "data")},
    )
    assert result.returncode == 7, result
    for message in ("host-output", "service-output", "engine-output"):
        assert message in result.stdout, result.stdout
print("前台输出、服务日志、引擎日志和退出清理通过。")
