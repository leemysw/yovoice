# AI service

**English** | [简体中文](ai_zh.md)

yovoice can optionally connect to a large language model. With an AI service set up, **AI compose** writes an arrangement in a Score project and **AI lyrics** fills in the style, lyrics and title of a Music project. Everything else works without it.

## Set up a service

Open Settings › AI and add a service:

| Service | Address | Key |
| --- | --- | --- |
| DeepSeek, Qwen (Bailian), GLM, Kimi, Doubao (Ark), MiniMax, OpenAI, Anthropic, OpenRouter | Built in | Required; **Get a key** opens the provider's console |
| Ollama, LM Studio | Defaults to this computer (`127.0.0.1`), editable | Usually not needed |
| Custom | Any compatible address | Optional |

A custom service chooses one of three protocols: OpenAI Chat Completions, OpenAI Responses or Anthropic Messages, plus the path of its model list (for example `/models`; leave it empty if the service has none and type the model name).

Then **Fetch models** or type a model name, and **Test** sends a short message to check the address, key and model. The first service you add is used; with several, choose **Use** on the one you want.

## Where data goes

- Requests go straight from this computer to the service you chose, through the proxy set in Settings › General. Local addresses skip the proxy.
- Keys are stored in `secrets.json` in the data folder with owner-only permissions (`0600`), separate from projects and `state.json`. The settings page only shows a masked key. Deleting a service removes its key.
- What is sent is the request you type plus a fixed instruction describing the score or lyrics format. Error messages are cleaned of keys before they are shown or logged.

## AI compose

In a Score project, **AI compose** asks for a description and a length (10–600 seconds). The model replies with a score in the [score format](score.md#format); yovoice checks it and, if something is wrong (for example a note outside its bar), sends the problem back once for the model to fix. The result replaces the current arrangement, so you can then adjust tracks and render as usual. Larger models give noticeably better arrangements; small local models may fail the check.

## AI lyrics

In a Music project, **AI lyrics** asks for a theme and fills in the style description, lyrics with section markers and the singing language. With Instrumental on, it writes only the style. The title is replaced only while it is still the default.

## Limits

- One AI request runs at a time and can be cancelled; a request stops after 4 minutes.
- The browser preview can edit the service list but does not call models.
- AI features have not been verified against every listed provider; if a service rejects a request, the error shows its HTTP status and message.
