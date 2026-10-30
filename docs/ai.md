# AI service

**English** | [简体中文](ai_zh.md)

yovoice can optionally connect to a large language model. With an AI service set up, the **assistant panel** in the bottom-right corner chats about your work and acts on it: it creates works, writes arrangements and lyrics, edits text, assigns voices and starts generation, with every change applied in the app immediately. Everything else works without it.

## Set up a service

Open Settings › AI services. The left column lists added and available services; select one and fill it in on the right:

| Service | Address | Key |
| --- | --- | --- |
| Pay-as-you-go APIs: DeepSeek, Qwen (Bailian), GLM, Kimi, Doubao (Ark), MiniMax, OpenAI, Anthropic, OpenRouter, OrcaRouter | Built in | Required; **Get an API key from …** opens the provider's console |
| Coding plans: Kimi Code, GLM Coding Plan, Bailian Token Plan, MiniMax Token Plan, Volcengine Ark Coding Plan | Built in (the plan's own address) | Required; use the plan's key, not a pay-as-you-go API key |
| Ollama, LM Studio | Defaults to this computer (`127.0.0.1`), editable | Usually not needed |
| ChatGPT (Codex) | The Codex CLI on this computer | None; sign in with ChatGPT through Codex |
| Custom | Any compatible address | Optional |

OrcaRouter has free models and needs no key to copy: click **Connect OrcaRouter for free** (on the OrcaRouter page in settings), sign in to OrcaRouter in your browser and approve. yovoice receives the key on this computer (`127.0.0.1`), adds the service with the free model `orcarouter/free` and uses it right away. Free models can be rate limited at busy times; wait a minute and retry, or pick another model.

**ChatGPT (Codex)** uses your ChatGPT plan through the official [Codex CLI](https://github.com/openai/codex) (`npm i -g @openai/codex` or `brew install codex`). Settings shows whether Codex is installed and signed in; **Sign in with ChatGPT** runs `codex login`, which finishes in your browser, then select **Check**. yovoice never reads or stores your sign-in. Each request runs `codex exec` in an empty temporary folder with a read-only sandbox and ignores your `~/.codex/config.toml`, so models, MCP servers and hooks you set up for coding don't apply. Saving the service loads Codex's model list and picks the first model. Requests take several seconds longer than an API call and count toward your plan's usage limits.

A custom service chooses one of three protocols: OpenAI Chat Completions, OpenAI Responses or Anthropic Messages, plus the path of its model list (for example `/models`; leave it empty if the service has none and type the model name).

Type a model name, or **Sync model list** and pick one. After **Add service** or **Save changes**, **Test** sends a short message to check the address, key and model. The first service you add is used and marked **In use** in the list; with several, switch service and model from the model menu at the bottom left of the compose and lyrics bars. A saved key shows only as a mask; **Replace key** or **Clear key** changes it.

## Where data goes

- Requests go straight from this computer to the service you chose, through the proxy set in Settings › General; without a configured proxy the system proxy is used. Local addresses skip the proxy.
- Keys are stored in a private table of the data folder's database (`yovoice.db`, owner-only permissions `0600`). They are never included in the state sent to the interface. The settings page only shows a masked key. Deleting a service removes its key.
- What is sent is the request you type plus a fixed instruction describing the score or lyrics format. Error messages are cleaned of keys before they are shown or logged.

## Assistant panel

Open the panel with the **Ocho** button at the bottom right, the assistant button in the title bar, or **⌘J / Ctrl+J**. It floats at the bottom right, and stays floating when enlarged. Type what you want — “create a score work and write a four-bar piano melody”, “assign a voice to each character in this story”, “generate the narration” — and the assistant does it in the app: works are created and opened, editors update as it writes, and generation starts through the same commands the app uses. Replies stream in as they are written; the thinking and each step sit in a one-line process above the reply that stays open while running and collapses when done. Generated audio can be played right there and replies can be copied. Messages sent while a turn is running are queued. Click the panel title to switch between sessions you can create, switch between and delete — each session keeps its own context, up to 50 sessions of 200 messages.

Each message carries where you are: the page, the open work, the text or line you selected, the playhead, whether the work's model is installed, the last generation's result or error code, and your remembered preferences, so the assistant acts on the right target. Selected text appears as a quote above the input; click × to leave it out. The assistant knows each model, where every page and setting lives and how to fix each error code, and can check installed models, the inference engine, running tasks and recent (sanitized) error logs.

Deleting works, takes or voices, downloading models or the engine, cleaning up storage and switching the compute device or download source are only proposed: a confirmation card appears in the chat and nothing happens until you confirm, after which the app runs the same action as its own buttons. Import and export stay in your hands. Lasting preferences you mention (favourite voice, style, pace) are remembered for later conversations and can be reviewed or deleted in Settings › Ocho. When a generation finishes or fails, or a model download ends, the assistant offers a suggestion in the corner that hands the task to it in one click; turn these tips off in Settings › Ocho.

The assistant process only gets yovoice's own tools and its bundled knowledge (Skills). It cannot run commands, read or write files or browse the web, and ocho's auto memory and sub-agents are turned off.

## AI compose, lyrics and melody scores

All AI writing goes through the assistant; editors no longer have a separate writing bar. Open the assistant in a Score or Music project and describe what you want: it reads the work and writes the arrangement (validated like a hand-written one, with self-correction), the style, lyrics and title, or a YuE2 melody score (validated against YuE2's ABC dialect, fixed bar by bar on errors), and applies it to the work directly — ask for changes in the panel to keep revising. Larger models give noticeably better arrangements; small local models may fail the check.

## Limits

- One conversation turn runs at a time and can be stopped; a turn stops after 10 minutes by default, adjustable in settings. Sessions survive restarts.
- The browser preview simulates the conversation; real model calls need the desktop app.
- AI features have not been verified against every listed provider; if a service rejects a request, the error shows its HTTP status and message.
