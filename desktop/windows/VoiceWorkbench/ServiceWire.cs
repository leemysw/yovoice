using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace VoiceWorkbench.Desktop;

// 发往本地 Go 服务的请求体。
public static class ServiceWire
{
    // 默认编码器把时间戳时区中的“+”写成 \u002B，Go 的 time.Time 不解析 JSON 转义，
    // 带 +08:00 等偏移的作品因此无法保存；本机服务请求无需 HTML 转义。
    private static readonly JsonSerializerOptions Options = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    public static string Request(string method, object data)
    {
        // WebView2 历史版本可能把时间字段中的 Unicode 转义再保留为字面量；
        // 只修正时间字段，避免改变用户正文里本来就想保存的反斜杠文本。
        object? wireData = data is JsonElement element ? Normalize(element) : data;
        return JsonSerializer.Serialize(new { id = Guid.NewGuid().ToString(), method, data = wireData }, Options);
    }

    private static JsonNode? Normalize(JsonElement value, string? property = null)
    {
        switch (value.ValueKind)
        {
            case JsonValueKind.Object:
                var obj = new JsonObject();
                foreach (var item in value.EnumerateObject()) obj[item.Name] = Normalize(item.Value, item.Name);
                return obj;
            case JsonValueKind.Array:
                var array = new JsonArray();
                foreach (var item in value.EnumerateArray()) array.Add(Normalize(item));
                return array;
            case JsonValueKind.String:
                string text = value.GetString() ?? "";
                if (property is "createdAt" or "updatedAt") text = DecodeUnicodeEscapes(text);
                return JsonValue.Create(text);
            default:
                return JsonNode.Parse(value.GetRawText());
        }
    }

    private static string DecodeUnicodeEscapes(string value)
    {
        if (!value.Contains("\\u", StringComparison.Ordinal)) return value;
        var result = new StringBuilder(value.Length);
        for (int i = 0; i < value.Length; i++)
        {
            if (value[i] == '\\')
            {
                int slashEnd = i;
                while (slashEnd + 1 < value.Length && value[slashEnd + 1] == '\\') slashEnd++;
                int escapeStart = slashEnd + 1;
                if (escapeStart + 4 < value.Length && value[escapeStart] == 'u' &&
                    int.TryParse(value.AsSpan(escapeStart + 1, 4), System.Globalization.NumberStyles.HexNumber, null, out int code))
                {
                    result.Append((char)code);
                    i = escapeStart + 4;
                    continue;
                }
            }
            result.Append(value[i]);
        }
        return result.ToString();
    }

    // WebView2 的 ExecuteScriptAsync 返回“JSON 编码后的脚本结果”。脚本返回对象时
    // 是对象 JSON，返回 JSON.stringify(...) 时则会再包一层字符串。统一解包，
    // 避免退出保存路径把时间戳中的 +08:00 当成字面量的 \\u002B 转发给 Go。
    public static JsonElement? ReadScriptResult(string raw)
    {
        using var envelope = JsonDocument.Parse(raw);
        if (envelope.RootElement.ValueKind == JsonValueKind.Null) return null;
        if (envelope.RootElement.ValueKind != JsonValueKind.String)
            return envelope.RootElement.Clone();
        string nested = envelope.RootElement.GetString() ?? "";
        if (nested.Length == 0 || nested == "null") return null;
        using var document = JsonDocument.Parse(nested);
        return document.RootElement.ValueKind == JsonValueKind.Null ? null : document.RootElement.Clone();
    }
}
