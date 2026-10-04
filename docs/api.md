# API / MCP 部署与调用

在性能较好的机器运行 `yovoice serve`，其他机器通过 HTTP 上传参考音频和生成语音，无需在客户端安装模型、引擎或桌面 App。同一个服务同时提供 HTTP API 与 MCP Streamable HTTP；普通客户端可使用 curl，Agent 可配置 `/mcp` 端点。

## 服务端准备

从 [GitHub Releases](https://github.com/leemysw/yovoice/releases) 下载对应平台的独立 CLI 压缩包，安装步骤见 [CLI 指南](cli.md#安装)。使用包含 `serve` 命令的版本，完整保留同级 `tools/` 目录。先在服务端准备引擎和模型，所有命令使用同一数据目录：

```sh
yovoice setup --backend cpu --data-dir ./server-data
yovoice models download index-2.5-q8 --data-dir ./server-data
```

Apple Silicon 可改用 `metal`，NVIDIA 机器可选 `cuda`。更多模型见[模型参考](../skills/yovoice/references/models.md)。启动后独占该数据目录；需要安装新模型时先停止服务，再执行 CLI 管理命令。

```sh
export YOVOICE_API_TOKEN="$(openssl rand -hex 32)"
yovoice serve --data-dir ./server-data --listen 0.0.0.0:8080
```

默认监听 `127.0.0.1:8080`；显式使用 `0.0.0.0` 才监听所有 IPv4 网卡。Token 至少 32 字符，通过服务环境保存并安全提供给客户端，不写进 URL 或日志。Windows PowerShell 使用 `$env:YOVOICE_API_TOKEN = '你的随机Token'` 设置环境变量。

跨不可信网络使用 HTTPS，可配置反向代理，或直接提供证书：

```sh
yovoice serve --listen 0.0.0.0:8443 --data-dir ./server-data \
  --tls-cert server.crt --tls-key server.key
```

服务持续运行，不因标准输入关闭而退出，使用 Ctrl-C / SIGTERM 停止。可交给 systemd 等进程管理工具运行。推理时间较长时，反向代理需要调高响应等待超时。

## 客户端调用

以下示例在 macOS/Linux shell 执行，将地址换成服务端地址，并设置同一个 Token：

```sh
export YOVOICE_URL=http://192.168.1.10:8080
export YOVOICE_API_TOKEN='服务端的Token'

curl --fail-with-body -H "Authorization: Bearer $YOVOICE_API_TOKEN" \
  "$YOVOICE_URL/v1/models"
```

上传客户端的参考音频，返回 JSON 中的 `id` 用于后续 `voiceId`。支持 WAV、MP3、M4A 等已有转换器支持的格式，限制 20 MB、1–60 秒；无需填写服务端文件路径。

```sh
curl --fail-with-body -H "Authorization: Bearer $YOVOICE_API_TOKEN" \
  -H 'Content-Type: application/octet-stream' \
  --data-binary @reference.wav "$YOVOICE_URL/v1/voices?name=narrator"
```

将返回的音色 ID 填入请求，完整生成后返回 WAV：

```sh
curl --fail -H "Authorization: Bearer $YOVOICE_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"text":"你好，这是远程生成的语音。","modelId":"index-2.5-q8","voiceId":"上传返回的id"}' \
  "$YOVOICE_URL/v1/generate" -o speech.wav
```

服务端已准备声音设计模型时，也可以不上传参考音频，例如 VoxCPM2：

```json
{"text":"你好，欢迎收听。","modelId":"voxcpm2-q8","voxMode":"design","voiceDescription":"年轻女性，语气温柔自然"}
```

请求使用应用的声音参数命名，例如 `modelId`、`voiceId`、`voiceDescription`、`referenceText`、`speaker`、`speed`、`seed`；具体可用能力取决于模型。IndexTTS 默认 `mode` 为 `speaker`，文字情绪需显式设置 `mode: "text"` 和 `emotionText`。高级选项通过 `modelOptions` 按模型 ID 传入，选项定义可在 `/v1/models` 的 `generationOptions` 中查询。未知字段和非法 JSON 会返回 400。

## 接口

所有接口都需要 `Authorization: Bearer TOKEN`。

| 方法 | 路径 | 功能 |
| --- | --- | --- |
| GET | `/v1/status` | 引擎版本、是否已配置运行时及当前任务状态 |
| GET | `/v1/models` | 模型目录、已安装模型和高级选项定义 |
| GET | `/v1/voices` | 已保存的参考音色 |
| POST | `/v1/voices?name=NAME` | 原始二进制音频上传，返回音色 JSON |
| PUT | `/v1/jobs/{requestId}` | 提交异步生成；同 ID、同参数重试返回已有任务 |
| GET | `/v1/jobs/{requestId}` | 查询任务状态与结果 |
| DELETE | `/v1/jobs/{requestId}` | 请求取消任务，随后查询至终态 |
| POST | `/v1/generate` | JSON 生成请求，完成后返回 `audio/wav` |
| GET | `/v1/audio/{id}` | 按生成 ID 下载 WAV，同样需要认证 |

生成响应附带 `X-Yovoice-Generation-ID`，服务端保留生成历史与音频。同一服务一次处理一个上传或生成请求，其他写请求返回 409，客户端稍后重试；查询仍可进行。同步 HTTP 客户端断开生成连接会取消当前推理；异步任务独立运行。生成失败返回 500，参数错误返回 400，上传超限返回 413，认证失败返回 401。

API Token 代表对该推理服务及音色的完整访问权限，当前不区分用户和配额。服务不开放桌面 RPC、模型安装、任意本地文件读取或远程关机接口，也不开放浏览器跨域访问。模型仍遵循各自的使用许可证。

## MCP 客户端配置

启动 `yovoice serve` 后，MCP 端点为 `http://服务器地址:8080/mcp`，与 HTTP API 使用相同 Token 和 TLS 设置。使用支持 Streamable HTTP 及自定义请求头的 MCP 客户端，配置示例：

```json
{
  "mcpServers": {
    "yovoice": {
      "type": "http",
      "url": "http://192.168.1.10:8080/mcp",
      "headers": {
        "Authorization": "Bearer 替换为服务端Token"
      }
    }
  }
}
```

不同客户端的配置文件结构可能不同，但端点 URL 与认证请求头相同。使用 HTTPS 时同步修改 URL。这里采用预先配置的 Bearer Token，不提供浏览器 OAuth 登录。

连接后可发现以下工具：

| 工具 | 用途 |
| --- | --- |
| `status` | 查询引擎和当前任务 |
| `list_models` | 查询可用模型及参数 |
| `list_voices` | 查询参考音色 ID |
| `upload_voice` | 上传纯 Base64 音频，参数 `audio`、可选 `name` |
| `submit_generation` | 推荐：提交任务，参数 `requestId`、`text`、可选 `settings` |
| `get_generation` | 按 `requestId` 查询状态及下载路径 |
| `cancel_generation` | 按 `requestId` 请求取消 |
| `generate` | 兼容同步生成，参数 `text`、可选 `settings` |

`submit_generation` 参数示例（每个新任务生成一个随机 ID，例如 `openssl rand -hex 16`，重试保留原 ID）：

```json
{
  "requestId": "6e08d9be21e74da38609b061f2c8547a",
  "text": "你好，这是通过 MCP 生成的声音。",
  "settings": {
    "modelId": "index-2.5-q8",
    "voiceId": "上传返回的音色id"
  }
}
```

提交立即返回 `requestId` 和 `status`。每 2–5 秒用 `get_generation` 查询；`completed` 时返回 `id`、`duration` 和 `downloadPath`。使用服务端地址加 `downloadPath` 下载音频，请求仍须携带 Bearer Token；音频不会作为 Base64 放入生成结果，避免占用模型上下文。较大的参考音频也建议使用 HTTP 上传，再把返回的音色 ID 交给 Agent。

MCP 与 HTTP 共用单任务限制，不会并行启动两个推理任务。工具失败会返回 MCP 工具错误，Agent 可以据此调整参数或稍后重试。MCP 采用官方 Go SDK 的 Streamable HTTP 传输，不是旧版独立 SSE 端点；不支持远程 HTTP 的客户端需使用兼容客户端或 HTTP 调用方式。


## 长耗时任务与重试

推荐使用异步任务，提交和查询都是短请求。断开 MCP 会话、关闭客户端或代理超时不会取消已接受的异步任务。调用 `cancel_generation` 或 HTTP DELETE 可主动取消。

```sh
# 新任务只生成一次 ID；请求失败时保存此值，用相同 ID 和原始正文重试。
REQUEST_ID=$(openssl rand -hex 16)
curl --fail-with-body --connect-timeout 10 --max-time 30 \
  -X PUT -H "Authorization: Bearer $YOVOICE_API_TOKEN" \
  -H 'Content-Type: application/json' --data-binary @request.json \
  "$YOVOICE_URL/v1/jobs/$REQUEST_ID"

curl --fail-with-body --connect-timeout 10 --max-time 30 \
  -H "Authorization: Bearer $YOVOICE_API_TOKEN" \
  "$YOVOICE_URL/v1/jobs/$REQUEST_ID"

# 需要停止时执行；返回 running 表示取消尚在收尾，应继续查询。
curl --fail-with-body -X DELETE -H "Authorization: Bearer $YOVOICE_API_TOKEN" \
  "$YOVOICE_URL/v1/jobs/$REQUEST_ID"
```

`request.json` 使用上方同步生成的 JSON 参数。`requestId` 必须是 32 位十六进制随机 ID。相同 ID、相同有效参数返回已有任务；更改参数复用 ID 返回 409。状态为 `running`、`completed`、`failed`、`cancelled` 或 `timed_out`，后三种失败状态带 `error`。终态不再执行；确需重新生成时才使用新 ID。

服务仍一次处理一个上传或生成任务，不排队。仅在内存保留最近 100 个任务记录，重启会丢失任务状态及去重记录，运行中任务不会自动恢复；已完成音频仍保存在生成历史中。任务查询返回 404 时先确认是否重启或记录被淘汰，不自动换 ID 重发。已知音频 ID 可直接下载已有结果。

## 超时设置

```sh
yovoice serve --listen 0.0.0.0:8080 --data-dir ./server-data --generation-timeout 45m
```

| 范围 | 行为 |
| --- | --- |
| 请求头 | 10 秒读取限制 |
| 请求正文 / 上传 | 90 秒读取限制 |
| 空闲 HTTP 连接 | 60 秒，不是生成任务时限 |
| 单次生成 | 默认 30 分钟，含模型加载；`--generation-timeout` 设置正数时长 |
| MCP 提交与查询 | 建议客户端连接超时 10 秒、工具调用超时至少 30 秒；上传按网络速度适当增加 |
| 同步生成 | 客户端及代理等待时间应大于生成上限；到达服务端上限取消推理，HTTP 返回 504 |

不同 MCP 客户端的超时配置字段不同，按其配置说明设置，不把通用示例中的字段直接套用。同步 MCP 保留兼容，没有进度心跳；旧协议的断线不保证取消生成，但仍有服务端执行时限。异步任务在新旧协议上都不依赖连接持续存在，是默认推荐方式。

Nginx 示例，放在已有 HTTPS `server` 中；yovoice 在本机监听 `127.0.0.1:8080`。客户端必须携带 Token，代理原样转发：

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

`35m` 覆盖默认 30 分钟的兼容同步接口；只使用异步任务时可降为 `120s`，包含音频上传转换时间。不要由代理自动重试生成请求。TLS 证书、域名和服务进程自启动由部署环境配置。
