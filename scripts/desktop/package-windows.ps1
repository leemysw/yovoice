param([Parameter(Mandatory = $true)][string]$Version, [ValidateSet('cpu', 'update', 'cuda12.4', 'cuda13.3')][string]$Kind = 'cpu')
$ErrorActionPreference = "Stop"
Set-Location (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent)
if ($Version -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$') { throw "版本号无效" }
$compiler = Get-Command ISCC.exe -ErrorAction SilentlyContinue
$compilerPath = if ($compiler) { $compiler.Source } else { "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe" }
if (!(Test-Path $compilerPath)) { throw "请先安装 Inno Setup 6（winget install JRSoftware.InnoSetup）。" }
$application = Join-Path (Get-Location) "artifacts/windows-x64"
foreach ($file in @('yovoice.exe', 'service/yovoice-service.exe', 'engine/audiocpp_server.exe', 'engine/yovoice-engine.json', 'web/index.html')) {
    if (!(Test-Path "$application/$file")) { throw "安装包缺少 $file，请先构建 Windows 应用。" }
}
# cpu：应用 + CPU 内核；update：只含应用本体，供自动更新覆盖安装；cudaX：应用 + 对应 CUDA 内核，不含单独的 CPU 内核。
$name = switch ($Kind) {
    'cpu' { 'yovoice-windows-x64-setup' }
    'update' { 'yovoice-windows-x64-update' }
    default { "yovoice-windows-x64-$Kind-setup" }
}
$source = $application
$staging = $null
if ($Kind -ne 'cpu') {
    $staging = Join-Path (Get-Location) "artifacts/windows-x64-$Kind"
    if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
    New-Item -ItemType Directory -Path $staging | Out-Null
    Get-ChildItem -LiteralPath $application -Force | Where-Object { $_.Name -ne 'engine' } | Copy-Item -Destination $staging -Recurse
    $source = $staging
}
if ($Kind -like 'cuda*') {
    # 版本与校验值取自服务端运行时清单；CUDA 构建自带 CPU 后端，同一内核也用于 CPU。
    $engine = Get-Content internal/catalog/engine.json -Raw | ConvertFrom-Json
    $runtime = Join-Path $staging 'engine'
    New-Item -ItemType Directory -Force -Path $runtime | Out-Null
    foreach ($prefix in @('bin', 'cudart')) {
        $archiveName = "audio-$($engine.version)-$prefix-windows-x64-$Kind.zip"
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
        Expand-Archive -LiteralPath $archive -DestinationPath $runtime -Force
    }
    if (!(Test-Path "$runtime/audiocpp_server.exe") -or !(Test-Path "$runtime/model_specs") -or !(Test-Path "$runtime/LICENSE") -or !(Get-ChildItem $runtime -Filter 'cudart64_*.dll')) {
        throw "CUDA 运行包缺少服务、模型描述、许可证或 CUDA 运行库"
    }
    # 与 CPU 内核一致，只保留服务、DLL、模型描述和许可证。
    Get-ChildItem $runtime | Where-Object { $_.Name -notin @('audiocpp_server.exe', 'model_specs', 'LICENSE') -and $_.Extension -ne '.dll' } | Remove-Item -Recurse -Force
    # 服务据此登记内置内核的后端与版本；cuda13.3 对应设置中的 cuda13 后端。
    $backend = if ($Kind -eq 'cuda12.4') { 'cuda' } else { 'cuda13' }
    [IO.File]::WriteAllText("$runtime/yovoice-engine.json", (@{ version = $engine.version; backend = $backend } | ConvertTo-Json -Compress))
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
$arguments = @("/DAppVersion=$Version", "/DAppDir=$source", "/DOutputDir=$output", "/DOutputName=$name", "/DBootstrapper=$bootstrapper")
if ($Kind -eq 'update') { $arguments += '/DAppOnly' }
try {
    & $compilerPath @arguments "desktop/windows/installer/yovoice.iss"
    if ($LASTEXITCODE -ne 0) { throw "Setup 编译失败" }
} finally {
    if ($staging -and (Test-Path -LiteralPath $staging)) { Remove-Item -LiteralPath $staging -Recurse -Force }
}
if (!(Test-Path "$output/$name.exe")) { throw "未生成 Setup 安装包" }
Write-Host "已生成：artifacts/$name.exe"
