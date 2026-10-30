# AGENTS.md

Project-specific guidance for AI coding agents.

<!-- ASTRYX:START -->
Astryx v0.6.1 · 164 components
CLI: run every command as `pnpm --dir web exec astryx <cmd>` (shown below as `astryx ...`).

SETUP (once, in your app entry e.g. main.tsx) — without these, components render unstyled:
  import "@astryxdesign/core/reset.css";
  import "@astryxdesign/core/astryx.css";

WORKFLOW — discover, don't guess. Before writing UI:
1. `astryx build "<idea>"` — START HERE: returns a kit (closest [page] + [block]s + [component]s). No args = full playbook.
2. `astryx template <name> [--skeleton]` — scaffold the [page]/[block]s it named, or study their layout. Templates are reference code.
3. `astryx component <Name>` — props + examples for every component you use.

RULES:
- No <div> — components do all layout/spacing, page frame included.
- Frame first: read `astryx docs layout` before writing any page or screen — page frame, region widths, breakpoint behavior.
- Dense data = rows (Table, List/Item), never Card-wrapped list items; Card is for standalone widgets. Status = StatusDot/Token; Badge = counts only.
- Custom styling: component props first; else style/className with tokens — var(--color-*|--spacing-*|--radius-*). No raw hex/px. (No StyleX/Tailwind compiler here — don't use xstyle/utility classes.)
- Tokens for every value (`astryx docs tokens`). Brand/accent belongs in the theme (`astryx theme list` / `theme add <slug>`, or `astryx theme template` for a custom one) — never override --color-* in :root.
- SELF-CHECK before you finish: re-read the file and replace any raw <div>/<span> layout, imported .css/@apply, or hardcoded value (#hex, 16px) with the component or a token (var(--color-*|--spacing-*|…)). If unsure a component/prop exists, run `astryx component <Name>` / `astryx search "<thing>"`; don't hand-roll CSS.

MORE CLI:
  search "<query>"   find any component / hook / doc / template / block
  component --list   164 components by category
  template --list    page + block recipes
  docs <topic>       browser-support, cli-integrations, color, elevation, getting-started, icons, illustrations, internationalization, layout, migration, motion, principles, shape, spacing, styling-libraries, styling, theme, tokens, typography, working-with-ai
  swizzle <Name>     eject component source for deep customization
  upgrade --apply    run after any Astryx or integration dependency bump
<!-- ASTRYX:END -->

## 项目约定

- 前端工程位于 `web/`，依赖方向为 `app → features → shared`；浏览器测试位于 `web/browser-tests/`。
- 前端文件名统一使用小写 kebab-case，例如 `voice-editor.tsx`、`call-error.ts`；组件和类型名仍使用 PascalCase。
- 原生宿主按 `desktop/windows/`、`desktop/macos/`、`desktop/linux/` 分平台（Linux 宿主是独立 Go 模块，经 purego 加载 GTK 3 与 WebKitGTK，不用 cgo）；本地服务入口归 `cmd/`，Go 实现归 `internal/` 下按职责划分的子包（传输 `desktop`/`remote` → 应用 `workbench` → 基础 `engine`/`assistant`/`llm`/`store`/`download`/`score`/`audio` → 模型 `schema`/`catalog` → 叶子 `msg`/`diag`/`platform`，只允许向下依赖），构建与原生验证脚本归 `scripts/desktop/`。
- 始终用中文回复，代码注释使用中文。
- Go 按对象职责划分，Windows C# 只处理原生窗口与文件对话框；避免仅有一个实现的接口和预留架构。
- 修改推理映射或下载逻辑后运行 `go test -race ./...`。
- 界面修改运行 `pnpm --dir web run lint`、`pnpm --dir web run build` 和 `pnpm --dir web test`。
- 样式按功能放在 `web/src/features/<功能>/<功能>.css`，外壳与全局放 `web/src/app/`，统一由 `app/styles.css` 按顺序 `@import`，组件里不单独引入；规则写在 `@layer app { }` 内，类名以所属功能开头。
- 浏览器测试较耗时，日常调试优先定向执行相关用例（如 `pnpm --dir web exec playwright test browser-tests/<file>.spec.ts`），提交前再运行 `pnpm --dir web test`。
- 功能稳定的用例在 `web/playwright.config.ts` 的 `sealed` 列表中封存，`pnpm --dir web test` 和日常 CI 不跑；改到这些功能或发布前运行 `pnpm --dir web run test:all`（CI 每周一全量跑一次）。功能重新频繁改动时移出列表。
- 不将浏览器预览和交叉编译视为 Windows 实机推理已验证。
- 公共实现只保留一处，不再各写一份：Go 写文件用 `platform.WriteFileAtomic`；界面偏好读写用 `shared/lib/local-store`；音频解码与峰值用 `shared/lib/sound`，波形用 `features/media/waveform`；`mediaUrl` 的结果用 `releaseMediaUrl` 释放；任务计时用 `useElapsed`。
- 不使用“闪光星星”（Sparkles、Sparkle、WandSparkles 等）图标，按功能选具体的图标；eslint 已禁止从 lucide-react 引入这些图标。
- 状态库格式变化（建表、改字段、旧数据补齐）只在 `internal/store/migrate.go` 末尾追加升级步骤，已发布的步骤不改；读取代码和界面只认当前格式，不再各自兼容旧数据。外部输入（保存、作品包导入）统一经 `Draft.Normalize` 补齐。

## 版本记录

- 用户可见的功能、改进和修复同步记录到 `CHANGELOG.md` 的 `Unreleased`，合并相近条目，不记录纯实现细节。
- 发布前将待发布内容压缩为简短说明，移入 `## [X.Y.Z] - YYYY-MM-DD`，保留 `Unreleased` 供后续更新；版本号、变更日志与代码一起提交。
- 从 v0.1.7 起，每次发布说明必须分别包含 `### English` 和 `### 简体中文`，两部分内容对应、面向用户；CI 校验缺少任一语言时阻止发布。
- 推送版本标签前运行 `python3 scripts/release-notes.py vX.Y.Z` 检查正文。CI 从标签对应的变更日志提取版本说明，自动写入 GitHub Release 页面。
