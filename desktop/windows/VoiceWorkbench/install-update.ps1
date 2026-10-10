param([Parameter(Mandatory = $true)][string]$Config)
$ErrorActionPreference = 'Stop'
$settings = Get-Content -LiteralPath $Config -Raw | ConvertFrom-Json
$target = [IO.Path]::GetFullPath($settings.TargetDirectory).TrimEnd('\')
$package = [IO.Path]::GetFullPath($settings.PackagePath)
$staging = Join-Path (Split-Path $target -Parent) ('.yovoice-update.' + [Guid]::NewGuid().ToString('N'))
$backup = Join-Path $staging 'previous'
$installationStarted = $false
$committed = $false

function Confirm-Package {
    if ((Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash -ne $settings.ExpectedHash) {
        throw '更新包校验失败。'
    }
}
try {
    if ($settings.ExpectedHash -notmatch '^[0-9a-fA-F]{64}$' -or $settings.Version -notmatch '^\d+\.\d+\.\d+$' -or
        !(Test-Path -LiteralPath (Join-Path $target 'yovoice.exe')) -or [IO.Path]::GetExtension($package) -ne '.exe') {
        throw '更新参数或应用目录无效。'
    }
    Confirm-Package
    # 先通知宿主助手已就绪，再等待正常退出；超时不强制结束进程。
    Set-Content -LiteralPath $settings.ReadyPath -Value 'ready'
    for ($attempt = 0; $attempt -lt 600; $attempt++) {
        if (!(Get-Process -Id $settings.ParentId -ErrorAction SilentlyContinue)) { break }
        Start-Sleep -Milliseconds 100
    }
    if (Get-Process -Id $settings.ParentId -ErrorAction SilentlyContinue) { throw '应用尚未退出，取消更新。' }
    if (!(Test-Path -LiteralPath $settings.CommitPath)) { throw '退出未完成，取消更新。' }
    Confirm-Package
    New-Item -ItemType Directory -Path $backup | Out-Null
    # 在运行安装器前备份旧目录；失败时恢复安装文件和卸载器。更新包不含内核，
    # engine 目录（CUDA 内核约 2 GB）原地保留，不参与备份与恢复。
    Get-ChildItem -LiteralPath $target -Force | Where-Object { $_.Name -ne 'engine' } | Copy-Item -Destination $backup -Recurse
    $installationStarted = $true
    $setup = Start-Process -FilePath $package -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', '/NOCLOSEAPPLICATIONS', "/DIR=`"$target`"") -Wait -PassThru
    if ($setup.ExitCode -ne 0) { throw "安装失败：$($setup.ExitCode)" }
    foreach ($file in @('yovoice.exe', 'service/yovoice-service.exe', 'engine/audiocpp_server.exe', 'web/index.html', 'unins000.exe')) {
        if (!(Test-Path -LiteralPath (Join-Path $target $file))) { throw "更新后缺少 $file" }
    }
    $executable = Join-Path $target 'yovoice.exe'
    $version = [Diagnostics.FileVersionInfo]::GetVersionInfo($executable)
    if ("$($version.FileMajorPart).$($version.FileMinorPart).$($version.FileBuildPart)" -ne $settings.Version) { throw '安装后的应用版本不匹配。' }
    Start-Process -FilePath $executable -WorkingDirectory $target | Out-Null
    $committed = $true
    Remove-Item -LiteralPath $backup -Recurse -Force
    Remove-Item -LiteralPath $package -Force
    Add-Content -LiteralPath $settings.LogPath -Value "$(Get-Date -Format o) 更新完成。"
}
catch {
    Add-Content -LiteralPath $settings.LogPath -Value "$(Get-Date -Format o) $($_.Exception.Message)"
    if (!$committed -and $installationStarted -and (Test-Path -LiteralPath $backup)) {
        try {
            Get-ChildItem -LiteralPath $target -Force | Where-Object { $_.Name -ne 'engine' } | Remove-Item -Recurse -Force
            Get-ChildItem -LiteralPath $backup -Force | Move-Item -Destination $target
            Remove-Item -LiteralPath $backup -Recurse -Force
            Start-Process -FilePath (Join-Path $target 'yovoice.exe') -WorkingDirectory $target | Out-Null
        }
        catch { Add-Content -LiteralPath $settings.LogPath -Value "恢复失败，旧版本保留在 $backup。$($_.Exception.Message)" }
    }
    exit 1
}
finally {
    # 恢复失败时保留备份，不能随临时文件清理。
    if ((Test-Path -LiteralPath $staging) -and !(Test-Path -LiteralPath $backup)) {
        Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
    }
}
