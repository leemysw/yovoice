param([string]$Application = 'artifacts/windows-x64/yovoice.exe')
$ErrorActionPreference = 'Stop'
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$binary = (Resolve-Path $Application).Path
$helper = Join-Path $repo 'desktop/windows/VoiceWorkbench/install-update.ps1'
$temporary = Join-Path ([IO.Path]::GetTempPath()) ('yovoice update ' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $temporary | Out-Null
try {
    # 命令替身只存在于测试子进程，生产助手不含测试开关。
    $driver = Join-Path $temporary 'driver.ps1'
    @'
param($Helper, $Config, $Mode)
function Get-Process { param($Id) if ($Mode -eq 'running') { [pscustomobject]@{ Id = $Id } } }
function Start-Sleep { param($Milliseconds) }
function Start-Process {
    param($FilePath, $ArgumentList, $WorkingDirectory, [switch]$Wait, [switch]$PassThru)
    $settings = Get-Content -LiteralPath $Config -Raw | ConvertFrom-Json
    $marker = Join-Path $settings.TargetDirectory 'marker'
    if ($FilePath -eq $settings.PackagePath) {
        Set-Content -LiteralPath $marker -Value 'new'
        if ($Mode -eq 'setup-failed') { return [pscustomobject]@{ ExitCode = 42 } }
        return [pscustomobject]@{ ExitCode = 0 }
    }
    if ($Mode -eq 'launch-failed' -and (Get-Content -LiteralPath $marker).Trim() -eq 'new') { throw '模拟启动失败' }
}
& $Helper -Config $Config
exit $LASTEXITCODE
'@ | Set-Content -LiteralPath $driver -Encoding UTF8
    $version = [Diagnostics.FileVersionInfo]::GetVersionInfo($binary)
    foreach ($mode in @('success', 'setup-failed', 'launch-failed', 'uncommitted', 'running', 'bad-hash')) {
        $directory = Join-Path $temporary $mode
        $target = Join-Path $directory 'installed'
        New-Item -ItemType Directory $target | Out-Null
        Copy-Item -LiteralPath $binary -Destination (Join-Path $target 'yovoice.exe')
        foreach ($file in @('service/yovoice-service.exe', 'engine/audiocpp_server.exe', 'web/index.html', 'unins000.exe', 'marker')) {
            $path = Join-Path $target $file
            New-Item -ItemType Directory -Path (Split-Path $path -Parent) -Force | Out-Null
            Set-Content -LiteralPath $path -Value 'old'
        }
        $package = Join-Path $directory 'setup.exe'
        Set-Content -LiteralPath $package -Value 'test installer'
        $config = Join-Path $directory 'update.json'
        $commit = Join-Path $directory 'commit'
        if ($mode -ne 'uncommitted') { Set-Content -LiteralPath $commit -Value 'install' }
        $hash = (Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash
        if ($mode -eq 'bad-hash') { $hash = '0' * 64 }
        @{
            ParentId = 2147483647; PackagePath = $package; TargetDirectory = $target
            ExpectedHash = $hash; Version = "$($version.FileMajorPart).$($version.FileMinorPart).$($version.FileBuildPart)"
            ReadyPath = (Join-Path $directory 'ready'); CommitPath = $commit; LogPath = (Join-Path $directory 'install.log')
        } | ConvertTo-Json | Set-Content -LiteralPath $config -Encoding UTF8
        & (Get-Process -Id $PID).Path -NoProfile -File $driver $helper $config $mode
        $result = $LASTEXITCODE
        $expected = if ($mode -eq 'success') { 'new' } else { 'old' }
        if ((Get-Content -LiteralPath (Join-Path $target 'marker')).Trim() -ne $expected) { throw "$mode 未保留预期版本" }
        if (($result -eq 0) -ne ($mode -eq 'success')) { throw "$mode 退出码错误：$result" }
        if ((Get-Content -LiteralPath (Join-Path $target 'unins000.exe')).Trim() -ne 'old') { throw '卸载器未保留' }
        if (Get-ChildItem -LiteralPath $directory -Filter '.yovoice-update.*') { throw "$mode 残留替换目录" }
    }
    Write-Host 'Windows 更新成功、安装失败、重启失败、未确认退出、退出取消及校验失败检查通过。'
}
finally { Remove-Item -LiteralPath $temporary -Recurse -Force }
# 模拟失败的子进程退出码已逐项验证，不应成为测试脚本的最终退出码。
exit 0
