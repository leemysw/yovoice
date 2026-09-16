using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;

namespace VoiceWorkbench.Desktop;

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

    public AppUpdater(Window owner, MenuItem menu, string root)
    {
        this.owner = owner; this.menu = menu; this.root = root;
        client.DefaultRequestHeaders.UserAgent.ParseAdd($"yovoice-Windows/{current}");
        menu.Click += async (_, _) =>
        {
            if (ready is not null) { PromptInstall(); return; }
            showResult = true;
            await CheckAsync();
        };
        timer.Tick += async (_, _) => await CheckAsync();
    }
    public void Start()
    {
        if (Environment.GetEnvironmentVariable("WORKBENCH_DATA") is not null) return;
        timer.Start();
        _ = CheckAsync();
    }
    private async Task CheckAsync()
    {
        if (checking || ready is not null || disposed) return;
        checking = true;
        menu.Header = "正在检查更新…";
        try
        {
            using var response = await client.GetAsync("https://api.github.com/repos/leemysw/yovoice/releases/latest", stopped.Token);
            if (response.StatusCode == HttpStatusCode.NotFound)
            {
                menu.Header = "检查更新…";
                if (showResult) MessageBox.Show(owner, "GitHub 上尚无可用的正式版本。", "暂无可用更新");
                return;
            }
            response.EnsureSuccessStatusCode();
            var release = JsonSerializer.Deserialize<UpdateRelease>(await response.Content.ReadAsStringAsync(stopped.Token), new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? throw new IOException("版本信息无效。");
            var asset = release.Package(current);
            if (asset is null)
            {
                menu.Header = "检查更新…";
                if (showResult) MessageBox.Show(owner, $"当前版本：{current}", "yovoice 已是最新版本");
                return;
            }
            string checksums = await client.GetStringAsync(release.Asset("SHA256SUMS.txt").Url, stopped.Token);
            string hash = UpdateRelease.Checksum(checksums, asset.Name);
            string directory = Path.Combine(root, "updates", release.Tag);
            Directory.CreateDirectory(directory);
            string package = Path.Combine(directory, asset.Name);
            menu.Header = $"正在后台下载 {release.Version}…";
            if (!File.Exists(package))
            {
                string partial = package + ".part";
                try
                {
                    using var download = await client.GetAsync(asset.Url, HttpCompletionOption.ResponseHeadersRead, stopped.Token);
                    download.EnsureSuccessStatusCode();
                    await using (var file = File.Create(partial))
                        await download.Content.CopyToAsync(file, stopped.Token);
                    File.Move(partial, package, true);
                }
                finally { File.Delete(partial); }
            }
            menu.Header = "正在校验更新…";
            await using (var file = File.OpenRead(package))
            {
                string actual = Convert.ToHexString(await SHA256.HashDataAsync(file, stopped.Token));
                if (!actual.Equals(hash, StringComparison.OrdinalIgnoreCase))
                {
                    file.Close(); File.Delete(package);
                    throw new IOException("更新包校验失败，已删除下载文件，请重试。");
                }
            }
            ready = new ReadyUpdate(package, hash, release.Version);
            menu.Header = $"重启并更新至 {release.Version}…";
            if (showResult) PromptInstall();
        }
        catch (OperationCanceledException) when (stopped.IsCancellationRequested) { }
        catch (Exception error)
        {
            menu.Header = "检查更新…";
            try
            {
                Directory.CreateDirectory(Path.Combine(root, "logs"));
                File.WriteAllText(Path.Combine(root, "logs", "update-check.log"), $"{DateTimeOffset.Now}: {error}\n");
            }
            catch (IOException) { }
            if (showResult && !disposed && MessageBox.Show(owner, error.Message + "\n\n是否打开 GitHub 下载页？", "未能完成更新", MessageBoxButton.YesNo) == MessageBoxResult.Yes)
                Process.Start(new ProcessStartInfo("https://github.com/leemysw/yovoice/releases/latest") { UseShellExecute = true });
        }
        finally { checking = false; showResult = false; }
    }
    private void PromptInstall()
    {
        if (ready is null || installRequested) return;
        if (MessageBox.Show(owner, "更新已下载并通过校验。现在保存作品并重启安装？", $"yovoice {ready.Version} 已准备好", MessageBoxButton.OKCancel) != MessageBoxResult.OK) return;
        installRequested = true;
        owner.Close();
    }
    // 助手就绪后才关闭服务；只有写入确认文件并退出后才允许替换。
    public async Task PrepareInstallAsync()
    {
        if (!installRequested || ready is null) return;
        string directory = Path.Combine(Path.GetDirectoryName(ready.Package)!, Guid.NewGuid().ToString("N"));
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
        installer = Process.Start(start) ?? throw new IOException("更新助手未能启动。");
        for (int attempt = 0; attempt < 300; attempt++)
        {
            if (installer.HasExited) throw new IOException("更新助手启动失败，请查看 update-install.log。");
            if (File.Exists(signal)) return;
            await Task.Delay(100, stopped.Token);
        }
        throw new IOException("更新助手启动超时，请重试。");
    }
    public void CommitInstall()
    {
        if (installRequested && commitPath is not null) File.WriteAllText(commitPath, "install");
    }
    public void CancelInstall()
    {
        installRequested = false;
        if (installer is { HasExited: false })
        {
            try { installer.Kill(entireProcessTree: true); }
            catch (InvalidOperationException) { }
        }
        installer?.Dispose(); installer = null;
        if (commitPath is not null) File.Delete(commitPath);
    }
    public void Dispose()
    {
        disposed = true; timer.Stop(); stopped.Cancel(); client.Dispose();
        // 成功退出时保留独立安装助手，由它完成替换。
    }
}
