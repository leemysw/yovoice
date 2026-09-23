# Kokoro 原生模型包

Kokoro 使用内置音色，不需要参考录音。v1.0 包含 54 个音色，支持中文、英语（美式与英式）、日语、西班牙语、法语、印地语、意大利语和巴西葡萄牙语。v1.1-zh 包含 100 个中文音色及 Maple、Sol、Vale 三个英文音色；不能沿用 v1.0 的音色 ID。

当前目录中的两个 Q8 包由官方权重转换，尚未上传下载源。在设置中导入生成的 GGUF；只有大小和 SHA-256 与目录一致的包才会被接受。不能用普通 v1.0 GGUF 替代多语言包，也不能直接导入 PyTorch 权重。模型发布后再更新目录下载地址。

```sh
yovoice models import /path/to/kokoro-82m-1.1-zh-multilingual-q8_0.gguf
yovoice generate --model kokoro-1.1-zh-q8 --speaker zf_001 --text '你好，欢迎使用语音合成。' --output hello.wav
```

语言随音色选择，CLI 使用 `--speaker`；`models list` 返回每个模型的完整音色列表。默认中文女声，分段长度默认 64 个字符，可通过 `--option 'text_chunk_size=120'` 调整。单段仍受引擎 510 个音素上限约束。Kokoro 不支持克隆、情绪描述或 IndexTTS 采样参数。

## 资源与限制

安装包的 `tools/kokoro` 包含 eSpeak-ng 和 MeCab 原生动态库。模型包内含发音资源，推理不依赖 Python、系统 PATH 或联网。v1.0 约 0.93 GB，主要体积来自 UniDic 日文词典；v1.1-zh 约 0.26 GB。首次启动会读取并展开资源，界面显示启动引擎，最多等待五分钟。

v1.1-zh 的中文音素表不同于 v1.0。转换脚本使用 Misaki 的 v1.1 中文前端生成字词读音，保留词内变调及儿化；推理仍使用 audio.cpp 的原生分词和数字处理。它与 Python KPipeline 的跨词变调及中英混排处理并非完全等价。模型标记为 experimental，音频生成成功不代表完成主观音质验收。

当前原生验证覆盖 macOS ARM64 CPU，以及 v1.1-zh 的 Metal 英文推理。Windows / Linux 打包路径不等于这些平台的实机推理已经验证；其他 GPU 后端也须单独验证。

## 制作模型

使用隔离的 Python 3.11 环境。转换器为 audio.cpp v0.7.4，源码压缩包 SHA-256 为 `9e397a1f6a5c1813d379c61c3b4ec549e2f88586c9025588e9ebe81b527fa4ce`。源码和权重仅在模型制作阶段需要。

```sh
uv venv .venv-kokoro --python 3.11
uv pip install --python .venv-kokoro/bin/python torch==2.14.0 numpy==2.4.6 gguf==0.19.0 'misaki[zh,ja]==0.9.4' jieba==0.42.1 pypinyin==0.55.0 pypinyin-dict==0.9.0 espeakng-loader==0.2.4 unidic==1.1.0
.venv-kokoro/bin/python -m unidic download 3.1.0+2021-08-31
.venv-kokoro/bin/python scripts/prepare-kokoro-models.py --source /path/to/Kokoro-82M --audio-cpp /path/to/audio.cpp-0.7.4 --output /path/to/output --version 1.0
.venv-kokoro/bin/python scripts/prepare-kokoro-models.py --source /path/to/Kokoro-82M-v1.1-zh --audio-cpp /path/to/audio.cpp-0.7.4 --output /path/to/output --version 1.1-zh
```

使用官方快照：v1.0 为 `f3ff3571791e39611d31c381e3a41a3af07b4987`，v1.1-zh 为 `01e7505bd6a7a2ac4975463114c3a7650a9f7218`。

输入目录应包含官方 `config.json`、权重和完整 `voices/*.pt`。脚本校验官方权重摘要、音色数量和新版中文变调映射，输出实际模型摘要。依赖版本、字典、资源或转换脚本变化都可能改变最终摘要，必须重新验证并同步两份 catalog.json；不得跳过导入校验。

应用打包调用 `scripts/package-kokoro-runtime.py`，从固定摘要的 wheel 中仅提取原生动态库和许可。正式 macOS 包将动态库和引擎签为同一团队；临时签名的开发引擎不启用要求同团队动态库的加固运行时，正式包仍启用。
