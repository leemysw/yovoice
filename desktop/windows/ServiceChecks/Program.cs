using System.Text.Json;
using VoiceWorkbench.Desktop;

static void Require(bool value) { if (!value) throw new Exception("保存与错误协议检查失败。"); }
ServiceCallException failure;
using (var document = JsonDocument.Parse("""{"code":"@yovoice.error.unknown","params":{"detail":"磁盘已满"}}""")) failure = new ServiceCallException(document.RootElement);
Require(failure.Message.Contains("磁盘已满"));
// 原文在文档释放后仍可序列化，前端能继续读取 code 和 params。
Require(JsonSerializer.Serialize(new { error = failure.Wire }).Contains("params"));
foreach (var json in new[] { "\"旧版错误\"", "{}", "42", "null", """{"code":"@yovoice.timeline.invalid"}""" })
{
    using var document = JsonDocument.Parse(json);
    Require(new ServiceCallException(document.RootElement).Message.Length > 0);
}
// 界面转发的作品带本地时区时间戳，“+08:00”须原样送达 Go 服务，否则保存失败（#25）。
using (var page = JsonDocument.Parse("""{"id":"test","title":"清晨","createdAt":"2026-10-10T11:17:28.2505085+08:00"}"""))
{
    string body = ServiceWire.Request("draft.save", page.RootElement);
    Require(body.Contains("+08:00") && !body.Contains("\\u") && JsonDocument.Parse(body).RootElement.GetProperty("data").GetProperty("title").GetString() == "清晨");
}
string folder = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(folder);
try
{
    HostLog.Write(folder, "exit.save_failed", failure);
    string log = Path.Combine(folder, "logs", "host.log");
    Require(File.ReadAllText(log).Contains("exit.save_failed"));
    File.WriteAllText(log, new string('x', 5 * 1024 * 1024));
    HostLog.Write(folder, "exit.backup_completed");
    Require(File.Exists(log + ".1") && File.ReadAllText(log).Contains("exit.backup_completed"));
    HostLog.Write(log, "不可写日志不影响业务");
    string path = Path.Combine(folder, "恢复.json");
    const string draft = """{"id":"test","text":"尚未保存的台词","timeline":{"tracks":[]}}""";
    DraftRecovery.Save(path, draft);
    Require(File.ReadAllText(path) == draft);
    try { DraftRecovery.Save(path, "null"); throw new Exception("不应覆盖有效备份。"); } catch (IOException) { }
    Require(File.ReadAllText(path) == draft && Directory.GetFiles(folder).Length == 1);
    try { DraftRecovery.Save(Path.Combine(folder, "missing", "backup.json"), draft); throw new Exception("备份失败必须阻止退出。"); } catch (IOException) { }
}
finally { Directory.Delete(folder, true); }
Console.WriteLine("请求时间戳保真、结构化错误保真、错误提示、恢复备份和备份失败保护检查通过。");
