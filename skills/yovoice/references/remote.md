# 远程 API 与 MCP

使用用户指定的服务地址和凭证，推理发生在服务端。只调用远程服务时，不需要在客户端安装 yovoice、FFmpeg、引擎或模型。模型及音色 ID 均以该服务实际返回为准。

## 已连接的 MCP

通过客户端实际发现的工具调用，工具名前缀取决于 MCP 客户端：

1. `status` 检查服务，`list_models` 选择 `installed` 中的模型，`list_voices` 查询参考音色。`catalog` 中存在不代表已安装。
2. 新参考音频可通过 `upload_voice` 上传，参数为纯 Base64 的 `audio` 与可选 `name`，返回音色 `id`。大文件优先使用下方 HTTP 二进制上传，不把 Base64 展示给用户。
3. `generate` 接收 `text` 和可选 `settings`，例如：

```json
{
  "text": "你好，欢迎收听。",
  "settings": {
    "modelId": "index-2.5-q8",
    "voiceId": "所选服务返回的音色ID"
  }
}
```

`settings` 使用 API 参数名，不能把 CLI 的 `--model`、`--reference`、`--output` 等直接传入。模型输入要求见[模型能力参考](models.md)；高级参数可查询 `list_models` 返回的 `generationOptions`。服务只接受已上传的 `voiceId`，不接受客户端本地路径。

生成成功返回 `id`、`duration`、`downloadPath`。**这只是结果信息，还不是客户端音频文件。** 用服务地址加 `downloadPath` 下载 WAV，仍需相同的 Bearer Token；若 MCP 客户端没有向下载工具提供凭证，应使用用户已配置的环境变量或凭证机制。缺少下载权限时说明音频已在服务端生成，不宣称已保存到本机。

## 配置 MCP

服务端启动 `yovoice serve` 后，MCP 端点为 `/mcp`，传输方式是 Streamable HTTP。适用于支持此配置结构的客户端：

```json
{
  "mcpServers": {
    "yovoice": {
      "type": "http",
      "url": "http://服务器地址:8080/mcp",
      "headers": {
        "Authorization": "Bearer 服务端Token"
      }
    }
  }
}
```

根据用户所用客户端调整配置格式，复用其凭证存储方式。不要将真实 Token 写进输出、示例或提交到仓库。不支持远程 MCP 的客户端可直接调用 HTTP API。

## HTTP 调用与下载

假设环境已设置 `YOVOICE_URL`（不含 `/mcp`，例如 `http://192.168.1.10:8080`）和 `YOVOICE_API_TOKEN`。所有接口都带相同的认证头。

```sh
curl --fail-with-body -H "Authorization: Bearer $YOVOICE_API_TOKEN" "$YOVOICE_URL/v1/models"
curl --fail-with-body -H "Authorization: Bearer $YOVOICE_API_TOKEN" "$YOVOICE_URL/v1/voices"
curl --fail-with-body -H "Authorization: Bearer $YOVOICE_API_TOKEN" \
  -H 'Content-Type: application/octet-stream' \
  --data-binary @reference.wav "$YOVOICE_URL/v1/voices?name=narrator"
```

参考音频限制 20 MB、1–60 秒，常见格式在服务端转换。将返回的 `id` 作为 `voiceId`。生成请求 JSON 使用顶层声音参数（与 MCP 的 `settings` 包装不同），写到 `request.json`，避免正文 shell 转义问题：

```json
{"text":"你好，欢迎收听。","modelId":"index-2.5-q8","voiceId":"上传返回的ID"}
```

```sh
curl --fail -H "Authorization: Bearer $YOVOICE_API_TOKEN" \
  -H 'Content-Type: application/json' --data-binary @request.json \
  "$YOVOICE_URL/v1/generate" -o narration.wav
```

HTTP 生成直接返回完整 WAV；MCP 结果或已知生成 ID 使用下载接口，无需重新生成：

```sh
curl --fail -H "Authorization: Bearer $YOVOICE_API_TOKEN" \
  "$YOVOICE_URL/v1/audio/生成ID" -o narration.wav
```

写入前检查本地目标文件是否存在，已有文件使用新名字。只有请求成功且文件实际落盘后才交付本地路径或播放器；没有试听不宣称音质验证通过。

## 失败与部署

- 401：核对 Token；404：核对地址、生成 ID 和服务版本。不要因接口不可用就自行在客户端安装模型。
- HTTP 409 或 MCP 繁忙错误：已有任务正在处理，查询状态并稍后重试，不连续提交重复生成。
- 生成耗时包括模型首次加载。超时或连接断开时，不假定任务一定完成，也不无条件重发；已拿到生成 ID 时优先下载已有结果。
- 服务端模型缺失需要在服务端准备，API／MCP 不提供安装或任意路径导入工具。用户要求部署时，先阅读[引擎与模型参考](setup.md)，在目标服务器准备后设置至少 32 字符的 `YOVOICE_API_TOKEN`，运行 `yovoice serve --listen 0.0.0.0:8080 --data-dir DIR`。TLS 使用成对的 `--tls-cert`、`--tls-key`，或由反向代理提供 HTTPS。
