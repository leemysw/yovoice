# API / MCP deployment

English · [简体中文](api_zh.md)

Run yovoice on one machine and generate speech from other machines through HTTP or MCP. Clients do not need local models or the desktop app.

## Start the server

[Install the CLI](cli.md#installation), keeping `tools/` beside the executable. Prepare an engine and model in a dedicated data directory:

```sh
yovoice setup --backend cpu --data-dir ./server-data
yovoice models download index-2.5-q8 --data-dir ./server-data
export YOVOICE_API_TOKEN="$(openssl rand -hex 32)"
yovoice serve --data-dir ./server-data --listen 0.0.0.0:8080 --generation-timeout 30m
```

See [engine setup](cli.md#set-up-an-engine-and-model) for GPU options. Save the generated token in your service environment and provide it securely to clients. It must be at least 32 characters. In PowerShell, set `$env:YOVOICE_API_TOKEN = 'your-random-token'` instead of `export`.

The default address is `127.0.0.1:8080`. Use `0.0.0.0` to accept connections from other machines. The server exclusively uses its data directory; stop it before installing more models. Ctrl-C or SIGTERM stops the service and cancels active generation.

Use HTTPS outside a trusted network, through a reverse proxy or directly:

```sh
yovoice serve --listen 0.0.0.0:8443 --data-dir ./server-data --tls-cert server.crt --tls-key server.key
```

## Connect an MCP client

Use a client that supports Streamable HTTP and custom headers. Adapt the configuration format to your client:

```json
{
  "mcpServers": {
    "yovoice": {
      "type": "http",
      "url": "http://192.168.1.10:8080/mcp",
      "headers": {"Authorization": "Bearer YOUR_SERVER_TOKEN"}
    }
  }
}
```

Change the address and token, and use `https://` when TLS is enabled. Authentication uses a preconfigured token, not an OAuth login.

| Tool | Purpose |
| --- | --- |
| `status` | Check the engine and current activity |
| `list_models` | List installed models and available parameters |
| `list_voices` | List saved reference voices |
| `upload_voice` | Upload raw Base64 in `audio`, with an optional `name` |
| `submit_generation` | Submit `requestId`, `text`, and optional `settings` |
| `get_generation` | Query a task by `requestId` |
| `cancel_generation` | Request cancellation by `requestId` |
| `generate` | Synchronous generation for compatible clients |
| `render_score` | Render a `score` (with optional `title`) to a mixed WAV synchronously; returns `id`, `duration`, `downloadPath`. See [Score](score.md) for the format |

Prefer `submit_generation` for long-running tasks. Generate a random ID with `openssl rand -hex 16` and save it before submitting:

```json
{
  "requestId": "6e08d9be21e74da38609b061f2c8547a",
  "text": "Hello, welcome.",
  "settings": {"modelId": "index-2.5-q8", "voiceId": "YOUR_VOICE_ID"}
}
```

Call `get_generation` every 2–5 seconds. When `status` is `completed`, use the returned `downloadPath` to download the WAV from the server with the same Bearer token. Audio is not included in the tool response. For large reference files, use HTTP upload instead of Base64.

## HTTP upload and generation

The examples below use a macOS/Linux shell. All endpoints require the same authentication header.

```sh
export YOVOICE_URL=http://192.168.1.10:8080
export YOVOICE_API_TOKEN='YOUR_SERVER_TOKEN'
curl --fail-with-body -H "Authorization: Bearer $YOVOICE_API_TOKEN" "$YOVOICE_URL/v1/models"
curl --fail-with-body -H "Authorization: Bearer $YOVOICE_API_TOKEN" -H 'Content-Type: application/octet-stream' --data-binary @reference.wav "$YOVOICE_URL/v1/voices?name=narrator"
```

Reference audio must be 1–60 seconds and no larger than 20 MB. Common formats are converted automatically. Save the returned voice `id`, then create `request.json`:

```json
{"text":"Hello, welcome.","modelId":"index-2.5-q8","voiceId":"YOUR_VOICE_ID"}
```

Unlike MCP, HTTP uses top-level voice settings. For models that support voice design, reference audio is optional; see [model selection](models.md). Available advanced parameters are returned in `generationOptions`; group `modelOptions` by model family, for example `{"qwen3_tts":{"temperature":0.7}}`.

```sh
REQUEST_ID=$(openssl rand -hex 16)
curl --fail-with-body --connect-timeout 10 --max-time 30 -X PUT -H "Authorization: Bearer $YOVOICE_API_TOKEN" -H 'Content-Type: application/json' --data-binary @request.json "$YOVOICE_URL/v1/jobs/$REQUEST_ID"
curl --fail-with-body -H "Authorization: Bearer $YOVOICE_API_TOKEN" "$YOVOICE_URL/v1/jobs/$REQUEST_ID"
```

Poll until completion, then download using the returned audio `id`:

```sh
curl --fail -H "Authorization: Bearer $YOVOICE_API_TOKEN" "$YOVOICE_URL/v1/audio/AUDIO_ID" -o speech.wav
```

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v1/status` | Engine and activity status |
| GET | `/v1/models` | Models and parameters |
| GET | `/v1/voices` | Saved reference voices |
| POST | `/v1/voices?name=NAME` | Upload binary audio |
| PUT | `/v1/jobs/{requestId}` | Submit or retrieve an identical existing task |
| GET | `/v1/jobs/{requestId}` | Query a task |
| DELETE | `/v1/jobs/{requestId}` | Request cancellation; poll until a terminal state |
| POST | `/v1/generate` | Synchronous generation; returns WAV with an `X-Yovoice-Generation-ID` header |
| GET | `/v1/audio/{id}` | Download generated WAV |

## Retries and limits

- `requestId` is a random 32-character hexadecimal ID. Retry with the same ID and parameters to avoid duplicate generation. Reusing an ID with different parameters returns 409.
- States are `running`, `completed`, `failed`, `cancelled`, and `timed_out`. Failed, cancelled, or timed-out tasks include an `error`. A terminal task does not run again; use a new ID only when you intend a new generation.
- Only one upload or generation runs at a time. Busy requests return 409; no queue is maintained.
- The latest 100 task records are kept in memory. Restarting loses task status and deduplication records, and interrupted tasks do not resume. Completed audio remains saved. If a task returns 404, check for a restart or an expired record before resubmitting.
- Asynchronous tasks survive client disconnection. Use the cancel tool or DELETE endpoint to stop one.
- Invalid parameters return 400, invalid credentials 401, oversized uploads 413, generation failures 500, and synchronous generation timeouts 504.

The token grants access to the whole service, including its saved voices and audio. There are no per-user accounts or quotas. Browser cross-origin calls are not supported. Each model's license still applies.

## Timeouts and reverse proxies

Generation defaults to a 30-minute limit, including model loading. Set a positive duration with `--generation-timeout 45m` to change it. Requests have a 10-second header limit and a 90-second body-read limit. Idle HTTP connections close after 60 seconds; this is not a generation deadline.

For asynchronous MCP calls, a 10-second connection timeout and at least a 30-second tool timeout are a useful starting point; allow longer for uploads. Client configuration keys vary. Synchronous calls need a client and proxy timeout longer than the generation limit. Older MCP protocols may not cancel synchronous generation when disconnected; use asynchronous tasks for predictable behavior.

Example Nginx location inside an existing HTTPS server, with yovoice listening locally on port 8080:

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

The 35-minute wait accommodates the default synchronous limit. For asynchronous-only use, `120s` can cover uploads and conversion; adjust for your network. Disable automatic proxy retries for generation requests.
