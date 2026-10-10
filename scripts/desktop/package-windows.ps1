param([Parameter(Mandatory = $true)][string]$Version, [switch]$Cuda)
$ErrorActionPreference = "Stop"
Set-Location (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent)
if ($Version -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$') { throw "版本号无效" }
$compiler = Get-Command ISCC.exe -ErrorAction SilentlyContinue
$compilerPath = if ($compiler) { $compiler.Source } else { "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe" }
if (!(Test-Path $compilerPath)) { throw "请先安装 Inno Setup 6（winget install JRSoftware.InnoSetup）。" }
$application = Join-Path (Get-Location) "artifacts/windows-x64"
foreach ($file in @('yovoice.exe', 'service/yovoice-service.exe', 'engine/audiocpp_server.exe', 'web/index.html')) {
    if (!(Test-Path "$application/$file")) { throw "安装包缺少 $file，请先构建 Windows 应用。" }
}
$name = if ($Cuda) { 'yovoice-windows-x64-cuda-setup' } else { 'yovoice-windows-x64-setup' }
$cudaRuntime = Join-Path $application 'engine-cuda'
if (Test-Path -LiteralPath $cudaRuntime) { Remove-Item -LiteralPath $cudaRuntime -Recurse -Force }
if ($Cuda) {
    # CUDA 安装包额外内置 CUDA 内核及运行库；版本与校验值取自服务端运行时清单。
    $engine = Get-Content internal/catalog/engine.json -Raw | ConvertFrom-Json
    New-Item -ItemType Directory -Force -Path $cudaRuntime | Out-Null
    foreach ($suffix in @('bin-windows-x64-cuda12.4.zip', 'cudart-windows-x64-cuda12.4.zip')) {
        $archiveName = "audio-$($engine.version)-$suffix"
        $expectedHash = $engine.archives.$archiveName
        if (!$expectedHash) { throw "运行时清单缺少 $archiveName" }
        $archive = Join-Path (Get-Location) "artifacts/downloads/$archiveName"
        New-Item -ItemType Directory -Force -Path (Split-Path $archive -Parent) | Out-Null
        if (!(Test-Path $archive)) {
            Invoke-WebRequest "https://github.com/0xShug0/audio.cpp/releases/download/$($engine.version)/$archiveName" -OutFile "$archive.part"
            Move-Item "$archive.part" $archive -Force
        }
        $sha256 = [System.Security.Cryptography.SHA256]::Create()
        try {
            $stream = [System.IO.File]::OpenRead($archive)
            try { $archiveHash = [BitConverter]::ToString($sha256.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() } finally { $stream.Dispose() }
        } finally { $sha256.Dispose() }
        if ($archiveHash -ne $expectedHash) { throw "CUDA 内核校验失败，请删除 $archive 后重试" }
        Expand-Archive -LiteralPath $archive -DestinationPath $cudaRuntime -Force
    }
    if (!(Test-Path "$cudaRuntime/audiocpp_server.exe") -or !(Test-Path "$cudaRuntime/model_specs") -or !(Test-Path "$cudaRuntime/LICENSE") -or !(Test-Path "$cudaRuntime/cudart64_12.dll")) {
        throw "CUDA 运行包缺少服务、模型描述、许可证或 CUDA 运行库"
    }
    # 与 CPU 内核一致，只保留服务、DLL、模型描述和许可证。
    Get-ChildItem $cudaRuntime | Where-Object { $_.Name -notin @('audiocpp_server.exe', 'model_specs', 'LICENSE') -and $_.Extension -ne '.dll' } | Remove-Item -Recurse -Force
}
$bootstrapper = Join-Path (Get-Location) "artifacts/downloads/MicrosoftEdgeWebView2Setup.exe"
New-Item -ItemType Directory -Force -Path (Split-Path $bootstrapper) | Out-Null
Invoke-WebRequest "https://go.microsoft.com/fwlink/p/?LinkId=2124703" -OutFile $bootstrapper
# Evergreen 安装器会更新，用微软有效的 Authenticode 签名校验发行者。
$signature = Get-AuthenticodeSignature $bootstrapper
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation(?:,|$)') {
    throw "WebView2 安装器签名无效，停止打包。"
}
$output = Join-Path (Get-Location) 'artifacts'
try {
    & $compilerPath "/DAppVersion=$Version" "/DAppDir=$application" "/DOutputDir=$output" "/DOutputName=$name" "/DBootstrapper=$bootstrapper" "desktop/windows/installer/yovoice.iss"
    if ($LASTEXITCODE -ne 0) { throw "Setup 编译失败" }
} finally {
    # 构建目录恢复为普通安装包内容，避免本地运行或后续打包误带 CUDA 内核。
    if (Test-Path -LiteralPath $cudaRuntime) { Remove-Item -LiteralPath $cudaRuntime -Recurse -Force }
}
if (!(Test-Path "$output/$name.exe")) { throw "未生成 Setup 安装包" }
Write-Host "已生成：artifacts/$name.exe"
