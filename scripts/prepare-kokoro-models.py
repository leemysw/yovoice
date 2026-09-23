"""使用 audio.cpp v0.7.4 的转换器生成原生 Kokoro 包；Python 仅用于制作模型。"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

WEIGHTS = {
    '1.0': ('kokoro-v1_0.pth', '496dba118d1a58f5f3db2efc88dbdc216e0483fc89fe6e47ee1f2c53f18ad1e4'),
    '1.1-zh': ('kokoro-v1_1-zh.pth', 'b1d8410fa44dfb5c15471fd6c4225ea6b4e9ac7fa03c98e8bea47a9928476e2b'),
}


def chinese_v11(table, vocab):
    from misaki.zh_frontend import ZHFrontend
    frontend = ZHFrontend()
    # 复用官方前端制作词级读音，保留词内变调和儿化；推理时无需 Python。
    words = set(table['phrases']) | set(table['frequency']) | set(table['chars'])
    ipa, chars, phrases = {'': ''}, {}, {}
    for word in sorted(words):
        if not word or not all('\u4e00' <= char <= '\u9fff' for char in word):
            continue
        try:
            phonemes = frontend(word)[0]
        except (IndexError, ValueError, AssertionError):
            continue
        if not phonemes or set(phonemes) - set(vocab):
            continue
        key = '@' + word
        ipa[key] = phonemes
        if len(word) == 1:
            chars[word] = key
        else:
            phrases[word] = [key] + [''] * (len(word) - 1)
    # 检查新版符号和变调，避免误用 v1.0 的 IPA 映射。
    for word in ('你好', '一百', '不是', '中国', '小院儿'):
        assert ipa['@' + word] == frontend(word)[0], word
    table.update(chars=chars, phrases=phrases, ipa=ipa)
    return table


def prepare(source, upstream, output, version):
    import torch
    filename, digest = WEIGHTS[version]
    weights = source / filename
    if hashlib.sha256(weights.read_bytes()).hexdigest() != digest:
        raise ValueError('官方 Kokoro 权重校验失败')
    spec = importlib.util.spec_from_file_location('kokoro_converter', upstream / 'tools/prepare_kokoro_gguf.py')
    converter = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(converter)
    original_tables = converter.load_g2p_tables
    config = json.loads((source / 'config.json').read_text())
    if version == '1.1-zh':
        def load_tables():
            files = original_tables()
            table = chinese_v11(json.loads(files['g2p/zh.json']), config['vocab'])
            files['g2p/zh.json'] = json.dumps(table, ensure_ascii=False, separators=(',', ':')).encode()
            return files
        converter.load_g2p_tables = load_tables
        def load_weights(source):
            result = {}
            converter.flatten_torch_state('', torch.load(source / filename, map_location='cpu'), result)
            return result
        converter.load_official_weights = load_weights
    voices = sorted(path.stem for path in (source / 'voices').glob('*.pt'))
    assert len(voices) == (54 if version == '1.0' else 103)
    languages = ['en-us', 'en-gb', 'es', 'fr-fr', 'hi', 'it', 'ja', 'pt-br', 'zh'] if version == '1.0' else ['en-us', 'en-gb', 'zh']
    class Writer(converter.ResourceWriter):
        def add_name(self, name):
            super().add_name(f'Kokoro {version} Q8_0')
        def add_array(self, key, values):
            super().add_array(key, languages if key == 'kokoro.languages' else values)
    converter.ResourceWriter = Writer
    model_spec = json.loads((upstream / 'model_specs/kokoro_tts.json').read_text())
    model_spec.update(display_name=f'Kokoro 82M {version}', description=f'Kokoro {version}, {len(voices)} built-in voices, native pronunciation resources.', languages=languages, status='experimental', packages=[])
    model_spec['ui'].update(builtin_voices=voices, default_voice='zf_xiaobei' if version == '1.0' else 'zf_001')
    model_spec['ui'].pop('recommended_package', None)
    model_spec.pop('package_defaults', None)
    output.mkdir(parents=True, exist_ok=True)
    spec_path = output / f'kokoro-{version}.json'
    spec_path.write_text(json.dumps(model_spec, ensure_ascii=False))
    # v1.1-zh 不使用日文词典；只附带中英文资源，避免增加无用体积。
    original_source = converter.load_official_source
    def load_source(source, multilingual):
        import espeakng_loader
        import importlib.metadata
        config, voices, files, weights = original_source(source, multilingual)
        if version == '1.1-zh':
            converter.add_tree(files, Path(espeakng_loader.get_data_path()), 'espeak-ng-data')
            for name in ['misaki', 'jieba', 'pypinyin']:
                dist = importlib.metadata.distribution(name)
                for entry in dist.files or []:
                    if any(word in entry.name.lower() for word in ['license', 'copying', 'notice']):
                        files['licenses/' + name + '-' + entry.name] = Path(dist.locate_file(entry)).read_bytes()
        repo = Path(__file__).resolve().parents[1]
        files['licenses/Kokoro-Apache-2.0.txt'] = (repo / 'LICENSE').read_bytes()
        files['licenses/espeak-ng-COPYING.txt'] = (repo / 'scripts/licenses/espeak-ng-COPYING.txt').read_bytes()
        return config, voices, files, weights
    converter.load_official_source = load_source
    target = output / f'kokoro-82m-{version}-multilingual-q8_0.gguf'
    converter.convert(source, target, 'q8_0', True, spec_path, version == '1.0')
    print(json.dumps({'path': str(target), 'size': target.stat().st_size, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest(), 'voices': voices}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--audio-cpp', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--version', choices=list(WEIGHTS), required=True)
    args = parser.parse_args()
    prepare(args.source, args.audio_cpp, args.output, args.version)
