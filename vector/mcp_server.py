#!/usr/bin/env python3
"""Family Save as an MCP server (Model Context Protocol, stdio transport).

Any MCP-capable AI host can use the journal through this: LM Studio, Open
WebUI (via mcpo), Qwen-Agent, Claude Desktop, Cursor, Continue, Cline...
Standard library only. Add it to the host's MCP config as:

    {"mcpServers": {"family-save": {"command": "python3",
                                    "args": ["/full/path/to/command-journal/vector/mcp_server.py"]}}}

Sign in once first:  python3 vector/familysave.py login you@example.com
Logs go to stderr; stdout carries only protocol messages.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from familysave import VERSION, Client  # noqa: E402
from tools import call_text, mcp_tools  # noqa: E402

PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
INSTRUCTIONS = ("Tools for The Family Save, the family's journal app: tasks, morning/evening journal, money (bills, spending, budgets, "
                "savings), grocery list and health logs. Call today_overview first for a briefing. Amounts are dollars; dates are "
                "YYYY-MM-DD. Changes appear on the family's phones within about a minute.")


def log(*a):
    print('[family-save]', *a, file=sys.stderr, flush=True)


def send(msg):
    sys.stdout.write(json.dumps(msg, ensure_ascii=False) + '\n')
    sys.stdout.flush()


def reply(id_, result):
    send({'jsonrpc': '2.0', 'id': id_, 'result': result})


def fail(id_, code, message):
    send({'jsonrpc': '2.0', 'id': id_, 'error': {'code': code, 'message': message}})


def handle(msg, client):
    method, id_, params = msg.get('method'), msg.get('id'), msg.get('params') or {}
    is_request = 'id' in msg
    if method == 'initialize':
        want = params.get('protocolVersion')
        reply(id_, {'protocolVersion': want if want in PROTOCOLS else PROTOCOLS[0],
                    'capabilities': {'tools': {'listChanged': False}},
                    'serverInfo': {'name': 'family-save', 'version': VERSION},
                    'instructions': INSTRUCTIONS})
    elif method == 'ping':
        reply(id_, {})
    elif method == 'tools/list':
        reply(id_, {'tools': mcp_tools()})
    elif method == 'tools/call':
        name, args = params.get('name'), params.get('arguments') or {}
        text, is_err = call_text(name, args, client)
        reply(id_, {'content': [{'type': 'text', 'text': text}], 'isError': is_err})
    elif method in ('resources/list', 'resources/templates/list'):
        reply(id_, {'resources': []} if method == 'resources/list' else {'resourceTemplates': []})
    elif method == 'prompts/list':
        reply(id_, {'prompts': []})
    elif method and method.startswith('notifications/'):
        pass  # initialized, cancelled, ...: nothing to do
    elif is_request:
        fail(id_, -32601, 'Method not found: %s' % method)


def main():
    client = Client()
    if not client.signed_in():
        log('not signed in yet: run  python3 vector/familysave.py login you@example.com  (tools will report this too)')
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            fail(None, -32700, 'Parse error')
            continue
        if isinstance(msg, list):  # batch
            for m in msg:
                handle(m, client)
            continue
        try:
            handle(msg, client)
        except Exception as e:  # never die on one bad request
            log('error:', e)
            if 'id' in msg:
                fail(msg.get('id'), -32603, str(e))


if __name__ == '__main__':
    main()
