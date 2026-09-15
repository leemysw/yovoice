PNPM ?= pnpm
GO ?= go
CONFIGURATION ?= debug

.PHONY: help install dev build check check-web check-core app-build app-run macos windows

help: ## 查看常用命令
	@awk 'BEGIN {FS = ":.*## "} /^[a-z-]+:.*## / && !seen[$$1]++ {printf "  %-14s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## 安装锁定版本的前端依赖
	$(PNPM) --dir web install --frozen-lockfile

dev: ## 启动浏览器开发预览
	$(PNPM) --dir web run dev

build: ## 构建前端
	$(PNPM) --dir web run build

check: check-web check-core ## 验证前端与核心

check-web: ## 构建前端并运行浏览器测试
	$(PNPM) --dir web run check

check-core: ## 运行核心检查
	$(GO) test -race ./...

ifeq ($(OS),Windows_NT)
app-build: windows ## 构建本机桌面应用
app-run: app-build ## 构建并打开桌面应用
	powershell -NoProfile -Command "Start-Process artifacts/windows-x64/yovoice.exe"
else
app-build: macos ## 构建本机桌面应用
app-run: app-build ## 构建并打开桌面应用
	open "artifacts/macos-arm64/yovoice.app"
endif

macos: ## 构建 macOS 应用、DMG 与 ZIP
	GO_BIN="$(GO)" CONFIGURATION="$(CONFIGURATION)" scripts/desktop/build-macos.sh

windows: ## 构建 Windows Setup 与便携包（在 Windows 运行）
	powershell -NoProfile -ExecutionPolicy Bypass -File scripts/desktop/build-windows.ps1
