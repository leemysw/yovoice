using System.Diagnostics;
using System.IO;
using System.Text.Json;

namespace VoiceWorkbench.Desktop;

public static class HostLog
{
    private static readonly object gate = new();

    // 与服务日志分开，避免原生退出或通信错误在服务不可用时丢失。
    public static void Write(string root, string stage, Exception? error = null)
    {
        lock (gate)
        {
            try
            {
                string folder = Path.Combine(root, "logs");
                Directory.CreateDirectory(folder);
                string path = Path.Combine(folder, "host.log");
                if (File.Exists(path) && new FileInfo(path).Length >= 5 * 1024 * 1024) File.Move(path, path + ".1", true);
                File.AppendAllText(path, JsonSerializer.Serialize(new { time = DateTimeOffset.Now, stage, error = error?.ToString() }) + Environment.NewLine);
            }
            catch (Exception failure) when (failure is IOException or UnauthorizedAccessException) { Debug.WriteLine(failure); }
        }
    }
}
