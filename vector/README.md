# Connect Vector (your own AI) to the journal

This folder lets an AI that runs on **your computer** (Qwen through Ollama, LM Studio, vLLM, Qwen-Agent, Open WebUI...) read and change the family journal: tasks, the morning/evening journal, money (spending, bills, budgets, savings goals), the grocery list and health logs.

It works through the family's sync server (Supabase), the same one the phones use. Anything Vector writes shows up on every phone within about a minute, and everything the phones change is visible to Vector. Vector's actions go into the same activity log as everyone else's, marked "Vector:".

Standard-library Python 3.9+ only. No packages to install.

## 1. One-time setup

You need Family sync turned on (see `../supabase/README.md`: a free Supabase project, about 15 minutes). On a phone, sign in and start a family. Then on the computer, from the repo folder:

```bash
python3 vector/familysave.py setup --url https://abcd1234.supabase.co --anon-key eyJhbGciOi...
```

```bash
python3 vector/familysave.py login you@example.com
```

Use the same email and password as in the app. The URL and anon key are the ones in `config.js` (Supabase → Project Settings → API). The sign-in is kept in `~/.familysave/` (only the session tokens, never the password). Check it with:

```bash
python3 vector/familysave.py today
```

## 2. Connect your AI

### Option A: MCP server (LM Studio, Qwen-Agent, Open WebUI, Claude Desktop, Cursor...)

`vector/mcp_server.py` is a Model Context Protocol server over stdio. Add it to your AI host's MCP settings:

```json
{
  "mcpServers": {
    "family-save": {
      "command": "python3",
      "args": ["/full/path/to/command-journal/vector/mcp_server.py"]
    }
  }
}
```

- **LM Studio:** Program → Install → Edit `mcp.json`, paste the block above.
- **Qwen-Agent:** pass the same `mcpServers` object in the agent's `function_list`.
- **Open WebUI:** run it through `mcpo` (`uvx mcpo --port 8000 -- python3 vector/mcp_server.py`) and add `http://localhost:8000` as a tool server.

The server then offers 22 tools (`today_overview`, `add_task`, `complete_task`, `log_transaction`, `mark_bill_paid`, `add_journal_entry`, `grocery_list`, `log_health`...). Ask the model for a briefing and it will call `today_overview`.

### Option B: function calling in your own code (Ollama, LM Studio, vLLM, any OpenAI-compatible server)

`vector/chat.py` is a complete, small example: a chat loop that sends the tool definitions with each request and runs the tools the model asks for.

```bash
python3 vector/chat.py --model qwen3                     # Ollama at localhost:11434
```

```bash
python3 vector/chat.py --base-url http://localhost:1234/v1 --model qwen3   # LM Studio
```

For your own build, import the two pieces it uses:

```python
import sys; sys.path.insert(0, 'vector')
from tools import openai_tools, call_text   # tool schemas + "run this tool"
tools = openai_tools()                      # pass as "tools" to /v1/chat/completions
text, is_error = call_text(name, arguments_json)   # when the model returns a tool_call
```

`python3 vector/familysave.py tools` prints the same definitions as JSON if your stack is not Python.

### Option C: scheduled check-ins

`chat.py --once` sends one message and prints the answer, so a cron job (or Task Scheduler) can run the 6 AM and 10 PM check-ins locally:

```bash
python3 vector/chat.py --once "Morning check-in: give me today's briefing and ask what my top objective is."
```

```bash
python3 vector/chat.py --once "Evening review: what got done today, what rolls over, and anything due tomorrow?"
```

### Option D: plain commands

Everything is also a command, handy for scripts and for testing:

```bash
python3 vector/familysave.py add "Call the plumber" --date 2026-11-13 --priority High
python3 vector/familysave.py done plumber
python3 vector/familysave.py spent 42.50 "Kroger" --who Sam
python3 vector/familysave.py paid electric
python3 vector/familysave.py buy bananas milk "chicken thighs"
python3 vector/familysave.py morning "Ship the bridge" --plan "Tests first"
python3 vector/familysave.py evening --wins "Bridge works" --tomorrow "Write docs" --carry
python3 vector/familysave.py money --month 2026-11
python3 vector/familysave.py log weight --value 181.2 --who Keith
```

`python3 vector/familysave.py --help` lists them all. Output is JSON.

## How it fits the app

- **Same contract as the phones.** Records are written in exactly the shapes the app uses (`index.html`, `finance.js`, `grocery.js`, `fitness.js`...), so a task made by Vector is indistinguishable from one typed on a phone. The tests check those field sets.
- **Audited.** Every change adds an entry to the activity log (`events`) starting with "Vector:", and Supabase stamps the row with the signed-in user and server time.
- **Conflicts.** If a phone changed the same item and hasn't synced yet, the phone's change wins (the app's rule). Different items never conflict.
- **No AI provider in the journal.** The app doesn't know or care which model Vector is; it only sees records. Swap Qwen for anything else without touching the app.
- **Security.** The anon key is public by design; row-level security on the server means Vector can only see its own family's data, and only while signed in as a family member. Keep `~/.familysave/session.json` private (it is created with owner-only permissions).

## Tests

```bash
python3 -m unittest discover -s vector -p 'test_*.py'   # the bridge, against a fake family server
npm test -- vector                                       # a real phone and the bridge sharing one server
```
