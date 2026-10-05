#!/usr/bin/env python3
"""从变更日志提取指定版本的发布说明。"""

import argparse
from pathlib import Path
import re
import sys


def extract_notes(changelog: str, tag: str) -> str:
    """只提取精确匹配的版本，缺失或空说明时阻止发布。"""
    if not re.fullmatch(r"v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?", tag):
        raise ValueError(f"无效的版本标签：{tag}")
    version = tag.removeprefix("v")
    sections = re.split(r"(?m)^## ", changelog)
    matches = [section for section in sections[1:]
               if section.splitlines()[0].startswith(f"[{version}] - ")]
    if len(matches) != 1:
        raise ValueError(f"CHANGELOG.md 必须有且仅有一个 [{version}] 版本段落")
    section = matches[0]
    body = section.partition("\n")[2]
    if not any(line.strip() and not line.lstrip().startswith(("#", "<!--"))
               for line in body.splitlines()):
        raise ValueError(f"[{version}] 的发布说明为空")
    # 历史版本保留原文，新版本发布必须同时提供中英文说明。
    if tuple(map(int, version.split("-")[0].split("."))) >= (0, 1, 7):
        for language in ("English", "简体中文"):
            parts = re.findall(r"(?ms)^### " + re.escape(language) + r"\s*\n(.*?)(?=^### |\Z)", body)
            if len(parts) != 1 or not any(line.startswith("- ") and line[2:].strip()
                                         for line in parts[0].splitlines()):
                raise ValueError(f"[{version}] 必须包含非空的 ### {language} 发布说明")
    return "## " + section.strip() + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("tag", help="版本标签，例如 v0.1.4")
    args = parser.parse_args()
    try:
        changelog = (Path(__file__).resolve().parent.parent / "CHANGELOG.md").read_text(encoding="utf-8")
        print(extract_notes(changelog, args.tag), end="")
    except (ValueError, OSError) as error:
        sys.exit(str(error))


if __name__ == "__main__":
    main()
