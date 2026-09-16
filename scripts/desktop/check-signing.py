"""用隔离的命令替身检查发布签名顺序与失败门禁，不访问证书或 Apple 服务。"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

repo = Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory(prefix='yovoice-signing-check-') as temporary:
    root = Path(temporary)
    commands = root / 'bin'
    commands.mkdir()
    log = root / 'calls.jsonl'
    stub = commands / 'stub'
    stub.write_text(f'#!{sys.executable}\n' + '''import json, os, sys
from pathlib import Path
name = Path(sys.argv[0]).name
args = sys.argv[1:]
with open(os.environ['CHECK_LOG'], 'a') as file: file.write(json.dumps([name, *args]) + '\\n')
if name == 'lipo': print(os.environ.get('CHECK_ARCH', 'arm64'))
if name == 'ditto': Path(args[-1]).touch()
if name == 'xcrun' and args[:2] == ['notarytool', 'submit']:
    print(json.dumps({'status': os.environ.get('CHECK_STATUS', 'Accepted'), 'id': 'test-request'}))
''')
    stub.chmod(0o755)
    for name in ['codesign', 'lipo', 'ditto', 'xcrun', 'spctl']:
        (commands / name).symlink_to(stub)
    app = root / 'yovoice.app'
    app.mkdir()
    base = dict(os.environ, PATH=str(commands) + os.pathsep + os.environ['PATH'], CHECK_LOG=str(log),
                YOVOICE_CODESIGN_IDENTITY='-', YOVOICE_NOTARIZE='0', YOVOICE_NOTARY_PROFILE='test-profile')

    def run(target=app, **overrides):
        log.write_text('')
        result = subprocess.run(['bash', str(repo / 'scripts/desktop/sign-macos.sh'), str(target)],
                                env=dict(base, **overrides), capture_output=True, text=True)
        calls = [json.loads(line) for line in log.read_text().splitlines()]
        return result, calls

    result, calls = run()
    assert result.returncode == 0, result.stderr
    assert not any(call[0] == 'xcrun' for call in calls)
    result, calls = run(YOVOICE_NOTARIZE='1')
    assert result.returncode != 0 and not calls, '正式发布不能退回临时签名'
    identity = 'Developer ID Application: Test (TESTTEAM)'
    result, calls = run(YOVOICE_CODESIGN_IDENTITY=identity, YOVOICE_NOTARIZE='1')
    assert result.returncode == 0, result.stderr
    signed = [call for call in calls if call[0] == 'codesign' and '--sign' in call]
    assert len(signed) == 4 and all('--timestamp' in call and 'runtime' in call for call in signed)
    assert signed[0][-1].endswith('/service/yovoice-service')
    assert signed[1][-1].endswith('/engine/audiocpp_server')
    assert signed[2][-1].endswith("/tools/ffmpeg")
    assert signed[3][-1] == str(app)
    submit = next(i for i, call in enumerate(calls) if call[:3] == ['xcrun', 'notarytool', 'submit'])
    staple = next(i for i, call in enumerate(calls) if call[:3] == ['xcrun', 'stapler', 'staple'])
    assert submit < staple and calls[-1][0] == 'spctl'
    result, calls = run(YOVOICE_CODESIGN_IDENTITY=identity, YOVOICE_NOTARIZE='1', CHECK_STATUS='Invalid')
    assert result.returncode != 0 and not any(call[:2] == ['xcrun', 'stapler'] for call in calls)
    dmg = root / 'yovoice.dmg'
    dmg.touch()
    result, calls = run(dmg, YOVOICE_CODESIGN_IDENTITY=identity, YOVOICE_NOTARIZE='1')
    assert result.returncode == 0, result.stderr
    assert any(call[:3] == ['xcrun', 'stapler', 'validate'] for call in calls)
    result, calls = run(CHECK_ARCH='x86_64')
    assert result.returncode != 0 and not any(call[0] == 'codesign' for call in calls)
    cli = root / 'yovoice'
    cli.touch()
    result, calls = run(cli, YOVOICE_CODESIGN_IDENTITY=identity, YOVOICE_NOTARIZE='1')
    assert result.returncode == 0, result.stderr
    signed = [call for call in calls if call[0] == 'codesign' and '--sign' in call]
    assert len(signed) == 2 and all('--timestamp' in call and 'runtime' in call for call in signed)
    assert signed[0][-1].endswith('/tools/ffmpeg')
    assert any(call[:3] == ['xcrun', 'notarytool', 'submit'] for call in calls)
    assert not any(call[:2] == ['xcrun', 'stapler'] for call in calls)
    result, calls = run(cli, YOVOICE_CODESIGN_IDENTITY=identity, YOVOICE_NOTARIZE='1', CHECK_STATUS='Invalid')
    assert result.returncode != 0, 'CLI 公证失败必须阻止打包'
    # 只执行构建脚本的进程门禁，确认运行中不允许覆盖 App。
    build = (repo / 'scripts/desktop/build-macos.sh').read_text()
    guard = build[build.index('ensure_app_stopped() {'):build.index('\nensure_app_stopped\n')]
    (commands / 'ps').write_text('#!/bin/bash\nprintf "%s\\n" "$CHECK_PROCESS"\n')
    (commands / 'ps').chmod(0o755)
    destination = 'artifacts/macos-arm64/yovoice.app'
    executable = str(repo / destination / 'Contents/MacOS/VoiceWorkbenchMac')
    for process, expected in [(executable, 1), ('/usr/bin/other', 0)]:
        result = subprocess.run(['bash', '-c', f'destination={destination}\n{guard}\nensure_app_stopped'],
                                cwd=repo, env=dict(base, CHECK_PROCESS=process), capture_output=True, text=True)
        assert result.returncode == expected, result.stderr
print('签名顺序、arm64 边界、公证失败门禁通过；未调用真实认证服务。')
