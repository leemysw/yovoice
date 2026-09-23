"""提取固定版本的原生发音库；安装包不依赖 Python。"""
import hashlib
import json
from pathlib import Path
import platform
import shutil
import sys
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
WHEELS = {
    'Darwin': [
        ('espeakng-loader', '0.2.4', 'espeakng_loader-0.2.4-py3-none-macosx_11_0_arm64.whl', 'd27cdca31112226e7299d8562e889d3e38a1e48055c9ee381b45d669072ee59f'),
        ('fugashi', '1.5.2', 'fugashi-1.5.2-cp311-cp311-macosx_11_0_arm64.whl', 'f855953ac6c98cf239d407d341e3298a54119c8de88217037f012096e41ebe7b'),
    ],
    'Windows': [
        ('espeakng-loader', '0.2.4', 'espeakng_loader-0.2.4-py3-none-win_amd64.whl', '41f1e08ac9deda2efd1ea9de0b81dab9f5ae3c4b24284f76533d0a7b1dd7abd7'),
        ('fugashi', '1.5.2', 'fugashi-1.5.2-cp311-cp311-win_amd64.whl', '5c5e04cb808f5cd46fc682469702f1e34f6199a264514e5c21b1e17ea4f8313f'),
    ],
    'Linux': [
        ('espeakng-loader', '0.2.4', 'espeakng_loader-0.2.4-py3-none-manylinux_2_17_x86_64.manylinux2014_x86_64.whl', '08721baf27d13d461f6be6eed9a65277e70d68234ff484fd8b9897b222cdcb6d'),
        ('fugashi', '1.5.2', 'fugashi-1.5.2-cp311-cp311-manylinux2014_x86_64.manylinux_2_17_x86_64.whl', 'ff899e1767024ba8bc53d8a2cf90bca19a6a54b14ddf05a75d04169f7acb262c'),
    ],
}


def package(destination):
    system = platform.system()
    arch = platform.machine().lower()
    if (system == 'Darwin' and arch != 'arm64') or (system != 'Darwin' and arch not in ('amd64', 'x86_64')):
        raise SystemExit('Kokoro 仅支持 macOS ARM64、Windows x64 和 Linux x64')
    destination.mkdir(parents=True, exist_ok=True)
    cache = ROOT / 'artifacts/downloads'
    cache.mkdir(parents=True, exist_ok=True)
    manifest = []
    for project, version, name, digest in WHEELS[system]:
        path = cache / name
        if not path.exists():
            with urllib.request.urlopen(f'https://pypi.org/pypi/{project}/{version}/json') as response:
                info = json.load(response)
            source = next(item['url'] for item in info['urls'] if item['filename'] == name and item['digests']['sha256'] == digest)
            partial = path.with_suffix('.partial')
            urllib.request.urlretrieve(source, partial)
            partial.replace(path)
        if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise SystemExit(f'Kokoro 依赖校验失败：{name}')
        libraries = []
        with zipfile.ZipFile(path) as archive:
            for entry in archive.infolist():
                member = Path(entry.filename)
                native = member.name.endswith(('.dylib', '.dll')) or '.so.' in member.name or member.name == 'libespeak-ng.so'
                license_file = any(word in member.name.lower() for word in ('license', 'copying', 'notice'))
                if entry.is_dir() or not (native or license_file):
                    continue
                library_name = member.name
                if library_name.startswith('libmecab'):
                    library_name = {'Windows': 'libmecab.dll', 'Linux': 'libmecab.so.2', 'Darwin': 'libmecab.2.dylib'}[system]
                target = destination / (library_name if native else f'{project}-{member.name}')
                with archive.open(entry) as source, target.open('wb') as output:
                    shutil.copyfileobj(source, output)
                if native:
                    libraries.append(library_name)
        if not libraries:
            raise SystemExit(f'依赖包缺少原生动态库：{name}')
        manifest.append({'project': project, 'version': version, 'wheel': name, 'sha256': digest, 'libraries': libraries})
    shutil.copy2(ROOT / 'scripts/licenses/espeak-ng-COPYING.txt', destination)
    (destination / 'kokoro-runtime.json').write_text(json.dumps(manifest, indent=2) + '\n')


if __name__ == '__main__':
    package(Path(sys.argv[1]))
