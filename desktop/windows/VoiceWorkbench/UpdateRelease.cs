using System.IO;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace VoiceWorkbench.Desktop;

public sealed record UpdateAsset(string Name, [property: JsonPropertyName("browser_download_url")] Uri Url);
public sealed record UpdateRelease(
    [property: JsonPropertyName("tag_name")] string Tag,
    bool Draft, bool Prerelease, UpdateAsset[] Assets)
{
    public string Version => Tag[1..];
    public UpdateAsset? Package(string current)
    {
        if (Draft || Prerelease) return null;
        if (!Regex.IsMatch(Tag, @"^v[0-9]+\.[0-9]+\.[0-9]+$") ||
            !System.Version.TryParse(Version, out var latest) || !System.Version.TryParse(current, out var running))
            throw new IOException("更新版本号无效。");
        if (latest <= running) return null;
        return Asset($"yovoice-{Tag}-windows-x64-setup.exe");
    }
    public UpdateAsset Asset(string name)
    {
        var matches = Assets.Where(asset => asset.Name == name).ToArray();
        if (matches.Length != 1) throw new IOException("当前版本缺少更新包或校验文件。");
        var asset = matches[0];
        if (!asset.Url.IsAbsoluteUri || asset.Url.Scheme != "https" || asset.Url.Host != "github.com" ||
            !asset.Url.IsDefaultPort || asset.Url.UserInfo.Length != 0 ||
            asset.Url.AbsolutePath != $"/leemysw/yovoice/releases/download/{Tag}/{name}")
            throw new IOException("更新文件地址无效。");
        return asset;
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
            throw new IOException("更新包的 SHA-256 校验信息无效。");
        return hashes[0];
    }
}
