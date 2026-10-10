using VoiceWorkbench.Desktop;

static void Require(bool condition) { if (!condition) throw new Exception("更新检查失败。"); }
static void Reject(Action action)
{
    try { action(); } catch (IOException) { return; }
    throw new Exception("应拒绝无效更新。");
}
string name = "yovoice-v0.10.0-windows-x64-update.exe";
var asset = new UpdateAsset(name, new Uri($"https://github.com/leemysw/yovoice/releases/download/v0.10.0/{name}"));
var release = new UpdateRelease("v0.10.0", false, false, [asset]);
Require(release.Package("0.9.9") == asset);
Require(release.Package("0.10.0") is null && release.Package("1.0.0") is null);
Require((release with { Prerelease = true }).Package("0.1.0") is null);
Reject(() => (release with { Tag = "v../../1.0.0" }).Package("0.1.0"));
Reject(() => (release with { Assets = [] }).Package("0.1.0"));
Reject(() => (release with { Assets = [asset with { Url = new Uri("https://example.com/update.exe") }] }).Package("0.1.0"));
Reject(() => (release with { Assets = [asset with { Name = "yovoice-v0.10.0-windows-x64.zip" }] }).Package("0.1.0"));
// 自动更新只选择不含内核的更新包，不会下载完整安装包。
string setupName = "yovoice-v0.10.0-windows-x64-cuda12.4-setup.exe";
var setup = new UpdateAsset(setupName, new Uri($"https://github.com/leemysw/yovoice/releases/download/v0.10.0/{setupName}"));
Require((release with { Assets = [setup, asset] }).Package("0.9.9") == asset);
Reject(() => (release with { Assets = [setup] }).Package("0.9.9"));
string hash = new('a', 64);
Require(UpdateRelease.Checksum($"{new string('b', 64)}  ./other.exe\n{hash}  ./{name}\n", name) == hash);
Reject(() => UpdateRelease.Checksum($"{hash}  ./other.exe", name));
Reject(() => UpdateRelease.Checksum($"{hash}  {name}\n{hash}  {name}", name));
Reject(() => UpdateRelease.Checksum($"invalid  {name}", name));
Console.WriteLine("版本比较、正式版筛选、Setup 选择、下载地址和校验文件检查通过。");
