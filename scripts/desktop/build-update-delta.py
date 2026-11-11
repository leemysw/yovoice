"""从上一正式版生成桌面更新补丁，并用客户端的重建命令验证结果。"""

import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

# 0.6.0 及更早的客户端不会查找差分包，自带的服务程序也不能重建，从这些版本升级不发布补丁。
FIRST_DELTA_BASE = (0, 6, 1)


def number(tag):
    return tuple(map(int, tag[1:].split(".")))


def run(*args):
    subprocess.run(args, check=True)


def sha(path):
    with path.open("rb") as stream:
        digest = hashlib.sha256()
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
        return digest.hexdigest()


class DeltaBuild:
    def __init__(self, tag, temp):
        self.tag = tag
        self.temp = temp
        self.artifacts = Path("artifacts").resolve()
        self.windows = sys.platform == "win32"
        self.platform = "windows-x64" if self.windows else "macos-arm64"

    def previous_version(self):
        releases = json.loads(subprocess.check_output([
            "gh", "release", "list", "--exclude-drafts", "--exclude-pre-releases",
            "--limit", "100", "--json", "tagName",
        ]))
        versions = [row["tagName"] for row in releases if re.fullmatch(r"v\d+\.\d+\.\d+", row["tagName"])]
        return max((tag for tag in versions if number(tag) < number(self.tag)), default=None, key=number)

    def download(self, previous):
        suffix = "windows-x64-setup.exe" if self.windows else "macos-arm64.zip"
        name = f"yovoice-{previous}-{suffix}"
        run("gh", "release", "download", previous, "--dir", self.temp,
            "-p", name, "-p", "SHA256SUMS.txt")
        package = self.temp / name
        hashes = [line.split()[0] for line in (self.temp / "SHA256SUMS.txt").read_text().splitlines()
                  if len(line.split()) == 2 and line.split()[1].removeprefix("*").removeprefix("./") == name]
        if hashes != [sha(package)]:
            raise ValueError(f"旧版安装包校验失败：{name}")
        return package

    def windows_target(self):
        # 安装器从重建目录取文件，每个外部文件的哈希都编译进可签名的安装器。
        source = self.artifacts / "windows-x64"
        new = self.temp / "new"
        shutil.copytree(source, new, ignore=lambda path, names: {"engine"} if Path(path) == source else set())
        lines = []
        for file in sorted(new.rglob("*")):
            if not file.is_file():
                continue
            rel = file.relative_to(new)
            if any(char in str(rel) for char in '{}"#\r\n'):
                raise ValueError(f"Inno 文件路径无效：{rel}")
            dest = "{app}" if rel.parent == Path(".") else "{app}\\" + str(rel.parent)
            lines.append(f'Source: "{{src}}\\{rel}"; DestDir: "{dest}"; ExternalSize: {file.stat().st_size}; '
                         f'Hash: "{sha(file)}"; Flags: external ignoreversion')
        include = self.temp / "delta-files.iss"
        include.write_text("\n".join(lines), encoding="utf-8-sig")
        compiler = shutil.which("ISCC.exe") or str(Path(os.environ["ProgramFiles(x86)"]) / "Inno Setup 6/ISCC.exe")
        run(compiler, "/DAppOnly", f"/DDeltaFiles={include}", f"/DAppVersion={self.tag[1:]}",
            f"/DOutputDir={new}", "/DOutputName=delta-install", f"/DAppDir={new}",
            f"/DBootstrapper={self.artifacts / 'downloads/MicrosoftEdgeWebView2Setup.exe'}",
            "desktop/windows/installer/yovoice.iss")
        run("pwsh", "-NoProfile", "-File", "scripts/desktop/sign-windows.ps1", "-Path", new / "delta-install.exe")
        return new

    def build(self, installed=None):
        # 在常规 Windows CI 中复用刚安装的应用，验证重建、Inno 覆盖安装及卸载。
        previous = "v0.0.0" if installed else self.previous_version()
        if not previous:
            print("没有旧正式版，本次仅发布完整更新包。")
            return
        if not installed and number(previous) < FIRST_DELTA_BASE:
            print(f"{previous} 不支持差分更新，本次仅发布完整更新包。")
            return
        package = None if installed else self.download(previous)
        if self.windows:
            new = self.windows_target()
            old = installed or self.temp / "installed"
            # 在独立发布运行器上安装校验过的旧 CPU 版本，与真实安装布局一致。
            child_env = {k: v for k, v in os.environ.items() if not k.startswith(("WINDOWS_SIGN_", "GH_TOKEN"))}
            if not installed:
                subprocess.run([package, "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", f"/DIR={old}"],
                               check=True, env=child_env)
            # 单独取应用文件作为基准，保留安装目录供后续安装测试。
            base = self.temp / "base"
            shutil.copytree(old, base, ignore=lambda path, names: {
                name for name in names if Path(path) == old and (name == "engine" or name.startswith("unins"))
            })
            full = self.artifacts / "yovoice-windows-x64-update.exe"
            # 客户端用已安装旧版自带的服务程序重建，这里同样用旧版的验证。
            service = old / "service/yovoice-service.exe"
        else:
            run("ditto", "-x", "-k", package, self.temp)
            old = base = self.temp / "yovoice.app"
            new = self.artifacts / "macos-arm64/yovoice.app"
            full = self.artifacts / "yovoice-macos-arm64.zip"
            service = old / "Contents/Resources/service/yovoice-service"
        delta = self.temp / f"yovoice-{previous}-to-{self.tag}-{self.platform}.delta"
        run("go", "run", "./cmd/yovoice-delta", previous[1:], self.tag[1:], base, new, delta)
        if not installed and delta.stat().st_size >= full.stat().st_size:
            print("补丁大于等于常规更新包，跳过发布。")
            return
        rebuilt = self.temp / ("rebuilt" if self.windows else "rebuilt.app")
        run(service, "--apply-update-delta", delta, previous[1:], self.tag[1:], old, rebuilt)
        if self.windows:
            engine = old / "engine/audiocpp_server.exe"
            original_engine = sha(engine)
            subprocess.run([rebuilt / "delta-install.exe", "/VERYSILENT", "/SUPPRESSMSGBOXES",
                            "/NORESTART", f"/DIR={old}"], check=True, env=child_env)
            for file in new.rglob("*"):
                if file.is_file() and file != new / "delta-install.exe" and sha(old / file.relative_to(new)) != sha(file):
                    raise ValueError(f"安装后文件不匹配：{file}")
            if sha(engine) != original_engine:
                raise ValueError("差分更新修改了内核")
        else:
            run("codesign", "--verify", "--deep", "--strict", rebuilt)
            run("spctl", "--assess", "--type", "execute", rebuilt)
        if not installed:
            shutil.copyfile(delta, self.artifacts / delta.name)
        print(f"{self.platform}: {full.stat().st_size} → {delta.stat().st_size} bytes")


if __name__ == "__main__":
    tag = sys.argv[1]
    if not re.fullmatch(r"v\d+\.\d+\.\d+", tag):
        raise SystemExit(f"版本标签无效：{tag}")
    with tempfile.TemporaryDirectory() as directory:
        installed = Path(sys.argv[2]) if len(sys.argv) == 3 else None
        DeltaBuild(tag, Path(directory)).build(installed)
