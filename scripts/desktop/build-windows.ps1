param([string]$Configuration = "Release")
$ErrorActionPreference = "Stop"
Set-Location (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent)
# 所有外部命令显式检查退出码，避免生成不完整的发布包。
pnpm --dir web install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw "依赖安装失败" }
pnpm --dir web run build
if ($LASTEXITCODE -ne 0) { throw "界面构建失败" }
go test ./...
if ($LASTEXITCODE -ne 0) { throw "核心检查失败" }
$version = if ($env:YOVOICE_VERSION) { $env:YOVOICE_VERSION } else { (Get-Content web/package.json | ConvertFrom-Json).version }
if ($version -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$') { throw "版本号无效" }
$destination = Join-Path (Get-Location) "artifacts/windows-x64"
if (Test-Path $destination) { Remove-Item $destination -Recurse -Force }
dotnet publish desktop/windows/VoiceWorkbench -c $Configuration -r win-x64 --self-contained true -p:PublishSingleFile=false "-p:Version=$version" -o $destination
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
if ((Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne "d241c56ba78fd3c1b28bf289792fb8ec258d36586b4e0c8d667080ec248c0d2f") {
    throw "CPU 内核校验失败，请删除 $archive 后重试"
}
$runtime = Join-Path $destination "engine"
Expand-Archive -LiteralPath $archive -DestinationPath $runtime
if (!(Test-Path "$runtime/audiocpp_server.exe") -or !(Test-Path "$runtime/model_specs") -or !(Test-Path "$runtime/LICENSE")) {
    throw "CPU 运行包缺少服务、模型描述或许可证"
}
# 保留服务、DLL、模型描述和许可证，不分发转换工具与其他命令行程序。
Get-ChildItem $runtime | Where-Object { $_.Name -notin @('audiocpp_server.exe', 'model_specs', 'LICENSE') -and $_.Extension -ne '.dll' } | Remove-Item -Recurse -Force
Copy-Item LICENSE,README.md,THIRD_PARTY_NOTICES.md $destination
# Windows 仅分发 Setup，清除旧构建遗留的便携包。
Remove-Item "artifacts/yovoice-windows-x64.zip" -ErrorAction SilentlyContinue

& "$PSScriptRoot/package-windows.ps1" -Version $version
