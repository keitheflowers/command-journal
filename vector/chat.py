#!/usr/bin/env python3
"""Vector: chat with a local model (Qwen through Ollama, LM Studio, vLLM...)
that can read and change the journal.

Works with any OpenAI-compatible chat endpoint that supports tool calling.
Standard library only.

    python3 vector/chat.py                       # Ollama at localhost:11434, model qwen3
    python3 vector/chat.py --model qwen2.5:14b
    python3 vector/chat.py --base-url http://localhost:1234/v1 --model qwen3   # LM Studio
    python3 vector/chat.py --once "Give me my morning briefing"                # for a scheduled check-in
    python3 vector/chat.py --once "Evening review: what got done, what rolls over?"

Environment: VECTOR_BASE_URL, VECTOR_MODEL, VECTOR_API_KEY (if the server wants one).
Sign in once first:  python3 vector/familysave.py login you@example.com
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from familysave import Client, FamilySaveError  # noqa: E402
from tools import call_text, openai_tools  # noqa: E402

SYSTEM = """You are Vector, the family's assistant. You have tools for The Family Save, the family journal app: tasks, a morning/evening journal, money (spending, bills, budgets, savings goals), the grocery list and health logs.
Today is {today} ({weekday}).
Rules:
- Use the tools for anything about the family's tasks, money, journal, groceries or health; never guess at data.
- Call today_overview first when asked for a briefing, check-in or "how am I doing".
- Only make changes the user actually asked for. Never invent tasks, amounts or dates. Dates are YYYY-MM-DD; "Friday" means the next Friday.
- When several tasks match, ask which one. Confirm what you changed in one short sentence.
- Answer in plain, short sentences. Dollars with two decimals."""


def post(base_url, api_key, body):
    req = urllib.request.Request(base_url.rstrip('/') + '/chat/completions', data=json.dumps(body).encode('utf-8'), method='POST',
                                 headers={'content-type': 'application/json', 'Authorization': 'Bearer ' + (api_key or 'local')})
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            return json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        raise SystemExit('The model server answered %d: %s' % (e.code, e.read().decode('utf-8', 'replace')[:500]))
    except (urllib.error.URLError, OSError) as e:
        raise SystemExit('Cannot reach the model server at %s (%s). Is Ollama / LM Studio running?' % (base_url, getattr(e, 'reason', e)))


def turn(messages, opts, client, tools):
    """One user turn: let the model call tools until it answers in words."""
    for _ in range(12):
        res = post(opts.base_url, opts.api_key, {'model': opts.model, 'messages': messages, 'tools': tools, 'temperature': 0.2})
        choice = (res.get('choices') or [{}])[0]
        msg = choice.get('message') or {}
        calls = msg.get('tool_calls') or []
        messages.append({'role': 'assistant', 'content': msg.get('content') or '', **({'tool_calls': calls} if calls else {})})
        if not calls:
            return msg.get('content') or ''
        for tc in calls:
            fn = tc.get('function') or {}
            name, raw = fn.get('name'), fn.get('arguments') or '{}'
            if opts.verbose:
                print('  ⚙ %s %s' % (name, raw if len(raw) < 200 else raw[:200] + '…'), file=sys.stderr)
            text, _ = call_text(name, raw, client)
            messages.append({'role': 'tool', 'tool_call_id': tc.get('id') or name, 'name': name, 'content': text})
    return 'I got stuck in a loop of tool calls. Try asking in a smaller step.'


def main():
    ap = argparse.ArgumentParser(description='Chat with Vector (a local model) about the family journal.')
    ap.add_argument('--base-url', default=os.environ.get('VECTOR_BASE_URL', 'http://localhost:11434/v1'))
    ap.add_argument('--model', default=os.environ.get('VECTOR_MODEL', 'qwen3'))
    ap.add_argument('--api-key', default=os.environ.get('VECTOR_API_KEY', ''))
    ap.add_argument('--once', metavar='MESSAGE', help='send one message, print the answer and exit (for scheduled check-ins)')
    ap.add_argument('--verbose', '-v', action='store_true', help='show tool calls')
    opts = ap.parse_args()

    client = Client()
    if not client.signed_in():
        raise SystemExit('Sign in to Family Save first:  python3 vector/familysave.py login you@example.com')
    try:
        if not client.household():
            raise SystemExit('This account is not in a family yet: in the app, Settings → Family sync → start or join a family.')
    except FamilySaveError as e:
        raise SystemExit(str(e))

    d = date.today()
    messages = [{'role': 'system', 'content': SYSTEM.format(today=d.isoformat(), weekday=d.strftime('%A'))}]
    tools = openai_tools()
    if opts.once:
        messages.append({'role': 'user', 'content': opts.once})
        print(turn(messages, opts, client, tools))
        return
    print('Vector is ready (model %s). Type a message, or "quit".' % opts.model)
    while True:
        try:
            text = input('\nyou › ').strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not text:
            continue
        if text.lower() in ('quit', 'exit', 'bye'):
            break
        messages.append({'role': 'user', 'content': text})
        print('\nVector › ' + turn(messages, opts, client, tools))
        if len(messages) > 60:  # keep the context small for local models
            messages = messages[:1] + messages[-40:]


if __name__ == '__main__':
    main()
