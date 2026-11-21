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
// 发布说明与日期随版本信息一起读取，供界面展示。
var parsed = System.Text.Json.JsonSerializer.Deserialize<UpdateRelease>("""{"tag_name":"v0.10.0","draft":false,"prerelease":false,"assets":[],"body":"### English\n- New","published_at":"2026-10-11T08:00:00Z"}""", new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;
Require(parsed.Notes == "### English\n- New" && parsed.PublishedAt == DateTimeOffset.Parse("2026-10-11T08:00:00Z"));
Require((release with { Body = new string('x', 30000) }).Notes!.Length == 20000 && release.Notes is null);
// GitHub 限流（403/429）说明原因与重试时间，其他错误状态仍提示服务暂不可用。
HostL10n.Apply("en");
var now = DateTimeOffset.FromUnixTimeSeconds(1_800_000_000);
static HttpResponseMessage Response(System.Net.HttpStatusCode status, params (string Name, string Value)[] headers)
{
    var response = new HttpResponseMessage(status);
    foreach (var (header, value) in headers) response.Headers.Add(header, value);
    return response;
}
Require(UpdateRelease.ServiceError(Response(System.Net.HttpStatusCode.Forbidden, ("x-ratelimit-remaining", "0"), ("x-ratelimit-reset", "1800001450")), now) == "GitHub is temporarily limiting update checks. Try again in about 25 min.");
Require(UpdateRelease.ServiceError(Response(System.Net.HttpStatusCode.Forbidden, ("Retry-After", "30")), now) == "GitHub is temporarily limiting update checks. Try again in about 1 min.");
Require(UpdateRelease.ServiceError(Response(System.Net.HttpStatusCode.TooManyRequests), now) == "GitHub is temporarily limiting update checks. Try again later.");
Require(UpdateRelease.ServiceError(Response(System.Net.HttpStatusCode.Forbidden, ("x-ratelimit-remaining", "12")), now) == "The update service is temporarily unavailable (HTTP 403). Try again later.");
Require(UpdateRelease.ServiceError(Response(System.Net.HttpStatusCode.BadGateway), now) == "The update service is temporarily unavailable (HTTP 502). Try again later.");
Console.WriteLine("版本比较、正式版筛选、Setup 选择、下载地址和校验文件、发布说明、限流提示检查通过。");
