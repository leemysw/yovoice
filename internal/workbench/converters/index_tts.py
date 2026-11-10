"""将已下载的 IndexTTS 2.0/2.5 检查点转换为 audio.cpp GGUF。

检查点布局参考 audio.cpp 的 convert_index_tts2_5.py（Apache-2.0，ShugoAI LLC）。
"""

import argparse
import json
import re
import shutil
import subprocess
from pathlib import Path

import torch
from safetensors.torch import save_file

SIDECARS = ("config.json", "generation_config.json", "tokenizer.json",
            "tokenizer_config.json", "vocab.json", "merges.txt")


def load(path):
    return torch.load(path, map_location="cpu", weights_only=True)


def flatten(value, prefix=""):
    if isinstance(value, dict):
        for key, child in value.items():
            yield from flatten(child, f"{prefix}{key}.")
    elif isinstance(value, torch.Tensor):
        yield prefix.rstrip("."), value.contiguous()
    else:
        raise TypeError(f"非张量数据：{prefix}")


def weights(value, *keys):
    for key in keys:
        if isinstance(value, dict) and isinstance(value.get(key), dict):
            return value[key]
    return value


def convert(source, stage, output, converter, variant, precision, stage_only=False):
    cache = source / "hf_cache"
    qwen = "qwen0.6bemo4-merge"
    campplus = cache / "campplus_cn_common.bin"
    if not campplus.is_file():
        campplus = cache / "campplus" / campplus.name
    v25 = variant == "2.5"
    vocabulary = ["multilingual_zh_ja_yue_char_del.tiktoken"] if v25 else ["bpe.model", "pinyin.vocab"]
    sidecars = {name: source / name for name in vocabulary}
    sidecars.update({f"{qwen}/{name}": source / qwen / name for name in SIDECARS})
    for name in ("w2v-bert-2.0/config.json", "w2v-bert-2.0/preprocessor_config.json", "bigvgan/config.json"):
        sidecars[name] = cache / name
    direct = {
        "wav2vec2bert": cache / "w2v-bert-2.0/model.safetensors",
        "qwen_emotion": source / qwen / "model.safetensors",
    }
    if not v25:
        direct["semantic_codec"] = cache / "semantic_codec_model.safetensors"
    required = [source / name for name in ("config.yaml", "gpt.pth", "s2mel.pth", "feat1.pt",
                 "feat2.pt", "wav2vec2bert_stats.pt")]
    required.extend([campplus, cache / "bigvgan/bigvgan_generator.pt"])
    if v25:
        required.append(source / "codec.pth")
    for path in [*required, *sidecars.values(), *direct.values()]:
        if not path.is_file():
            raise FileNotFoundError(path)
    stage.mkdir()
    root = stage / "root"
    root.mkdir()
    config = (source / "config.yaml").read_text(encoding="utf-8")
    config, replaced = re.subn(r"(?m)^version:[^\n]*", f'version: "{variant}"', config, count=1)
    if not replaced:
        config = f'version: "{variant}"\n' + config
    (root / "config.yaml").write_text(config, encoding="utf-8")
    for name, path in sidecars.items():
        dest = root / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, dest)

    command = [str(converter)]

    def save(namespace, tensors):
        path = stage / f"{namespace}.safetensors"
        save_file(dict(tensors), str(path))
        command.extend(["--input", f"{namespace}={path}"])

    save("gpt", ((k.removeprefix("module."), v) for k, v in
                 flatten(weights(load(source / "gpt.pth"), "model", "state_dict"))))
    save("s2mel", flatten(weights(load(source / "s2mel.pth"), "net")))
    if v25:
        save("semantic_codec", flatten(weights(load(source / "codec.pth"), "model")))
    for namespace, name in (("speaker_matrix", "feat1.pt"), ("emotion_matrix", "feat2.pt")):
        save(namespace, {"tensor": load(source / name).float().contiguous()})
    save("wav2vec2bert_stats", ((k, v.float().contiguous()) for k, v in
                              flatten(load(source / "wav2vec2bert_stats.pt"))))
    save("campplus", ((f"speaker_encoder.{k.removeprefix('speaker_encoder.')}", v)
                      for k, v in flatten(load(campplus))))
    save("bigvgan", ((k.removeprefix("generator."), v) for k, v in
                     flatten(load(cache / "bigvgan/bigvgan_generator.pt"))))
    for namespace, path in direct.items():
        command.extend(["--input", f"{namespace}={path}"])
    command.extend(["--root", str(root), "--family", "index_tts2",
                    "--type", precision, "--output", str(output)])
    if stage_only:
        (stage / "command.json").write_text(json.dumps(command[1:]), encoding="utf-8")
    else:
        subprocess.run(command, check=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("stage", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("converter", type=Path)
    parser.add_argument("variant", choices=("2.0", "2.5"))
    parser.add_argument("precision", choices=("q8_0", "f16"))
    parser.add_argument("--stage-only", action="store_true")
    args = parser.parse_args()
    version = re.match(r"^(\d+)\.(\d+)", torch.__version__)
    if version is None or tuple(map(int, version.groups())) < (2, 6):
        parser.exit(2, "PyTorch 2.6 or newer is required for weights-only loading.\n")
    convert(args.source, args.stage, args.output, args.converter, args.variant, args.precision, args.stage_only)


if __name__ == "__main__":
    main()
