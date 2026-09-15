# macOS 原生宿主

SwiftPM + AppKit + WKWebView，最低 macOS 14，仅支持 M 系列（Apple Silicon arm64）。共用 React 界面与 `internal/workbench`，业务核心通过独立 Go 本地服务运行，用户不需要安装 .NET 或 Python。

## 构建与运行

开发机需要 Node.js 22+、pnpm 9.15.2、Go 1.26+、Xcode Command Line Tools。首次执行 `pnpm --dir web install --frozen-lockfile`，然后：

```sh
scripts/desktop/build-macos.sh
open artifacts/macos-arm64/yovoice.app
scripts/desktop/smoke-macos.sh
python3 scripts/desktop/check-macos-service.py
```

脚本仅构建 arm64，并校验主程序及两个服务的架构。`GO_BIN` 可以指定 Go 工具链路径；`CONFIGURATION=release scripts/desktop/build-macos.sh` 构建不含原生测试入口的 Swift release 宿主。冒烟测试使用默认 debug 包和临时数据目录，不写入日常作品。

## 已接入

- 原生菜单、Cmd+C/V/A/Z、Cmd+Enter 生成、关闭前保存和任务取消。
- 原生 WAV/GGUF/文件夹选择、音频文件定位、日志目录。
- 本地 HTTP 服务随机端口、每次启动独立 HttpOnly 凭证、来源检查、状态推送和音频 Range 请求。
- 内置 audio.cpp v0.7.4 Metal 服务及许可证；模型仍需下载或导入。
- 设置提供 CPU / Metal 后端；按架构下载并校验运行包，安装在独立目录。
- 单实例窗口激活、服务数据目录锁、宿主异常退出后通过管道 EOF 清理服务和推理进程。

日常数据在 `~/.yovoice`，诊断日志在其中的 `logs`。内置内核随 `.app` 放置；重新安装的内核位于数据目录，不修改 App 包。

## 分发边界

独立更新目前仍固定 v0.7.4，尚不包含远程版本发现与跨版本回退界面。

原生冒烟测试覆盖 UI 启动、桥接、WAV 导入/解码、保存及退出；它不等价于 IndexTTS 模型实机生成测试。不支持 Intel Mac。

首次启动会在新目录不存在时迁移旧 VoiceWorkbench 数据，并调整内部模型及内核路径；外部模型目录不变，已有新目录不会被覆盖。
