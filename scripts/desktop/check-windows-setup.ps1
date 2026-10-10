$ErrorActionPreference = "Stop"
if (!$env:CI) { throw "安装/卸载验证仅在隔离的 CI runner 中运行。" }
Set-Location (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent)
$directory = Join-Path $env:RUNNER_TEMP "yovoice-setup-check"
$installer = (Resolve-Path 'artifacts/yovoice-windows-x64-setup.exe').Path
$process = Start-Process -FilePath $installer -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/DIR=`"$directory`"") -Wait -PassThru
if ($process.ExitCode -ne 0) { throw "Setup 安装失败：$($process.ExitCode)" }
foreach ($file in @('yovoice.exe', 'service/yovoice-service.exe', 'engine/audiocpp_server.exe', 'engine/yovoice-engine.json', 'web/index.html', 'unins000.exe')) {
    if (!(Test-Path "$directory/$file")) { throw "安装后缺少 $file" }
}
# 更新包只覆盖应用本体：内核原样保留，卸载时仍随应用移除。
$marker = "$directory/engine/marker.txt"
Set-Content -LiteralPath $marker -Value 'kept'
$update = (Resolve-Path 'artifacts/yovoice-windows-x64-update.exe').Path
$process = Start-Process -FilePath $update -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/DIR=`"$directory`"") -Wait -PassThru
if ($process.ExitCode -ne 0) { throw "更新包安装失败：$($process.ExitCode)" }
if ((Get-Content -LiteralPath $marker).Trim() -ne 'kept' -or !(Test-Path "$directory/engine/audiocpp_server.exe")) { throw "更新包不应改动内核" }
Remove-Item -LiteralPath $marker
$process = Start-Process -FilePath "$directory/unins000.exe" -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART') -Wait -PassThru
if ($process.ExitCode -ne 0) { throw "卸载失败：$($process.ExitCode)" }
# 卸载器的临时子进程可能稍晚完成文件移除。
for ($attempt = 0; $attempt -lt 20 -and (Test-Path "$directory/yovoice.exe"); $attempt++) { Start-Sleep -Milliseconds 250 }
if (Test-Path "$directory/yovoice.exe") { throw "卸载后仍残留主程序" }
# 没有已安装的应用时，更新包应拒绝安装，避免得到缺少内核的应用。
$fresh = Join-Path $env:RUNNER_TEMP "yovoice-update-only"
$process = Start-Process -FilePath $update -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/DIR=`"$fresh`"") -Wait -PassThru
if ($process.ExitCode -eq 0 -or (Test-Path "$fresh/yovoice.exe")) { throw "更新包不应用于全新安装" }
Write-Host 'Setup 安装、更新包保留内核、必要文件和卸载检查通过。'
