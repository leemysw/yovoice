param([string]$Configuration = "Release", [switch]$Package)
$ErrorActionPreference = "Stop"
Set-Location (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent)
$destination = [IO.Path]::GetFullPath((Join-Path (Get-Location) 'artifacts/windows-x64'))
function Assert-BuildDirectoryAvailable {
    # 只检查当前仓库的构建产物，避免影响其他已安装的应用。
    foreach ($directory in @((Split-Path $destination -Parent), $destination)) {
        if ((Test-Path -LiteralPath $directory) -and ((Get-Item -LiteralPath $directory).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw "构建目录不能是链接：$directory"
        }
    }
    $running = @(Get-Process | Where-Object {
        $_.Path -and $_.Path.StartsWith($destination + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
    })
    if ($running.Count -gt 0) {
        $names = ($running | ForEach-Object { "$($_.ProcessName) (PID $($_.Id))" }) -join ', '
        throw "当前构建仍在运行：$names。请从 yovoice 的 [文件 → 退出 yovoice] 或托盘菜单退出后重试；关闭窗口只会隐藏到托盘。"
    }
}
Assert-BuildDirectoryAvailable
# 优先使用系统 SDK；版本不足时使用仓库内已安装的 SDK。
$systemDotnet = Get-Command dotnet -CommandType Application -ErrorAction SilentlyContinue
$localDotnet = Join-Path (Get-Location) 'artifacts/tooling/dotnet/dotnet.exe'
$dotnet = $null
$candidates = @()
if ($systemDotnet) { $candidates += $systemDotnet.Source }
if (Test-Path -LiteralPath $localDotnet) { $candidates += $localDotnet }
foreach ($candidate in $candidates) {
    $sdkVersion = & $candidate --version
    if ($LASTEXITCODE -eq 0 -and "$sdkVersion" -match '^(\d+)\.' -and [int]$Matches[1] -ge 8) {
        $dotnet = $candidate
        break
    }
}
if (!$dotnet) { throw '构建 Windows 应用需要 .NET 8 SDK。请安装后重新打开终端，或安装到 artifacts/tooling/dotnet。' }
Write-Host "使用 .NET SDK $sdkVersion ($dotnet)"
# 为音频转换器单独选择工具链，不改动其他构建命令使用的 PATH。
$audioPath = $env:PATH
$audioPython = $null
$msysRoots = @($env:YOVOICE_MSYS2, (Join-Path (Get-Location) 'artifacts/tooling/msys64'), 'C:/msys64')
foreach ($msysRoot in $msysRoots) {
    if (!$msysRoot) { continue }
    $msysPython = Join-Path $msysRoot 'mingw64/bin/python.exe'
    if ((Test-Path -LiteralPath $msysPython) -and (Test-Path -LiteralPath (Join-Path $msysRoot 'usr/bin/bash.exe'))) {
        $audioPython = $msysPython
        $audioPath = "$(Join-Path $msysRoot 'mingw64/bin');$(Join-Path $msysRoot 'usr/bin');$audioPath"
        break
    }
}
if (!$audioPython) {
    $pythonCommand = Get-Command python -CommandType Application -ErrorAction SilentlyContinue | Where-Object { $_.Source -notlike '*\Microsoft\WindowsApps\*' }
    if ($pythonCommand) { $audioPython = $pythonCommand.Source }
}
if (!$audioPython) { throw '缺少 Python 和音频编译工具链。请按 docs/development.md 配置 MSYS2，或通过 YOVOICE_MSYS2 指定安装目录。' }
& $audioPython -c 'import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)'
if ($LASTEXITCODE -ne 0) { throw '音频转换器构建需要 Python 3.12 或更新版本。' }
# 所有外部命令显式检查退出码，避免生成不完整的发布包。
pnpm --dir web run build
if ($LASTEXITCODE -ne 0) { throw "界面构建失败" }
$version = if ($env:YOVOICE_VERSION) { $env:YOVOICE_VERSION } else { (Get-Content web/package.json | ConvertFrom-Json).version }
if ($version -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$') { throw "版本号无效" }
Assert-BuildDirectoryAvailable
if (Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination -Recurse -Force }
& $dotnet publish desktop/windows/VoiceWorkbench -c $Configuration -r win-x64 --self-contained true -p:PublishSingleFile=false "-p:Version=$version" -o $destination
if ($LASTEXITCODE -ne 0) { throw "桌面构建失败" }
New-Item -ItemType Directory -Force -Path "$destination/service" | Out-Null
$env:CGO_ENABLED = "0"
go build -trimpath -ldflags="-s -w" -o "$destination/service/yovoice-service.exe" ./cmd/yovoice-service
if ($LASTEXITCODE -ne 0) { throw "Go 服务构建失败" }
# 内置 CPU 便携运行包；GPU 内核由用户在应用内按需下载。
$archiveName = "audio-v0.7.4-bin-windows-x64-cpu-portable.zip"
$archive = Join-Path (Get-Location) "artifacts/downloads/$archiveName"
New-Item -ItemType Directory -Force -Path (Split-Path $archive -Parent) | Out-Null
if (!(Test-Path $archive)) {
    Invoke-WebRequest "https://github.com/0xShug0/audio.cpp/releases/download/v0.7.4/$archiveName" -OutFile "$archive.part"
    Move-Item "$archive.part" $archive -Force
}
# 直接使用 .NET 流式校验，避免依赖 PowerShell 模块中的 Get-FileHash。
$sha256 = [System.Security.Cryptography.SHA256]::Create()
try {
    $stream = [System.IO.File]::OpenRead($archive)
    try {
        $archiveHash = [BitConverter]::ToString($sha256.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()
    } finally { $stream.Dispose() }
} finally { $sha256.Dispose() }
if ($archiveHash -ne "d241c56ba78fd3c1b28bf289792fb8ec258d36586b4e0c8d667080ec248c0d2f") {
    throw "CPU 内核校验失败，请删除 $archive 后重试"
}
$runtime = Join-Path $destination "engine"
Expand-Archive -LiteralPath $archive -DestinationPath $runtime
if (!(Test-Path "$runtime/audiocpp_server.exe") -or !(Test-Path "$runtime/model_specs") -or !(Test-Path "$runtime/LICENSE")) {
    throw "CPU 运行包缺少服务、模型描述或许可证"
}
# 保留服务、DLL、模型描述和许可证，不分发转换工具与其他命令行程序。
Get-ChildItem $runtime | Where-Object { $_.Name -notin @('audiocpp_server.exe', 'model_specs', 'LICENSE') -and $_.Extension -ne '.dll' } | Remove-Item -Recurse -Force
$originalPath = $env:PATH
try {
    $env:PATH = $audioPath
    & $audioPython scripts/build-ffmpeg.py "$destination/tools"
    if ($LASTEXITCODE -ne 0) { throw "音频转换器构建失败" }
} finally { $env:PATH = $originalPath }
Copy-Item LICENSE,README.md,THIRD_PARTY_NOTICES.md $destination
# Windows 仅分发 Setup，清除旧构建遗留的便携包。
Remove-Item "artifacts/yovoice-windows-x64.zip" -ErrorAction SilentlyContinue

if ($Package) { & "$PSScriptRoot/package-windows.ps1" -Version $version }
