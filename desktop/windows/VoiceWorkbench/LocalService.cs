using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Text.Json;

namespace VoiceWorkbench.Desktop;

// 原生宿主只管理服务生命周期；业务状态由 Go 服务统一持有。
public sealed class LocalService : IDisposable
{
    public string Root { get; } = DetermineDataRoot();
    public string Token { get; } = Guid.NewGuid().ToString("N") + Guid.NewGuid().ToString("N");
    public string CookieName => "vw-" + Token[..12];
    public string Origin { get; private set; } = "";
    private readonly HttpClient client = new(new HttpClientHandler { UseProxy = false }) { Timeout = Timeout.InfiniteTimeSpan };
    private readonly CancellationTokenSource stopped = new();
    private Process? process;
    private Task? events;
    public event Action<string>? StateChanged;
    public event Action<string>? Failed;

    // 自定义的数据目录不存在时（外置盘未连接、目录被移动或删除）不能静默新建空目录：
    // 用户会以为数据全丢了；让用户选择重试、退出，或明确在原位置新建空的数据目录。
    private static string ConfirmAvailable(string path)
    {
        while (!Directory.Exists(path))
        {
            if (AppDialog.Show(null, HostL10n.T("找不到数据目录", "Data Folder Not Found"), HostL10n.T(path + " 不存在。可能是外置磁盘未连接，或目录已被移动、删除。\n\n连接磁盘后点“重试”；确认不再需要原数据时，可以在原位置新建空的数据目录。", path + " does not exist. The external drive may be disconnected, or the folder was moved or deleted.\n\nReconnect the drive and click Retry. If you no longer need the original data, you can create an empty data folder at the same location."), HostL10n.T("重试", "Retry"), HostL10n.T("更多选项", "More Options"))) continue;
            if (!AppDialog.Show(null, HostL10n.T("在原位置新建空的数据目录？", "Create an Empty Data Folder?"), HostL10n.T("将在 " + path + " 新建空的数据目录，原有作品、音色和模型不会出现在应用中。原目录恢复后可再次切换回去。", "An empty data folder will be created at " + path + ". Your existing works, voices and models will not appear in the app. You can switch back once the original folder is available again."), HostL10n.T("新建空目录", "Create Empty Folder"), HostL10n.T("退出", "Quit")))
                throw new OperationCanceledException("startup cancelled");
            try { Directory.CreateDirectory(path); }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or NotSupportedException) { AppDialog.Show(null, HostL10n.T("无法创建数据目录", "Could Not Create Data Folder"), error.Message); }
        }
        return path;
    }
    private static string ServiceExecutable => Path.Combine(AppContext.BaseDirectory, "service", "yovoice-service.exe");

    // 同步运行服务的辅助命令并返回标准输出；退出码非零时以服务的错误信息抛出。
    private static string RunService(params string[] arguments)
    {
        if (!File.Exists(ServiceExecutable)) throw new IOException(HostL10n.T("本地服务缺失，请重新构建或安装应用。", "The local service is missing. Rebuild or reinstall the app."));
        var start = new ProcessStartInfo(ServiceExecutable) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (string argument in arguments) start.ArgumentList.Add(argument);
        using var process = Process.Start(start) ?? throw new IOException(HostL10n.T("无法启动本地服务。", "Could not start the local service."));
        var error = process.StandardError.ReadToEndAsync();
        string output = process.StandardOutput.ReadToEnd();
        process.WaitForExit();
        if (process.ExitCode != 0) throw new IOException(HostL10n.T("存储配置无法读取或写入：", "The storage settings could not be read or written: ") + error.Result.Trim());
        return output;
    }

    private static string DetermineDataRoot()
    {
        string? env = Environment.GetEnvironmentVariable("WORKBENCH_DATA");
        if (!string.IsNullOrWhiteSpace(env)) return Path.GetFullPath(env);

        // 存储配置只由服务解析：配置损坏时直接报错退出，不静默回退到默认目录，也不会被宿主覆盖。
        using (var config = JsonDocument.Parse(RunService("--data-root")))
        {
            if (config.RootElement.TryGetProperty("dataPath", out var p) && p.GetString() is { Length: > 0 } customPath)
                return ConfirmAvailable(Path.GetFullPath(customPath));
        }

        string defaultUserData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".yovoice");
        // 旧版 VoiceWorkbench 数据会由 --prepare-data 迁移到 ~/.yovoice，此时必须沿用默认目录。
        string legacyData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "VoiceWorkbench");
        if (Directory.Exists(defaultUserData) || Directory.Exists(legacyData))
        {
            return defaultUserData;
        }

        string installDir = AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        string installRoot = Path.GetPathRoot(installDir) ?? "";
        string userRoot = Path.GetPathRoot(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)) ?? "";
        if (!string.IsNullOrEmpty(installRoot) && !string.IsNullOrEmpty(userRoot) &&
            !installRoot.Equals(userRoot, StringComparison.OrdinalIgnoreCase))
        {
            string? parent = Path.GetDirectoryName(installDir);
            if (!string.IsNullOrEmpty(parent))
            {
                string chosen = Path.Combine(parent, "yovoice-data");
                // 记录自动选择的目录：之后即使 ~/.yovoice 被命令行等工具创建，桌面应用也不会悄悄切回系统盘。
                // 由服务原子写入并保留配置中的其他内容；记录失败不影响本次启动。
                try { RunService("--set-data-root", chosen); }
                catch (IOException error) { HostLog.Write(chosen, "storage.config_write_failed", error); }
                return chosen;
            }
        }

        return defaultUserData;
    }

    public async Task StartAsync()
    {
        if (process is { HasExited: false }) return;
        HostLog.Write(Root, "service.start_requested");
        string executable = Path.Combine(AppContext.BaseDirectory, "service", "yovoice-service.exe");
        if (!File.Exists(executable)) throw new IOException(HostL10n.T("本地服务缺失，请重新构建或安装应用。", "The local service is missing. Rebuild or reinstall the app."));
        if (Environment.GetEnvironmentVariable("WORKBENCH_DATA") is null)
        {
            using var migration = Process.Start(new ProcessStartInfo(executable, "--prepare-data") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardError = true })!;
            string error = await migration.StandardError.ReadToEndAsync();
            await migration.WaitForExitAsync();
            if (migration.ExitCode != 0) throw new IOException(HostL10n.T("数据目录迁移失败：", "Data folder migration failed: ") + error);
        }
        Directory.CreateDirectory(Path.Combine(Root, "logs"));
        var start = new ProcessStartInfo(executable) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
        start.Environment["WORKBENCH_DATA"] = Root;
        start.Environment["WORKBENCH_WEB"] = Path.Combine(AppContext.BaseDirectory, "web");
        start.Environment["WORKBENCH_TOKEN"] = Token;
        start.Environment["WORKBENCH_ENGINE"] = Path.Combine(AppContext.BaseDirectory, "engine", "audiocpp_server.exe");
        process = Process.Start(start) ?? throw new IOException(HostL10n.T("无法启动本地服务。", "Could not start the local service."));
        _ = PumpErrorsAsync(process);
        try
        {
            string? address = await process.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(30));
            if (!Uri.TryCreate(address, UriKind.Absolute, out var uri) || uri.Scheme != "http" || uri.Host != "127.0.0.1") throw new IOException(HostL10n.T("本地服务未返回有效地址，请检查日志。", "The local service did not return a valid address. Check the logs."));
            Origin = uri.GetLeftPart(UriPartial.Authority);
        }
        catch
        {
            // 服务没在限时内给出地址：结束它再报告原始错误，避免残留进程让重试误判为已启动。
            try
            {
                process.StandardInput.Close();
                try { await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(10)); }
                catch (TimeoutException) { process.Kill(true); }
            }
            catch (Exception error) when (error is InvalidOperationException or IOException or System.ComponentModel.Win32Exception) { HostLog.Write(Root, "service.start_cleanup_failed", error); }
            throw;
        }
        HostLog.Write(Root, "service.ready");
        // 服务重启后沿用已有的事件循环，它会按新地址重新连接，避免重复推送状态。
        if (events is null || events.IsCompleted) events = ReadEventsAsync();
    }
    private async Task PumpErrorsAsync(Process running)
    {
        try
        {
            // 与 macOS 一致：追加写入同一文件，超过 5MB 才滚动为 .1，避免日志无限增长；
            // 服务崩溃后重新启动时，上一轮的出错原因仍保留在文件中。
            string path = Path.Combine(Root, "logs", "host-service.log");
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var log = OpenServiceLog(path);
            await log.WriteLineAsync($"{Environment.NewLine}===== {DateTimeOffset.Now:O} service =====");
            long size = log.BaseStream.Length;
            try
            {
                while (await running.StandardError.ReadLineAsync() is { } line)
                {
                    if (size >= ServiceLogLimit)
                    {
                        await log.DisposeAsync();
                        log = OpenServiceLog(path);
                        size = 0;
                    }
                    await log.WriteLineAsync(line);
                    await log.FlushAsync();
                    size += Encoding.UTF8.GetByteCount(line) + Environment.NewLine.Length;
                }
            }
            finally { await log.DisposeAsync(); }
            await running.WaitForExitAsync();
            HostLog.Write(Root, "service.exited:" + running.ExitCode);
            if (!stopped.IsCancellationRequested) Failed?.Invoke(HostL10n.T($"本地服务意外停止（{running.ExitCode}），诊断记录保存在日志目录。", $"The local service stopped unexpectedly ({running.ExitCode}). Diagnostics are in the logs folder."));
        }
        catch (Exception error) when (error is IOException or ObjectDisposedException or InvalidOperationException) { }
    }
    private const long ServiceLogLimit = 5 * 1024 * 1024;
    // 轮转失败（例如日志正被外部程序占用）时退回追加写入，不能因此停止读取 stderr，否则服务会被管道阻塞。
    private static StreamWriter OpenServiceLog(string path)
    {
        try { if (File.Exists(path) && new FileInfo(path).Length >= ServiceLogLimit) File.Move(path, path + ".1", true); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { Debug.WriteLine(error); }
        return new StreamWriter(path, true);
    }
    private HttpRequestMessage Request(HttpMethod method, string path)
    {
        var request = new HttpRequestMessage(method, Origin + "/" + path);
        request.Headers.Add("Cookie", CookieName + "=" + Token);
        return request;
    }
    // 默认 120 秒超时；迁移数据目录等同步复制大量文件的调用需由调用方放宽，与 macOS 宿主保持一致。
    public async Task<JsonElement> CallAsync(string method, object data, TimeSpan? limit = null)
    {
        using var request = Request(HttpMethod.Post, "api/call");
        request.Content = new StringContent(ServiceWire.Request(method, data), Encoding.UTF8, "application/json");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stopped.Token);
        timeout.CancelAfter(limit ?? TimeSpan.FromSeconds(120));
        using var response = await client.SendAsync(request, timeout.Token);
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(timeout.Token));
        if (json.RootElement.TryGetProperty("error", out var error) && error.ValueKind != JsonValueKind.Null) throw new ServiceCallException(error);
        return json.RootElement.GetProperty("result").Clone();
    }
    private async Task ReadEventsAsync()
    {
        // 推送断开时界面不再更新（生成完成却没有反应），因此连接、断开与出错都记入宿主日志；
        // 重连每秒一次，连续失败只记第一次。任何异常都不能让循环退出，否则只有重启应用才能恢复。
        bool failing = false;
        while (!stopped.IsCancellationRequested)
        {
            long received = 0;
            try
            {
                using var request = Request(HttpMethod.Get, "api/state-events");
                using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, stopped.Token).ConfigureAwait(false);
                response.EnsureSuccessStatusCode();
                HostLog.Write(Root, "service.events_connected");
                failing = false;
                using var reader = new StreamReader(await response.Content.ReadAsStreamAsync(stopped.Token).ConfigureAwait(false));
                while (await reader.ReadLineAsync(stopped.Token).ConfigureAwait(false) is { } line)
                {
                    if (!line.StartsWith("data: ", StringComparison.Ordinal)) continue;
                    received++;
                    StateChanged?.Invoke(line[6..]);
                }
                HostLog.Write(Root, "service.events_ended:" + received);
            }
            catch (OperationCanceledException) when (stopped.IsCancellationRequested) { return; }
            catch (Exception error)
            {
                if (!failing) HostLog.Write(Root, "service.events_failed:" + received, error);
                failing = true;
            }
            try { await Task.Delay(1000, stopped.Token).ConfigureAwait(false); } catch (OperationCanceledException) { return; }
        }
    }
    public async Task ShutdownAsync()
    {
        HostLog.Write(Root, "service.shutdown_requested");
        if (process is not { HasExited: false }) return;
        using var request = Request(HttpMethod.Post, "shutdown");
        using var response = await client.SendAsync(request).WaitAsync(TimeSpan.FromSeconds(30));
        response.EnsureSuccessStatusCode();
        // 服务已接受关停并完成保存，此后不能再让退出失败：事件循环与调用通道已取消，返回编辑会留下无法使用的窗口。
        stopped.Cancel();
        process.StandardInput.Close();
        try { await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(10)); }
        catch (TimeoutException)
        {
            HostLog.Write(Root, "service.shutdown_timeout");
            try { process.Kill(true); }
            catch (Exception error) when (error is InvalidOperationException or System.ComponentModel.Win32Exception) { HostLog.Write(Root, "service.stop_failed", error); }
        }
        HostLog.Write(Root, "service.shutdown_completed");
    }
    // 正常关停失败时使用：先关闭标准输入让服务自行退出，超时则结束进程。
    public void Stop()
    {
        stopped.Cancel();
        if (process is not { HasExited: false }) return;
        try
        {
            process.StandardInput.Close();
            if (!process.WaitForExit(5000)) process.Kill(true);
        }
        catch (Exception error) when (error is InvalidOperationException or IOException or System.ComponentModel.Win32Exception) { HostLog.Write(Root, "service.stop_failed", error); }
    }
    public void Dispose()
    {
        stopped.Cancel();
        if (process is { HasExited: false }) process.StandardInput.Close();
        process?.Dispose(); client.Dispose();
    }
}
