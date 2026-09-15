using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Text.Json;

namespace VoiceWorkbench.Desktop;

// 原生宿主只管理服务生命周期；业务状态由 Go 服务统一持有。
public sealed class LocalService : IDisposable
{
    public string Root { get; } = Environment.GetEnvironmentVariable("WORKBENCH_DATA") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".yovoice");
    public string Token { get; } = Guid.NewGuid().ToString("N") + Guid.NewGuid().ToString("N");
    public string CookieName => "vw-" + Token[..12];
    public string Origin { get; private set; } = "";
    private readonly HttpClient client = new(new HttpClientHandler { UseProxy = false }) { Timeout = Timeout.InfiniteTimeSpan };
    private readonly CancellationTokenSource stopped = new();
    private Process? process;
    private Task? events;
    public event Action<string>? StateChanged;
    public event Action<string>? Failed;

    public async Task StartAsync()
    {
        if (process is { HasExited: false }) return;
        string executable = Path.Combine(AppContext.BaseDirectory, "service", "yovoice-service.exe");
        if (!File.Exists(executable)) throw new IOException("本地服务缺失，请重新构建或安装应用。");
        if (Environment.GetEnvironmentVariable("WORKBENCH_DATA") is null)
        {
            using var migration = Process.Start(new ProcessStartInfo(executable, "--prepare-data") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardError = true })!;
            string error = await migration.StandardError.ReadToEndAsync();
            await migration.WaitForExitAsync();
            if (migration.ExitCode != 0) throw new IOException("数据目录迁移失败：" + error);
        }
        Directory.CreateDirectory(Path.Combine(Root, "logs"));
        var start = new ProcessStartInfo(executable) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
        start.Environment["WORKBENCH_DATA"] = Root;
        start.Environment["WORKBENCH_WEB"] = Path.Combine(AppContext.BaseDirectory, "web");
        start.Environment["WORKBENCH_TOKEN"] = Token;
        start.Environment["WORKBENCH_ENGINE"] = Path.Combine(AppContext.BaseDirectory, "engine", "audiocpp_server.exe");
        process = Process.Start(start) ?? throw new IOException("无法启动本地服务。");
        _ = PumpErrorsAsync(process);
        try
        {
            string? address = await process.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(30));
            if (!Uri.TryCreate(address, UriKind.Absolute, out var uri) || uri.Scheme != "http" || uri.Host != "127.0.0.1") throw new IOException("本地服务未返回有效地址，请检查日志。");
            Origin = uri.GetLeftPart(UriPartial.Authority);
        }
        catch
        {
            process.StandardInput.Close();
            await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(10));
            throw;
        }
        events = ReadEventsAsync();
    }
    private async Task PumpErrorsAsync(Process running)
    {
        try
        {
            using var log = new StreamWriter(Path.Combine(Root, "logs", "host-service.log"), false);
            while (await running.StandardError.ReadLineAsync() is { } line) { await log.WriteLineAsync(line); await log.FlushAsync(); }
            await running.WaitForExitAsync();
            if (!stopped.IsCancellationRequested) Failed?.Invoke("本地服务已停止，请退出后重新打开应用。");
        }
        catch (Exception error) when (error is IOException or ObjectDisposedException or InvalidOperationException) { }
    }
    private HttpRequestMessage Request(HttpMethod method, string path)
    {
        var request = new HttpRequestMessage(method, Origin + "/" + path);
        request.Headers.Add("Cookie", CookieName + "=" + Token);
        return request;
    }
    public async Task<JsonElement> CallAsync(string method, object data)
    {
        using var request = Request(HttpMethod.Post, "api/call");
        request.Content = new StringContent(JsonSerializer.Serialize(new { id = Guid.NewGuid().ToString(), method, data }), Encoding.UTF8, "application/json");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stopped.Token);
        timeout.CancelAfter(TimeSpan.FromSeconds(120));
        using var response = await client.SendAsync(request, timeout.Token);
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(timeout.Token));
        if (json.RootElement.TryGetProperty("error", out var error)) throw new IOException(error.GetString());
        return json.RootElement.GetProperty("result").Clone();
    }
    private async Task ReadEventsAsync()
    {
        while (!stopped.IsCancellationRequested)
        {
            try
            {
                using var request = Request(HttpMethod.Get, "api/state-events");
                using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, stopped.Token);
                response.EnsureSuccessStatusCode();
                using var reader = new StreamReader(await response.Content.ReadAsStreamAsync(stopped.Token));
                while (await reader.ReadLineAsync(stopped.Token) is { } line)
                    if (line.StartsWith("data: ", StringComparison.Ordinal)) StateChanged?.Invoke(line[6..]);
            }
            catch (OperationCanceledException) when (stopped.IsCancellationRequested) { return; }
            catch (Exception error) when (error is HttpRequestException or IOException) { }
            try { await Task.Delay(1000, stopped.Token); } catch (OperationCanceledException) { return; }
        }
    }
    public async Task ShutdownAsync()
    {
        if (process is not { HasExited: false }) return;
        using var request = Request(HttpMethod.Post, "shutdown");
        using var response = await client.SendAsync(request).WaitAsync(TimeSpan.FromSeconds(30));
        response.EnsureSuccessStatusCode();
        stopped.Cancel();
        process.StandardInput.Close();
        await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(10));
    }
    public void Dispose()
    {
        stopped.Cancel();
        if (process is { HasExited: false }) process.StandardInput.Close();
        process?.Dispose(); client.Dispose();
    }
}
