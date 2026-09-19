param([Parameter(Mandatory = $true)][string]$Version)
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
$bootstrapper = Join-Path (Get-Location) "artifacts/downloads/MicrosoftEdgeWebView2Setup.exe"
New-Item -ItemType Directory -Force -Path (Split-Path $bootstrapper) | Out-Null
Invoke-WebRequest "https://go.microsoft.com/fwlink/p/?LinkId=2124703" -OutFile $bootstrapper
# Evergreen 安装器会更新，用微软有效的 Authenticode 签名校验发行者。
$signature = Get-AuthenticodeSignature $bootstrapper
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation(?:,|$)') {
    throw "WebView2 安装器签名无效，停止打包。"
}
$output = Join-Path (Get-Location) 'artifacts'
& $compilerPath "/DAppVersion=$Version" "/DAppDir=$application" "/DOutputDir=$output" "/DBootstrapper=$bootstrapper" "desktop/windows/installer/yovoice.iss"
if ($LASTEXITCODE -ne 0) { throw "Setup 编译失败" }
if (!(Test-Path "$output/yovoice-windows-x64-setup.exe")) { throw "未生成 Setup 安装包" }
Write-Host "已生成：artifacts/yovoice-windows-x64-setup.exe"
