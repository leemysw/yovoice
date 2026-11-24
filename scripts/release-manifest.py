#!/usr/bin/env python3
"""生成随版本上传的 latest.json，供桌面应用检查更新。

桌面应用从 github.com/leemysw/yovoice/releases/latest/download/latest.json 读取它，
走普通文件下载，不受 GitHub 未登录接口每个 IP 每小时 60 次的限制。
字段与 GitHub Releases 接口一致，应用沿用同一套解析与校验。
"""

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sys

REPOSITORY = "leemysw/yovoice"
MANIFEST = "latest.json"


def build_manifest(tag: str, names: list[str], notes: str, published_at: str) -> dict:
    """按发布目录里的文件生成清单；下载地址只指向本版本的发布文件。"""
    if not re.fullmatch(r"v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?", tag):
        raise ValueError(f"无效的版本标签：{tag}")
    files = sorted(name for name in names if name != MANIFEST)
    if not files or any("/" in name or not name.strip() for name in files):
        raise ValueError("发布文件列表无效")
    if not notes.strip():
        raise ValueError("发布说明为空")
    return {
        "tag_name": tag,
        "draft": False,
        "prerelease": "-" in tag,
        "published_at": published_at,
        "body": notes,
        "assets": [{"name": name,
                    "browser_download_url": f"https://github.com/{REPOSITORY}/releases/download/{tag}/{name}"}
                   for name in files],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("tag", help="版本标签，例如 v0.9.0")
    parser.add_argument("release_dir", help="待上传的发布文件目录，清单写入其中")
    parser.add_argument("notes", help="发布说明文件")
    args = parser.parse_args()
    directory = Path(args.release_dir)
    try:
        manifest = build_manifest(
            args.tag,
            [path.name for path in directory.iterdir() if path.is_file()],
            Path(args.notes).read_text(encoding="utf-8"),
            datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        )
    except (OSError, ValueError) as error:
        print(error, file=sys.stderr)
        raise SystemExit(1)
    (directory / MANIFEST).write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
