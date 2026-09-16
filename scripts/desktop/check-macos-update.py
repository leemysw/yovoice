"""隔离验证更新替换、失败回滚和等待退出，不启动真实应用。"""
import os
from pathlib import Path
import subprocess
import sys
import tempfile

repo = Path(__file__).resolve().parents[2]
installer = repo / 'desktop/macos/Resources/install-update.sh'
with tempfile.TemporaryDirectory(prefix='yovoice update ') as temporary:
    root = Path(temporary)
    commands = root / 'bin'
    commands.mkdir()
    stub = commands / 'stub'
    stub.write_text(f'#!{sys.executable}\n' + '''import os, shutil, sys
from pathlib import Path
command = Path(sys.argv[0]).name
mode = os.environ['CHECK_FAILURE']
if command == 'sleep': sys.exit(0)
if command == 'ditto':
    if mode == 'copy':
        Path(sys.argv[2]).mkdir()
        sys.exit(1)
    shutil.copytree(sys.argv[1], sys.argv[2])
if command == 'open':
    if mode == 'open' and (Path(sys.argv[1]) / 'Contents/version').read_text() == 'new': sys.exit(1)
if command == 'mv':
    if mode == 'move' and sys.argv[1].endswith('/yovoice.app') and '.yovoice-update.' in sys.argv[1]: sys.exit(1)
    os.rename(sys.argv[1], sys.argv[2])
''')
    stub.chmod(0o755)
    for name in ['ditto', 'open', 'mv', 'sleep']:
        (commands / name).symlink_to(stub)
    # 已结束进程的 PID，用于成功路径；当前测试进程用于验证等待超时。
    exited = subprocess.Popen(['/usr/bin/true'])
    exited.wait()
    for mode in ['success', 'copy', 'move', 'open', 'running']:
        case = root / mode
        target = case / 'Applications/yovoice.app'
        working = case / 'cache'
        source = working / 'yovoice.app'
        for app, version in [(target, 'old'), (source, 'new')]:
            (app / 'Contents').mkdir(parents=True)
            (app / 'Contents/version').write_text(version)
        result = subprocess.run(['/bin/bash', str(installer), str(os.getpid() if mode == 'running' else exited.pid),
                                 str(source), str(target), str(working), str(case / 'install.log')],
                                env=dict(os.environ, PATH=str(commands) + ':/usr/bin:/bin', CHECK_FAILURE=mode),
                                timeout=15)
        expected = 'new' if mode == 'success' else 'old'
        assert (target / 'Contents/version').read_text() == expected, mode
        assert (result.returncode == 0) == (mode == 'success'), mode
        assert working.exists() == (mode != 'success'), mode
        assert not list(target.parent.glob('.yovoice-update.*')), mode
print('macOS 更新替换、复制失败、替换失败、重启失败及退出取消检查通过。')
