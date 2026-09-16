"""从固定源码构建仅支持参考音频转 WAV 的 FFmpeg，并复制到安装包。"""
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tarfile

root = Path(__file__).resolve().parents[1]
version = '8.1.2'
digest = '464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c'
system = platform.system()
arch = 'arm64' if platform.machine().lower() in ('arm64', 'aarch64') else 'x64'
name = {'Darwin': 'macos', 'Windows': 'windows', 'Linux': 'linux'}.get(system)
if (name, arch) not in [('macos', 'arm64'), ('windows', 'x64'), ('linux', 'x64')]:
    raise SystemExit('不支持的 FFmpeg 构建平台')
output = root / 'artifacts' / 'ffmpeg' / f'{name}-{arch}'
executable = output / ('ffmpeg.exe' if system == 'Windows' else 'ffmpeg')
archive = root / 'artifacts' / 'downloads' / f'ffmpeg-{version}.tar.xz'
flags = [
    '--disable-everything', '--disable-autodetect', '--disable-network', '--disable-doc',
    '--disable-debug', '--disable-ffplay', '--disable-ffprobe', '--disable-avdevice',
    '--disable-swscale', '--disable-x86asm', '--enable-small', '--enable-static', '--disable-shared',
    '--enable-ffmpeg', '--enable-protocol=file',
    '--enable-demuxer=wav,mp3,mov,aac,flac,ogg,aiff,asf,matroska',
    '--enable-decoder=mp3,mp3float,aac,alac,flac,vorbis,opus,wmav1,wmav2,pcm_s16le,pcm_s16be,pcm_s24le,pcm_s24be,pcm_s32le,pcm_s32be,pcm_f32le,pcm_f32be,pcm_f64le,pcm_f64be,pcm_u8,pcm_alaw,pcm_mulaw',
    '--enable-parser=mpegaudio,aac,flac,vorbis,opus', '--enable-muxer=wav',
    '--enable-encoder=pcm_s16le', '--enable-filter=aresample,aformat,anull', '--extra-cflags=-Os',
]
if system == 'Windows':
    flags += ['--target-os=mingw32', '--extra-ldflags=-static']
elif system == 'Darwin':
    # 与桌面应用的最低 macOS 版本一致，不继承构建机系统版本。
    flags += ['--extra-cflags=-mmacosx-version-min=14.0', '--extra-ldflags=-mmacosx-version-min=14.0']
fingerprint = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
stamp = output / 'build.json'
archive.parent.mkdir(parents=True, exist_ok=True)
if not archive.exists():
    partial = archive.with_suffix('.part')
    subprocess.run(['curl', '-fL', '--retry', '3', f'https://ffmpeg.org/releases/{archive.name}', '-o', str(partial)], check=True)
    partial.replace(archive)
if hashlib.sha256(archive.read_bytes()).hexdigest() != digest:
    raise SystemExit('FFmpeg 源码校验失败，请删除下载缓存后重试')
if not executable.exists() or not stamp.exists() or json.loads(stamp.read_text()).get('fingerprint') != fingerprint:
    work = root / 'artifacts' / 'ffmpeg-build' / f'{name}-{arch}'
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True)
    with tarfile.open(archive) as package:
        package.extractall(work, filter='data')
    source = work / f'ffmpeg-{version}'
    build = work / 'build'
    build.mkdir()
    output.mkdir(parents=True, exist_ok=True)
    log = work / 'build.log'
    print(f'构建精简 FFmpeg {version}，日志：{log}', flush=True)
    with log.open('w') as stream:
        for command in [ ['bash', f'../ffmpeg-{version}/configure', *flags], ['make', '-j', str(min(os.cpu_count() or 2, 8)), executable.name] ]:
            # Windows 默认先搜索系统目录，显式解析 PATH，避免误启动 WSL 的 bash。
            command[0] = shutil.which(command[0]) or command[0]
            result = subprocess.run(command, cwd=build, stdout=stream, stderr=subprocess.STDOUT)
            if result.returncode:
                stream.flush()
                raise SystemExit(log.read_text(errors='replace')[-6000:])
    shutil.copy2(build / executable.name, executable)
    shutil.copy2(source / 'COPYING.LGPLv2.1', output / 'FFmpeg-LICENSE.txt')
    stamp.write_text(json.dumps({'version': version, 'source': f'https://ffmpeg.org/releases/{archive.name}', 'sha256': digest, 'configure': flags, 'fingerprint': fingerprint}, indent=2) + '\n')
# 发布对应源码及构建脚本，用户无需下载源码包即可使用转换功能。
source_bundle = root / 'artifacts' / 'yovoice-ffmpeg-source.tar.gz'
with tarfile.open(source_bundle, 'w:gz') as package:
    package.add(archive, arcname=archive.name)
    package.add(__file__, arcname='scripts/build-ffmpeg.py')
if len(sys.argv) > 1:
    destination = Path(sys.argv[1])
    destination.mkdir(parents=True, exist_ok=True)
    for filename in (executable.name, 'FFmpeg-LICENSE.txt', 'build.json'):
        shutil.copy2(output / filename, destination / filename)
print(f'{executable}: {executable.stat().st_size / 1024 / 1024:.2f} MiB', flush=True)
