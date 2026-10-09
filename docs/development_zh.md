# 开发指南

[English](development.md) · 简体中文

本指南用于从源码构建 yovoice。直接安装请查看 [CLI 安装](cli_zh.md#安装)或 [Releases](https://github.com/leemysw/yovoice/releases)。

## 环境要求

- Node.js 22+、pnpm 9.15.2、Go 1.26+、Python 3.12+。
- 音频转换器构建需要 Make、Bash、curl 和 C 编译器。
- macOS：Apple Silicon、macOS 14+、Xcode Command Line Tools。
- Windows：Windows 10/11 x64、.NET SDK 8、WebView2 Runtime、MSYS2 MinGW64。制作安装包还需 Inno Setup 6，使用 Make 命令需 GNU Make。

Windows 在 MSYS2 MinGW64 终端中安装音频构建工具：

```sh
pacman -Syu
pacman -S --needed make curl diffutils mingw-w64-x86_64-gcc mingw-w64-x86_64-python
```

更新要求重新打开终端时按提示操作。构建默认查找 `artifacts/tooling/msys64` 或 `C:/msys64`；其他位置可通过 `YOVOICE_MSYS2` 指定。

## 运行 App

```sh
git clone https://github.com/leemysw/yovoice.git
cd yovoice
make install
make app-run
```

后续命令均在仓库根目录执行。`app-run` 只构建并启动，不执行测试或打包；macOS 下会在终端显示日志。关闭窗口不会退出 App，重新构建前请通过应用菜单退出。日志位于 `~/.yovoice/logs`。

仅开发浏览器界面时运行 `make dev`，访问 `http://127.0.0.1:5173`。本地语音生成需要桌面 App 或 CLI。

## 构建与打包

| 命令 | 产物 |
| --- | --- |
| `make app-build` | `artifacts/macos-arm64/` 或 `artifacts/windows-x64/` 中的 App |
| `make app-package` | `artifacts/` 中的 macOS DMG/ZIP 或 Windows Setup EXE |
| `make cli-build` | CLI 可执行文件和 `artifacts/tools/` |
| `python3 scripts/package-cli.py` | `artifacts/` 中的独立 CLI ZIP |

CLI 需保留同级的 `tools/` 目录。完整安装包应在目标平台构建。macOS DMG 打包需要已登录的桌面会话和 Finder 自动化权限。

Windows 未安装 GNU Make 时，可在 PowerShell 中运行：

```powershell
./scripts/desktop/build-windows.ps1
./scripts/desktop/build-windows.ps1 -Package
python scripts/package-cli.py
```

模型转换与 App 打包独立。准备兼容的 Kokoro 模型时，可在仓库中运行 `python scripts/prepare-kokoro-models.py --help` 查看用法。

## 测试

```sh
pnpm --dir web exec playwright install chromium
make check
```

`make check-core` 检查 Go 格式与静态分析，并运行带竞态检测的测试；`make check-web` 执行前端构建与浏览器测试。原生安装和 GPU 推理还需在目标平台验证。

## 项目结构

| 目录 | 用途 |
| --- | --- |
| `cmd/` | CLI 和本地服务入口 |
| `internal/` | Go 服务实现，按职责分包（见下） |
| `desktop/macos/`、`desktop/windows/` | 原生 App 宿主 |
| `web/src/` | 前端应用 |
| `web/browser-tests/` | 浏览器测试 |
| `scripts/` | 构建与打包工具 |

### 架构约定

- 前端依赖方向为 `app → features → shared`，`shared` 不引用业务模块。
- Go 服务按职责分包，依赖只能自上而下：

  | 层 | 包 | 职责 |
  | --- | --- | --- |
  | 传输 | `desktop`、`remote` | 桌面本机服务与 RPC 分发；远程 HTTP API、异步任务与 MCP |
  | 应用 | `workbench` | 作品、素材、角色、模型、运行时、生成与工程归档 |
  | 基础 | `engine`、`store`、`download`、`audio` | 推理进程、状态持久化、下载解包、音频解析与转码 |
  | 模型 | `schema`、`catalog` | 持久化结构与校验；模型目录与生成参数 |
  | 叶子 | `msg`、`diag`、`platform` | 消息码、诊断日志、平台差异 |

  传输层只解码请求并调用 `Workbench` 的公开方法，不访问其内部状态。`testkit` 仅供测试引用。
- 桌面调用并发执行。`Workbench` 用编辑锁串行化“读取 → 校验引用 → 写入”的短事务，转码、下载、推理与工程导入导出不持锁；后台操作同一时间只运行一个。
- 模型目录、生成参数和 OmniVoice 属性同时嵌入 Go 服务并供界面引用，`internal/catalog/*.json` 与 `web/src/shared/lib/*.json` 需保持一致。
- 消息码在 `internal/msg` 中声明，须加入 `msg.All` 并在两种界面语言中提供文案。
- 升级 audio.cpp 时，同步修改 `EngineVersion`、运行时包校验值与 `scripts/desktop/` 构建脚本。

后三项由 `go test` 校验。

公开指南使用英文 `*.md` 和中文 `*_zh.md`。修改用户可见行为时，同步更新两种语言及其链接。

从 v0.1.7 起，CHANGELOG.md 的发布说明需分别包含 `### English` 和 `### 简体中文` 两部分。发布流程在构建前检查两种语言是否齐全。
