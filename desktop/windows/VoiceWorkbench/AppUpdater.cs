using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;

namespace VoiceWorkbench.Desktop;

// 推送给界面的更新状态；字段与 web/src/features/update/app-update.ts 的 AppUpdate 一致。
public sealed record UpdateSnapshot(
    string Current, string Status, string? Version = null, string? Notes = null, DateTimeOffset? PublishedAt = null,
    long Received = 0, long Total = 0, string? Error = null, DateTimeOffset? CheckedAt = null, string? UpdatedFrom = null);

public sealed class AppUpdater : IDisposable
{
    private readonly Window owner;
    private readonly MenuItem menu;
    private readonly string root;
    private readonly HttpClient client = new() { Timeout = TimeSpan.FromMinutes(15) };
    private readonly CancellationTokenSource stopped = new();
    private readonly DispatcherTimer timer = new() { Interval = TimeSpan.FromHours(4) };
    private readonly string current = Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "0.0.0";
    private readonly string target = Path.TrimEndingDirectorySeparator(AppContext.BaseDirectory);
    private bool checking;
    private bool showResult;
    private bool installRequested;
    public bool InstallRequested => installRequested;
    private bool disposed;
    private Process? installer;
    private string? commitPath;
    private ReadyUpdate? ready;
    private sealed record ReadyUpdate(string Package, string Hash, string Version);
    public UpdateSnapshot Snapshot { get; private set; }
    // 状态变化时通知界面；新版本就绪时额外通知宿主（如托盘提示）。
    public event Action<UpdateSnapshot>? Changed;
    public event Action<string>? Ready;
    // 菜单检查交给界面展示时返回 true；界面不可用时回退到原生对话框。
    public Func<bool>? ShowInApp { get; set; }

    public AppUpdater(Window owner, MenuItem menu, string root)
    {
        this.owner = owner; this.menu = menu; this.root = root;
        Snapshot = new UpdateSnapshot(current, "disabled");
        ApplyLocale();
        client.DefaultRequestHeaders.UserAgent.ParseAdd($"yovoice-Windows/{current}");
        menu.Click += async (_, _) =>
        {
            if (ShowInApp?.Invoke() == true) { await CheckAsync(); return; }
            if (ready is not null) { PromptInstall(); return; }
            showResult = true;
            await CheckAsync();
        };
        timer.Tick += async (_, _) => await CheckAsync();
    }
    public void Start()
    {
        if (Environment.GetEnvironmentVariable("WORKBENCH_DATA") is not null) return;
        Publish(Snapshot with { Status = "idle", UpdatedFrom = RecordLaunchVersion() });
        _ = Task.Run(RemoveInstalledUpdates);
        timer.Start();
        _ = CheckAsync();
    }
    // 记录本次启动的版本；版本升高说明刚完成更新，界面据此展示“已更新”。
    private string? RecordLaunchVersion()
    {
        string path = Path.Combine(root, "last-version.txt");
        string? previous = null;
        try
        {
            if (File.Exists(path)) previous = File.ReadAllText(path).Trim();
            File.WriteAllText(path, current);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
        return previous is not null && Version.TryParse(previous, out var last) && Version.TryParse(current, out var running) && last < running ? previous : null;
    }
    private void Publish(UpdateSnapshot next)
    {
        Snapshot = next;
        ApplyLocale();
        Changed?.Invoke(next);
    }
    // 菜单文字由当前状态推导，界面语言切换后也能立即刷新。
    public void ApplyLocale() => menu.Header = Snapshot.Status switch
    {
        "checking" => HostL10n.T("正在检查更新…", "Checking for Updates…"),
        "downloading" => HostL10n.T($"正在后台下载 {Snapshot.Version}…", $"Downloading {Snapshot.Version}…"),
        "verifying" => HostL10n.T("正在校验更新…", "Verifying Update…"),
        "ready" or "installing" => HostL10n.T($"重启并更新至 {Snapshot.Version}…", $"Restart and Update to {Snapshot.Version}…"),
        _ => HostL10n.T("检查更新…", "Check for Updates…"),
    };
    // 界面主动检查：结果在界面展示，不弹原生对话框。
    public Task CheckFromAppAsync() => CheckAsync();
    private async Task CheckAsync()
    {
        if (checking || ready is not null || disposed) return;
        checking = true;
        Publish(Snapshot with { Status = "checking", Error = null, Received = 0, Total = 0 });
        try
        {
            using var response = await client.GetAsync("https://api.github.com/repos/leemysw/yovoice/releases/latest", stopped.Token);
            if (response.StatusCode == HttpStatusCode.NotFound)
            {
                Publish(Snapshot with { Status = "latest", CheckedAt = DateTimeOffset.Now });
                if (showResult) AppDialog.Show(owner, HostL10n.T("暂无可用更新", "No Updates Available"), HostL10n.T("GitHub 上尚无可用的正式版本。", "There is no stable release on GitHub yet."));
                return;
            }
            response.EnsureSuccessStatusCode();
            var release = JsonSerializer.Deserialize<UpdateRelease>(await response.Content.ReadAsStringAsync(stopped.Token), new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? throw new IOException(HostL10n.T("版本信息无效。", "The release information is invalid."));
            var asset = release.Package(current);
            // 版本号已校验，过时版本的安装包不再保留。
            RemoveStaleUpdates(release.Tag);
            if (asset is null)
            {
                // 已是最新时仍带上当前正式版的说明，供刚更新后的“新功能”展示。
                bool same = release.Version == current;
                Publish(Snapshot with { Status = "latest", Version = same ? release.Version : null, Notes = same ? release.Notes : null, PublishedAt = same ? release.PublishedAt : null, CheckedAt = DateTimeOffset.Now });
                if (showResult) AppDialog.Show(owner, HostL10n.T("已是最新版本", "yovoice Is Up to Date"), HostL10n.T($"当前版本：yovoice {current}", $"Current version: yovoice {current}"));
                return;
            }
            Publish(Snapshot with { Status = "downloading", Version = release.Version, Notes = release.Notes, PublishedAt = release.PublishedAt, CheckedAt = DateTimeOffset.Now });
            string checksums = await client.GetStringAsync(release.Asset("SHA256SUMS.txt").Url, stopped.Token);
            string hash = UpdateRelease.Checksum(checksums, asset.Name);
            string directory = Path.Combine(root, "updates", release.Tag);
            Directory.CreateDirectory(directory);
            string package = Path.Combine(directory, asset.Name);
            if (!File.Exists(package) && !File.Exists(Path.Combine(directory, "use-full")))
            {
                try { ready = await PrepareDeltaAsync(release, directory, checksums); }
                catch (Exception error) when (!stopped.IsCancellationRequested)
                {
                    // 记下这一版改用常规更新包，之后不再重复下载和重建。
                    HostLog.Write(root, "update.delta_fallback", error);
                    File.WriteAllText(Path.Combine(directory, "use-full"), "1");
                    Publish(Snapshot with { Status = "downloading", Received = 0, Total = 0 });
                }
            }
            if (ready is null)
            {
                // 改用常规更新包时，重建目录（整份应用）和补丁不再需要。
                DeleteDeltaFiles(directory);
                if (!File.Exists(package)) await DownloadAsync(asset.Url, package);
                Publish(Snapshot with { Status = "verifying" });
                await VerifyHashAsync(package, hash);
                VerifyPublisher(package);
                ready = new ReadyUpdate(package, hash, release.Version);
            }
            Publish(Snapshot with { Status = "ready" });
            Ready?.Invoke(release.Version);
            if (showResult) PromptInstall();
        }
        catch (OperationCanceledException) when (stopped.IsCancellationRequested) { }
        catch (Exception error)
        {
            try
            {
                Directory.CreateDirectory(Path.Combine(root, "logs"));
                File.WriteAllText(Path.Combine(root, "logs", "update-check.log"), $"{DateTimeOffset.Now}: {error}\n");
            }
            catch (IOException) { }
            string message = error is HttpRequestException or TaskCanceledException ? HostL10n.T("无法连接更新服务，请检查网络或代理后重试。", "Could not reach the update service. Check your network or proxy and try again.") : error.Message;
            if (!disposed) Publish(Snapshot with { Status = "failed", Error = message, CheckedAt = DateTimeOffset.Now });
            if (showResult && !disposed && AppDialog.Show(owner, HostL10n.T("未能完成更新", "Update Failed"), message + HostL10n.T("\n\n你也可以从 GitHub 下载最新版本。", "\n\nYou can also download the latest version from GitHub."), HostL10n.T("打开下载页", "Open Download Page"), HostL10n.T("稍后再试", "Later")))
                Process.Start(new ProcessStartInfo("https://github.com/leemysw/yovoice/releases/latest") { UseShellExecute = true });
        }
        finally { checking = false; showResult = false; }
    }
    private async Task<ReadyUpdate?> PrepareDeltaAsync(UpdateRelease release, string directory, string checksums)
    {
        string deltaName = $"yovoice-v{current}-to-{release.Tag}-windows-x64.delta";
        if (!release.Assets.Any(item => item.Name == deltaName)) return null;
        var delta = release.Asset(deltaName);
        string patch = Path.Combine(directory, delta.Name);
        if (!File.Exists(patch)) await DownloadAsync(delta.Url, patch);
        Publish(Snapshot with { Status = "verifying" });
        await VerifyHashAsync(patch, UpdateRelease.Checksum(checksums, delta.Name));
        string stage = Path.Combine(directory, "delta-stage");
        if (Directory.Exists(stage)) Directory.Delete(stage, true);
        var start = new ProcessStartInfo(Path.Combine(target, "service", "yovoice-service.exe")) {
            UseShellExecute = false, CreateNoWindow = true
        };
        foreach (string arg in new[] { "--apply-update-delta", patch, current, release.Version, target, stage })
            start.ArgumentList.Add(arg);
        using var helper = Process.Start(start) ?? throw new IOException("Delta helper");
        try { await helper.WaitForExitAsync(stopped.Token); }
        catch (OperationCanceledException) { if (!helper.HasExited) helper.Kill(true); throw; }
        if (helper.ExitCode != 0) throw new IOException("Delta reconstruction failed");
        string bootstrap = Path.Combine(stage, "delta-install.exe");
        // 补丁已校验，重建器又逐文件核验；记录安装器摘要供退出后的独立助手复核。
        string bootstrapHash = await FileHashAsync(bootstrap);
        VerifyPublisher(bootstrap);
        return new ReadyUpdate(bootstrap, bootstrapHash, release.Version);
    }

    private static void DeleteDeltaFiles(string directory)
    {
        try
        {
            string stage = Path.Combine(directory, "delta-stage");
            if (Directory.Exists(stage)) Directory.Delete(stage, true);
            foreach (string patch in Directory.EnumerateFiles(directory, "*.delta")) File.Delete(patch);
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    private async Task<string> FileHashAsync(string path)
    {
        await using var file = File.OpenRead(path);
        return Convert.ToHexString(await SHA256.HashDataAsync(file, stopped.Token));
    }

    private async Task VerifyHashAsync(string package, string hash)
    {
        if (!(await FileHashAsync(package)).Equals(hash, StringComparison.OrdinalIgnoreCase))
        {
            File.Delete(package);
            throw new IOException(HostL10n.T("更新包校验失败，已删除下载文件，请重试。", "The update package failed verification and was deleted. Try again."));
        }
    }
    private static void VerifyPublisher(string package)
    {
        // 当前应用带有效签名时，更新包必须由同一发行者签名，避免发布渠道被冒用时安装来路不明的程序。
        if (Environment.ProcessPath is { } self && Authenticode.Signer(self) is { } publisher && Authenticode.Signer(package) != publisher)
        {
            File.Delete(package);
            throw new IOException(HostL10n.T("更新包的签名与当前应用不一致，已删除下载文件。请从 GitHub 手动下载最新版本。", "The update package isn't signed by the same publisher as this app and was deleted. Download the latest version from GitHub manually."));
        }
    }
    // 断点续传到 .part 文件，并按字节上报进度；最终由 SHA-256 校验完整性。
    private async Task DownloadAsync(Uri url, string package)
    {
        string partial = package + ".part";
        long offset = File.Exists(partial) ? new FileInfo(partial).Length : 0;
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        if (offset > 0) request.Headers.Range = new RangeHeaderValue(offset, null);
        using var download = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, stopped.Token);
        if (download.StatusCode == HttpStatusCode.RequestedRangeNotSatisfiable) { File.Delete(partial); throw new IOException(HostL10n.T("下载的更新包不完整，请重试。", "The downloaded update is incomplete. Try again.")); }
        download.EnsureSuccessStatusCode();
        // 服务器忽略续传请求时从头下载。
        if (download.StatusCode != HttpStatusCode.PartialContent) offset = 0;
        long total = download.Content.Headers.ContentLength is long length ? offset + length : 0;
        long received = offset;
        Publish(Snapshot with { Received = received, Total = total });
        await using (var file = new FileStream(partial, offset > 0 ? FileMode.Append : FileMode.Create, FileAccess.Write, FileShare.None))
        await using (var stream = await download.Content.ReadAsStreamAsync(stopped.Token))
        {
            var buffer = new byte[81920];
            var clock = Stopwatch.StartNew();
            int read;
            while ((read = await stream.ReadAsync(buffer, stopped.Token)) > 0)
            {
                await file.WriteAsync(buffer.AsMemory(0, read), stopped.Token);
                received += read;
                // 进度最多每 200 毫秒推送一次，避免频繁刷新界面。
                if (clock.ElapsedMilliseconds < 200) continue;
                clock.Restart();
                Publish(Snapshot with { Received = received, Total = total });
            }
        }
        Publish(Snapshot with { Received = received, Total = Math.Max(total, received) });
        File.Move(partial, package, true);
    }
    // 当前及更早版本的更新缓存已用不上（安装助手删除失败时留下的包、补丁和备份），启动时清理，不依赖联网检查。
    // 0.7.0 及更早的安装助手把备份放在安装目录旁边的 .yovoice-update.*，一并删除。
    private void RemoveInstalledUpdates()
    {
        Version.TryParse(current, out var running);
        string updates = Path.Combine(root, "updates");
        var stale = new List<string>();
        if (running is not null && Directory.Exists(updates))
            stale.AddRange(Directory.GetDirectories(updates).Where(directory =>
                Path.GetFileName(directory) is { } name && name.StartsWith('v') && Version.TryParse(name[1..], out var version) && version <= running));
        if (Path.GetDirectoryName(target) is { } parent)
        {
            try { stale.AddRange(Directory.GetDirectories(parent, ".yovoice-update.*")); }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
        }
        foreach (string directory in stale)
        {
            try { Directory.Delete(directory, true); }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
        }
    }
    private void RemoveStaleUpdates(string keep)
    {
        string updates = Path.Combine(root, "updates");
        if (!Directory.Exists(updates)) return;
        foreach (string directory in Directory.GetDirectories(updates))
        {
            if (string.Equals(Path.GetFileName(directory), keep, StringComparison.OrdinalIgnoreCase)) continue;
            try { Directory.Delete(directory, true); }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
        }
    }
    private void PromptInstall()
    {
        if (ready is null || installRequested) return;
        if (!AppDialog.Show(owner, HostL10n.T("更新已准备好", "Update Ready"), HostL10n.T($"yovoice {ready.Version} 已下载并通过校验。重启后将安装更新，当前作品会先自动保存。", $"yovoice {ready.Version} has been downloaded and verified. Restart to install it; your current work is saved first."), HostL10n.T("重启并更新", "Restart and Update"), HostL10n.T("稍后", "Later"))) return;
        Install();
    }
    // 界面上的“重启并更新”已是明确确认，直接进入保存并退出流程。
    public bool Install()
    {
        if (ready is null || installRequested) return false;
        installRequested = true;
        Publish(Snapshot with { Status = "installing" });
        owner.Dispatcher.BeginInvoke(owner.Close);
        return true;
    }
    // 助手就绪后才关闭服务；只有写入确认文件并退出后才允许替换。
    public async Task PrepareInstallAsync()
    {
        if (!installRequested || ready is null) return;
        string directory = Path.Combine(root, "updates", "v" + ready.Version, Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        string script = Path.Combine(directory, "install-update.ps1");
        File.Copy(Path.Combine(AppContext.BaseDirectory, "install-update.ps1"), script);
        string signal = Path.Combine(directory, "ready");
        commitPath = Path.Combine(directory, "commit");
        string config = Path.Combine(directory, "update.json");
        Directory.CreateDirectory(Path.Combine(root, "logs"));
        File.WriteAllText(config, JsonSerializer.Serialize(new
        {
            ParentId = Environment.ProcessId, PackagePath = ready.Package, TargetDirectory = target,
            ExpectedHash = ready.Hash, Version = ready.Version,
            ReadyPath = signal, CommitPath = commitPath, LogPath = Path.Combine(root, "logs", "update-install.log")
        }));
        var start = new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe"))
        { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = directory };
        foreach (string argument in new[] { "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-Config", config }) start.ArgumentList.Add(argument);
        installer = Process.Start(start) ?? throw new IOException(HostL10n.T("更新助手未能启动。", "The update helper could not start."));
        for (int attempt = 0; attempt < 300; attempt++)
        {
            if (installer.HasExited) throw new IOException(HostL10n.T("更新助手启动失败，请查看 update-install.log。", "The update helper failed to start. See update-install.log."));
            if (File.Exists(signal)) return;
            await Task.Delay(100, stopped.Token);
        }
        throw new IOException(HostL10n.T("更新助手启动超时，请重试。", "The update helper timed out while starting. Try again."));
    }
    public void CommitInstall()
    {
        if (installRequested && commitPath is not null) File.WriteAllText(commitPath, "install");
    }
    public void CancelInstall()
    {
        bool wasRequested = installRequested;
        installRequested = false;
        if (installer is { HasExited: false })
        {
            try { installer.Kill(entireProcessTree: true); }
            catch (InvalidOperationException) { }
        }
        installer?.Dispose(); installer = null;
        if (commitPath is not null) File.Delete(commitPath);
        // 用户取消退出后更新仍可再次安装。
        if (wasRequested && ready is not null && !disposed)
        {
            if (Path.GetFileName(ready.Package) == "delta-install.exe" &&
                File.Exists(Path.Combine(root, "updates", "v" + ready.Version, "use-full")))
            {
                ready = null;
                _ = CheckAsync();
            }
            else Publish(Snapshot with { Status = "ready" });
        }
    }
    public void Dispose()
    {
        disposed = true; timer.Stop(); stopped.Cancel(); client.Dispose();
        // 成功退出时保留独立安装助手，由它完成替换。
    }
}
