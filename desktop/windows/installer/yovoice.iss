; 由打包脚本传入版本、应用目录、输出文件名和经过签名校验的 WebView2 安装器。
; 完整安装包携带一个内核（CPU、CUDA 12.4 或 CUDA 13.3）；定义 AppOnly 时生成只含应用本体的更新包，
; 覆盖安装时保留已安装的内核。
#ifndef OutputName
  #define OutputName "yovoice-windows-x64-setup"
#endif
[Setup]
AppId=yovoice.Desktop
AppName=yovoice
AppVersion={#AppVersion}
DefaultDirName={localappdata}\Programs\yovoice
DefaultGroupName=yovoice
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.19041
AppMutex=Local\VoiceWorkbench.Desktop
CloseApplications=yes
RestartApplications=no
OutputDir={#OutputDir}
OutputBaseFilename={#OutputName}
SetupIconFile=..\VoiceWorkbench\Resources\AppIcon.ico
UninstallDisplayIcon={app}\yovoice.exe
WizardStyle=modern
Compression=lzma2
SolidCompression=yes

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked

#ifndef AppOnly
[InstallDelete]
; 不同内核的完整安装包可互相覆盖安装，先移除旧内核，避免混入其他构建的 DLL。
Type: filesandordirs; Name: "{app}\engine"
#endif

[Files]
Source: "{#AppDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#Bootstrapper}"; DestName: "MicrosoftEdgeWebView2Setup.exe"; Flags: dontcopy

[Icons]
Name: "{autoprograms}\yovoice"; Filename: "{app}\yovoice.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\yovoice"; Filename: "{app}\yovoice.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\yovoice.exe"; Description: "Launch yovoice"; Flags: nowait postinstall skipifsilent

[Code]
#ifdef AppOnly
// 更新包不含内核，只能覆盖已有安装；首次安装需使用完整安装包。
function InitializeSetup(): Boolean;
begin
  Result := RegKeyExists(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Uninstall\yovoice.Desktop_is1');
  if not Result then
    SuppressibleMsgBox('This update package requires an existing yovoice installation. Please download a full -setup.exe installer.', mbError, MB_OK, IDOK);
end;
#endif

function HasRuntime(Root: Integer): Boolean;
var
  Version: String;
begin
  Result := RegQueryStringValue(Root,
    'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version)
    and (Version <> '') and (Version <> '0.0.0.0');
end;

function IsWebView2Installed(): Boolean;
begin
  Result := HasRuntime(HKLM32) or HasRuntime(HKLM64) or HasRuntime(HKCU);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  if IsWebView2Installed() then Exit;
  ExtractTemporaryFile('MicrosoftEdgeWebView2Setup.exe');
  if not Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebView2Setup.exe'), '/silent /install', '',
    SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    Result := 'Unable to start WebView2 installation. Please install Microsoft WebView2 Runtime and retry.'
  else if not IsWebView2Installed() then
    Result := 'WebView2 installation failed. Please check your network connection and retry. Exit code: ' + IntToStr(ResultCode);
end;
// 卸载只移除安装文件，保留用户目录中的 .yovoice 数据。
