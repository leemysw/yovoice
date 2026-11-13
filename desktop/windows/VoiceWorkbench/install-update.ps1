param([Parameter(Mandatory = $true)][string]$Config)
$ErrorActionPreference = 'Stop'
$settings = Get-Content -LiteralPath $Config -Raw | ConvertFrom-Json
$target = [IO.Path]::GetFullPath($settings.TargetDirectory).TrimEnd('\')
$package = [IO.Path]::GetFullPath($settings.PackagePath)
# 旧版本备份放在本次更新自己的目录（数据目录下的 updates），不在安装目录旁边留下临时目录。
$work = Split-Path ([IO.Path]::GetFullPath($Config)) -Parent
$backup = Join-Path $work 'previous'
$installationStarted = $false
$committed = $false
$packageRejected = $false
# 差分安装器放在重建目录 delta-stage 里，补丁和 use-full 标记在上一级的版本目录。
$delta = [IO.Path]::GetFileName($package) -eq 'delta-install.exe' -and (Split-Path (Split-Path $package -Parent) -Leaf) -eq 'delta-stage'
$versionDirectory = if ($delta) { Split-Path (Split-Path $package -Parent) -Parent } else { Split-Path $package -Parent }

function Confirm-Package {
    if ((Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash -ne $settings.ExpectedHash) {
        $script:packageRejected = $true
        throw '更新包校验失败。'
    }
    # 已安装的应用带有效签名时，更新包必须由同一发行者签名；未签名的开发构建不受影响。
    $installed = Get-AuthenticodeSignature -LiteralPath (Join-Path $target 'yovoice.exe')
    if ($installed.Status -eq 'Valid') {
        $signature = Get-AuthenticodeSignature -LiteralPath $package
        if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -ne $installed.SignerCertificate.Subject) {
            $script:packageRejected = $true
            throw '更新包签名与当前应用不一致。'
        }
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
    Add-Content -LiteralPath $settings.LogPath -Value "$(Get-Date -Format o) 更新完成。"
    # 已装上的版本不再需要更新包、补丁和备份，整个版本缓存目录一起删除；删不掉的由新版本启动时再清理。
    if (!$target.StartsWith($versionDirectory.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $versionDirectory -Recurse -Force -ErrorAction SilentlyContinue
    }
}
catch {
    # 差分安装器校验不过或安装失败时，下次改用常规更新包；应用未退出等与补丁无关的中断不改。
    if ($delta -and !$committed -and ($packageRejected -or $installationStarted)) {
        Set-Content -LiteralPath (Join-Path $versionDirectory 'use-full') -Value '1'
    }
    Add-Content -LiteralPath $settings.LogPath -Value "$(Get-Date -Format o) $($_.Exception.Message)"
    if (!$committed -and $installationStarted -and (Test-Path -LiteralPath $backup)) {
        try {
            Get-ChildItem -LiteralPath $target -Force | Where-Object { $_.Name -ne 'engine' } | Remove-Item -Recurse -Force
            # 数据目录可能和安装目录不在同一个盘，复制回去而不是移动。
            Get-ChildItem -LiteralPath $backup -Force | Copy-Item -Destination $target -Recurse -Force
            Remove-Item -LiteralPath $backup -Recurse -Force
            Start-Process -FilePath (Join-Path $target 'yovoice.exe') -WorkingDirectory $target | Out-Null
        }
        catch { Add-Content -LiteralPath $settings.LogPath -Value "恢复失败，旧版本保留在 $backup。$($_.Exception.Message)" }
    }
    exit 1
}
finally {
    # 未装上时保留更新包与 use-full 标记供下次使用，只删本次的工作目录；恢复失败时保留备份。
    if (!$committed -and (Test-Path -LiteralPath $work) -and !(Test-Path -LiteralPath $backup)) {
        Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    }
}
