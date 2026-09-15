"""检查本地服务的凭证、来源限制、音频读取和宿主退出清理。"""
import base64
import io
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
import urllib.error
import urllib.request
import wave

repo = Path(__file__).resolve().parents[2]
resources = repo / 'artifacts/macos-arm64/yovoice.app/Contents/Resources'
with tempfile.TemporaryDirectory(prefix='workbench-service-') as root:
    secret = secrets.token_hex(32)
    env = dict(os.environ, WORKBENCH_DATA=root, WORKBENCH_TOKEN=secret, WORKBENCH_WEB=str(resources / 'web'), WORKBENCH_ENGINE=str(resources / 'engine/audiocpp_server'))
    process = subprocess.Popen([str(resources / 'service/yovoice-service')], env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    try:
        origin = process.stdout.readline().strip()
        assert origin.startswith('http://127.0.0.1:')
        cookie = f'vw-{secret[:12]}={secret}'

        def request(path, body=None, headers=None, authenticated=True):
            values = {'Cookie': cookie} if authenticated else {}
            values.update(headers or {})
            data = json.dumps(body).encode() if body is not None else None
            if data is not None:
                values['Content-Type'] = 'application/json'
            try:
                with urllib.request.urlopen(urllib.request.Request(origin + path, data=data, headers=values), timeout=5) as response:
                    return response.status, response.read()
            except urllib.error.HTTPError as error:
                return error.code, error.read()

        def call(method, data=None):
            status, body = request('/api/call', {'id': 'test', 'method': method, 'data': data or {}})
            result = json.loads(body)
            assert status == 200 and 'error' not in result, result
            return result['result']

        assert request('/', authenticated=False)[0] == 403
        assert request('/', headers={'Origin': 'https://untrusted.invalid'})[0] == 403
        assert request('/')[0] == 200
        assert call('state.get')['state']['runtimeBackend'] == 'metal'
        call('preferences.save', {'backend': 'cpu', 'downloadSource': 'modelscope'})
        assert call('state.get')['state']['runtimeBackend'] == 'cpu'
        draft = {'id': 'a' * 32, 'title': '删除测试', 'text': '临时草稿'}
        call('draft.save', draft)
        call('draft.delete', {'id': draft['id']})
        assert all(item['id'] != draft['id'] for item in call('state.get')['state']['drafts'])
        stream = io.BytesIO()
        with wave.open(stream, 'wb') as audio:
            audio.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
            audio.writeframes(bytes(64000))
        voice = call('voice.record', {'name': '服务测试', 'base64': base64.b64encode(stream.getvalue()).decode()})
        status, data = request('/media/voices/' + voice['fileName'], headers={'Range': 'bytes=0-43'})
        assert status == 206 and len(data) == 44 and data.startswith(b'RIFF')
        process.stdin.close()
        assert process.wait(timeout=10) == 0
        print('服务检查通过：凭证、来源、设备切换、WAV、Range 和退出清理。')
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
