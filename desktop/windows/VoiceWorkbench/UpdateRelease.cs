using System.IO;
using System.Net;
using System.Net.Http;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace VoiceWorkbench.Desktop;

public sealed record UpdateAsset(string Name, [property: JsonPropertyName("browser_download_url")] Uri Url);
public sealed record UpdateRelease(
    [property: JsonPropertyName("tag_name")] string Tag,
    bool Draft, bool Prerelease, UpdateAsset[] Assets)
{
    // 发布说明与日期只用于界面展示，缺失时不影响更新。
    public string? Body { get; init; }
    [JsonPropertyName("published_at")] public DateTimeOffset? PublishedAt { get; init; }
    public string Version => Tag[1..];
    // 界面最多展示的发布说明长度，避免异常长的正文撑大消息。
    public string? Notes => Body is null ? null : Body.Length > 20000 ? Body[..20000] : Body;
    // 自动更新只下载不含内核的更新包，保留已安装的 CPU 或 CUDA 内核；内核在设置中单独升级。
    public UpdateAsset? Package(string current)
    {
        if (Draft || Prerelease) return null;
        if (!Regex.IsMatch(Tag, @"^v[0-9]+\.[0-9]+\.[0-9]+$") ||
            !System.Version.TryParse(Version, out var latest) || !System.Version.TryParse(current, out var running))
            throw new IOException(HostL10n.T("更新版本号无效。", "The update version number is invalid."));
        if (latest <= running) return null;
        return Asset($"yovoice-{Tag}-windows-x64-update.exe");
    }
    public UpdateAsset Asset(string name)
    {
        var matches = Assets.Where(asset => asset.Name == name).ToArray();
        if (matches.Length != 1) throw new IOException(HostL10n.T("当前版本缺少更新包或校验文件。", "This release is missing the update package or checksum file."));
        var asset = matches[0];
        if (!asset.Url.IsAbsoluteUri || asset.Url.Scheme != "https" || asset.Url.Host != "github.com" ||
            !asset.Url.IsDefaultPort || asset.Url.UserInfo.Length != 0 ||
            asset.Url.AbsolutePath != $"/leemysw/yovoice/releases/download/{Tag}/{name}")
            throw new IOException(HostL10n.T("更新文件地址无效。", "The update download address is invalid."));
        return asset;
    }
    // 更新服务返回的错误响应：GitHub 未登录接口限流时返回 403 或 429，说明原因与可重试时间，不误报为网络问题。
    public static string ServiceError(HttpResponseMessage response, DateTimeOffset now)
    {
        bool exhausted = response.Headers.TryGetValues("x-ratelimit-remaining", out var remaining) && remaining.FirstOrDefault() == "0";
        bool limited = response.StatusCode == HttpStatusCode.TooManyRequests ||
            response.StatusCode == HttpStatusCode.Forbidden && (exhausted || response.Headers.RetryAfter is not null);
        if (!limited)
            return HostL10n.T($"更新服务暂时不可用（HTTP {(int)response.StatusCode}），请稍后重试。", $"The update service is temporarily unavailable (HTTP {(int)response.StatusCode}). Try again later.");
        DateTimeOffset? retry = response.Headers.RetryAfter switch
        {
            { Delta: { } delay } => now + delay,
            { Date: { } date } => date,
            _ when exhausted && response.Headers.TryGetValues("x-ratelimit-reset", out var reset) && long.TryParse(reset.FirstOrDefault(), out long seconds) => DateTimeOffset.FromUnixTimeSeconds(seconds),
            _ => null,
        };
        if (retry is null)
            return HostL10n.T("GitHub 暂时限制了更新检查次数，请稍后重试。", "GitHub is temporarily limiting update checks. Try again later.");
        int minutes = Math.Max(1, (int)Math.Ceiling((retry.Value - now).TotalMinutes));
        return HostL10n.T($"GitHub 暂时限制了更新检查次数，请约 {minutes} 分钟后重试。", $"GitHub is temporarily limiting update checks. Try again in about {minutes} min.");
    }
    public static string Checksum(string text, string name)
    {
        var hashes = new List<string>();
        foreach (string line in text.Split('\n'))
        {
            var fields = line.Trim().Split((char[]?)null, 2, StringSplitOptions.RemoveEmptyEntries);
            if (fields.Length != 2) continue;
            string filename = fields[1].TrimStart('*');
            if (filename.StartsWith("./", StringComparison.Ordinal)) filename = filename[2..];
            if (filename == name) hashes.Add(fields[0]);
        }
        if (hashes.Count != 1 || !Regex.IsMatch(hashes[0], "^[0-9a-fA-F]{64}$"))
            throw new IOException(HostL10n.T("更新包的 SHA-256 校验信息无效。", "The SHA-256 checksum for the update package is invalid."));
        return hashes[0];
    }
}
