using System.Text.Encodings.Web;
using System.Text.Json;

namespace VoiceWorkbench.Desktop;

// 发往本地 Go 服务的请求体。
public static class ServiceWire
{
    // 默认编码器把时间戳时区中的“+”写成 \u002B，Go 的 time.Time 不解析 JSON 转义，
    // 带 +08:00 等偏移的作品因此无法保存；本机服务请求无需 HTML 转义。
    private static readonly JsonSerializerOptions Options = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    public static string Request(string method, object data) => JsonSerializer.Serialize(new { id = Guid.NewGuid().ToString(), method, data }, Options);
}
