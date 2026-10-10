# API / MCP 部署

[English](api.md) · 简体中文

在一台机器上运行 yovoice，其他机器通过 HTTP 或 MCP 生成语音。客户端无需安装模型或桌面 App。

## 启动服务

[安装 CLI](cli_zh.md#安装)，保留可执行文件同级的 `tools/` 目录。在独立数据目录中准备引擎和模型：

```sh
yovoice setup --backend cpu --data-dir ./server-data
yovoice models download index-2.5-q8 --data-dir ./server-data
export YOVOICE_API_TOKEN="$(openssl rand -hex 32)"
yovoice serve --data-dir ./server-data --listen 0.0.0.0:8080 --generation-timeout 30m
```

GPU 选项见[引擎准备](cli_zh.md#准备引擎与模型)。将生成的 Token 保存到服务环境中，并安全提供给客户端。Token 至少 32 字符；PowerShell 使用 `$env:YOVOICE_API_TOKEN = '你的随机Token'` 代替 `export`。

默认地址为 `127.0.0.1:8080`，使用 `0.0.0.0` 才接受其他机器的连接。服务独占数据目录，安装更多模型前需先停止服务。Ctrl-C 或 SIGTERM 会停止服务并取消正在生成的任务。

在不可信网络中使用 HTTPS，可通过反向代理，也可直接配置证书：

```sh
yovoice serve --listen 0.0.0.0:8443 --data-dir ./server-data --tls-cert server.crt --tls-key server.key
```

## 连接 MCP 客户端

使用支持 Streamable HTTP 和自定义请求头的客户端，根据客户端要求调整配置格式：

```json
{
  "mcpServers": {
    "yovoice": {
      "type": "http",
      "url": "http://192.168.1.10:8080/mcp",
      "headers": {"Authorization": "Bearer 替换为服务端Token"}
    }
  }
}
```

替换地址和 Token，启用 TLS 时改用 `https://`。认证使用预先配置的 Token，不提供 OAuth 登录。

| 工具 | 用途 |
| --- | --- |
| `status` | 查看引擎和当前任务 |
| `list_models` | 查询已安装模型和可用参数 |
| `list_voices` | 查询已保存的参考音色 |
| `upload_voice` | 通过 `audio` 上传纯 Base64，可选 `name` |
| `submit_generation` | 提交 `requestId`、`text` 和可选 `settings` |
| `get_generation` | 按 `requestId` 查询任务 |
| `cancel_generation` | 按 `requestId` 请求取消 |
| `generate` | 兼容同步生成 |
| `render_score` | 提交 `score` 乐谱和可选 `title`，同步渲染编曲配乐，返回 `id`、`duration`、`downloadPath`；格式见[编曲](score_zh.md) |

长任务优先使用 `submit_generation`。提交前通过 `openssl rand -hex 16` 生成随机 ID 并保存：

```json
{
  "requestId": "6e08d9be21e74da38609b061f2c8547a",
  "text": "你好，欢迎收听。",
  "settings": {"modelId": "index-2.5-q8", "voiceId": "你的音色ID"}
}
```

每 2–5 秒调用 `get_generation`。当 `status` 为 `completed` 时，将返回的 `downloadPath` 拼接到服务地址，携带相同 Token 下载 WAV。工具结果不包含音频本体；较大的参考文件建议通过 HTTP 上传。

## HTTP 上传与生成

以下示例使用 macOS/Linux shell。所有接口都需要相同的认证请求头。

```sh
export YOVOICE_URL=http://192.168.1.10:8080
export YOVOICE_API_TOKEN='服务端Token'
curl --fail-with-body -H "Authorization: Bearer $YOVOICE_API_TOKEN" "$YOVOICE_URL/v1/models"
curl --fail-with-body -H "Authorization: Bearer $YOVOICE_API_TOKEN" -H 'Content-Type: application/octet-stream' --data-binary @reference.wav "$YOVOICE_URL/v1/voices?name=narrator"
```

参考音频需为 1–60 秒、不超过 20 MB，常见格式会自动转换。保存返回的音色 `id`，然后创建 `request.json`：

```json
{"text":"你好，欢迎收听。","modelId":"index-2.5-q8","voiceId":"你的音色ID"}
```

HTTP 的声音参数放在顶层，不使用 MCP 的 `settings` 包装。支持声音设计的模型可以不提供参考音频，见[模型选择](models_zh.md)。高级参数定义位于 `generationOptions`，通过 `modelOptions` 按模型族传入，例如 `{"qwen3_tts":{"temperature":0.7}}`。

```sh
REQUEST_ID=$(openssl rand -hex 16)
curl --fail-with-body --connect-timeout 10 --max-time 30 -X PUT -H "Authorization: Bearer $YOVOICE_API_TOKEN" -H 'Content-Type: application/json' --data-binary @request.json "$YOVOICE_URL/v1/jobs/$REQUEST_ID"
curl --fail-with-body -H "Authorization: Bearer $YOVOICE_API_TOKEN" "$YOVOICE_URL/v1/jobs/$REQUEST_ID"
```

轮询至完成后，用返回的音频 `id` 下载：

```sh
curl --fail -H "Authorization: Bearer $YOVOICE_API_TOKEN" "$YOVOICE_URL/v1/audio/音频ID" -o speech.wav
```

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/v1/status` | 引擎和任务状态 |
| GET | `/v1/models` | 模型与参数 |
| GET | `/v1/voices` | 已保存的参考音色 |
| POST | `/v1/voices?name=NAME` | 上传二进制音频 |
| PUT | `/v1/jobs/{requestId}` | 提交任务，重复请求返回相同任务 |
| GET | `/v1/jobs/{requestId}` | 查询任务 |
| DELETE | `/v1/jobs/{requestId}` | 请求取消，随后查询至终态 |
| POST | `/v1/generate` | 同步生成，返回 WAV，响应头包含 `X-Yovoice-Generation-ID` |
| GET | `/v1/audio/{id}` | 下载生成的 WAV |

## 重试与限制

- `requestId` 为随机的 32 位十六进制 ID。使用相同 ID 和参数重试可避免重复生成；同 ID 更换参数返回 409。
- 状态包括 `running`、`completed`、`failed`、`cancelled`、`timed_out`。失败、取消或超时会附带 `error`。终态任务不再执行；需要重新生成时才使用新 ID。
- 服务一次处理一个上传或生成任务，不排队；繁忙时返回 409。
- 最近 100 条任务记录保存在内存中。重启会丢失任务状态和去重记录，中断的任务不会恢复；已完成的音频仍保留。查询返回 404 时，先确认是否重启或记录过期，再决定是否重新提交。
- 客户端断线不取消异步任务。需要停止时使用取消工具或 DELETE 接口。
- 参数错误返回 400，认证失败 401，上传超限 413，生成失败 500，同步生成超时 504。

Token 可访问整个服务及其音色和音频，不区分用户或配额。不支持浏览器跨域调用。各模型仍须遵循其使用协议。

## 超时与反向代理

生成默认最多运行 30 分钟，包含模型加载，可通过 `--generation-timeout 45m` 等正数时长调整。请求头读取限制为 10 秒，正文读取限制为 90 秒。空闲 HTTP 连接在 60 秒后关闭，这不是生成任务的时限。

异步 MCP 调用可先设置连接超时 10 秒、工具超时至少 30 秒，上传时按网络速度延长。不同客户端的配置字段不同。同步调用的客户端和代理超时应大于生成时限；旧版 MCP 协议在断线后不一定取消同步生成，建议使用异步任务。

下面的 Nginx 配置放在已有 HTTPS 服务中，yovoice 在本机监听 8080 端口：

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Authorization $http_authorization;
    proxy_connect_timeout 10s;
    proxy_send_timeout 90s;
    proxy_read_timeout 35m;
    proxy_buffering off;
    proxy_next_upstream off;
    client_max_body_size 28m;
}
```

35 分钟用于覆盖默认同步生成时限。仅使用异步任务时可改为 `120s`，并按上传及转换耗时调整。不要由代理自动重试生成请求。
