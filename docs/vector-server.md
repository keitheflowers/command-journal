# Connect your Vector home server

The Family Save can use your own AI server as Vector's brain instead of, or ahead of, Claude. Order of who answers:

1. **Your Vector home server** (when it's turned on in Settings)
2. **Claude** (if Vector AI is on and Vector can't be reached)
3. **The app's built-in rules** (offline)

Each answer shows which one replied ("🏠 Vector (home server)" or "✨ Claude"). Nothing changes until you say "confirm".

## Quick setup (Qwen through Ollama, LM Studio, llama.cpp or vLLM)

### 1. Your model server
It should answer OpenAI-style requests at `/v1/chat/completions`. All four do by default:

| Server | Default address | Model name to type in the app |
|---|---|---|
| Ollama | `http://127.0.0.1:11434` | as listed by `ollama list`, e.g. `qwen3.5` |
| LM Studio | `http://127.0.0.1:1234` | the model id shown in LM Studio |
| llama.cpp (`llama-server`) | `http://127.0.0.1:8080` | anything (it serves one model) |
| vLLM | `http://127.0.0.1:8000` | the `--served-model-name` |

### 2. The bridge (adds a key and lets the app in)
Phones can only call your server if it allows the app's address (CORS) and you don't want it open to anyone. `vector-bridge/server.js` (in this repo, no packages needed, Node 18+) does both. On the home server:

```
VECTOR_KEY=pick-a-long-secret UPSTREAM=http://127.0.0.1:11434 node vector-bridge/server.js
```

### 3. A secure address the phone can reach
The app runs from an `https://` address, so phones refuse plain `http://` servers. The easiest fix is **Tailscale** (free for personal use; works at home and away):

1. Install Tailscale on the home server and on your phone, and sign in to both with the same account.
2. On the server: `tailscale serve --bg 8787`
3. It prints an address like `https://vector.tailnet-name.ts.net`. That's your server address.

(A Cloudflare Tunnel pointing at `http://127.0.0.1:8787` works too and doesn't need an app on the phone. Add Cloudflare Access to keep it private.)

### 4. In the app
Settings → **🏠 Vector home server**:
- **Server address:** the `https://…ts.net` address
- **Server type:** OpenAI-compatible
- **Model:** e.g. `qwen3.5`
- **Key:** the `VECTOR_KEY` you picked

Tap **Save and turn on**, then **Test**. It should say "✓ Working… Vector says: …". The first answer can take a while as the model loads.

## What the app sends (OpenAI-compatible)
`POST {address}/v1/chat/completions` with `Authorization: Bearer {key}`:

```json
{
  "model": "qwen3.5",
  "temperature": 0.2,
  "stream": false,
  "messages": [
    {"role": "system", "content": "You are Vector… (rules) …Respond with ONLY one JSON object… matching this JSON Schema: {…}"},
    {"role": "user", "content": "CONTEXT:\n{…tasks, bills, budget, family…}\n\nREQUEST:\nadd call mom tomorrow"}
  ],
  "response_format": {"type": "json_schema", "json_schema": {"name": "vector_actions", "strict": true, "schema": {…}}}
}
```

If the server rejects `response_format`, the app retries with `{"type":"json_object"}`, then without it. It reads `choices[0].message.content`, ignores `<think>…</think>` reasoning and ``` fences, and expects:

```json
{"reply": "short spoken answer or empty",
 "actions": [{"kind": "add_task", "title": "Call mom", "date": "2026-11-13", "task_id": null, "...": null}]}
```

The full action list (tasks, money, bills, fitness, meals, fasting, savings goals, grocery items, workout plans and sessions) is in the schema the app sends. Every field not used by an action is `null`.

## Or: your own Vector API
If Vector is your own program (an agent with tools, memory and so on), pick **Server type: Vector API**. The app then sends one request straight to the address you enter:

`POST {address}` with `Authorization: Bearer {key}`:

```json
{"app": "family-save", "version": 1,
 "text": "add call mom tomorrow",
 "context": {"TODAY": "2026-11-12", "OPEN_TASKS": […], "BILLS": […], "PEOPLE": […], "…": "…"},
 "history": [{"role": "user", "text": "…"}, {"role": "vector", "text": "…"}],
 "system": "the same instructions Claude gets",
 "schema": {"…": "the JSON Schema for the answer"}}
```

Answer with the same `{"reply": "...", "actions": [...]}` JSON (or `{"content": "<that JSON as a string>"}`). Your server must send CORS headers allowing the app's address (`https://keitheflowers.github.io`, and `https://localhost` for the Android app) and answer `OPTIONS` requests.

## Privacy
With the home server on, your requests and the summary of your tasks, money and family go to **your** server only. Claude is only used if Vector can't be reached and Claude is turned on. Turn Claude off to keep everything at home.
