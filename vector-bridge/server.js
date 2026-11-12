#!/usr/bin/env node
// Vector bridge for The Family Save. Runs on your home server next to your
// model server (Ollama, LM Studio, llama.cpp, vLLM). It:
//   - only lets in requests carrying your key,
//   - adds the CORS headers phones need to talk to it from the app,
//   - forwards /v1/... (OpenAI-compatible) to your model server.
// No packages needed: Node 18+ only.
//
//   VECTOR_KEY=pick-a-long-secret node server.js
//
// Settings (environment variables):
//   VECTOR_KEY     required. Paste the same value into the app's "Key" box.
//   UPSTREAM       model server, default http://127.0.0.1:11434 (Ollama).
//                  LM Studio: http://127.0.0.1:1234  llama.cpp: http://127.0.0.1:8080
//   PORT           default 8787
//   ALLOW_ORIGINS  default https://keitheflowers.github.io,https://localhost
//                  (the website and the Android app)
const http = require('http');

const KEY = process.env.VECTOR_KEY;
const UPSTREAM = (process.env.UPSTREAM || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const PORT = +(process.env.PORT || 8787);
const ORIGINS = (process.env.ALLOW_ORIGINS || 'https://keitheflowers.github.io,https://localhost').split(',').map(s => s.trim()).filter(Boolean);
if (!KEY || KEY.length < 12) { console.error('Set VECTOR_KEY to a secret of at least 12 characters.'); process.exit(1); }

function cors(req) {
  const o = req.headers.origin;
  return ORIGINS.includes(o) ? {
    'Access-Control-Allow-Origin': o,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  } : {};
}
const send = (req, res, status, obj) => { res.writeHead(status, { ...cors(req), 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, cors(req)); return res.end(); }
  if (req.headers.authorization !== 'Bearer ' + KEY) return send(req, res, 401, { error: { message: 'Wrong or missing key.' } });
  if (!req.url.startsWith('/v1/')) return send(req, res, 404, { error: { message: 'Use /v1/chat/completions or /v1/models.' } });
  const chunks = []; for await (const c of req) chunks.push(c);
  try {
    const up = await fetch(UPSTREAM + req.url, { method: req.method, headers: { 'content-type': 'application/json' }, body: req.method === 'GET' ? undefined : Buffer.concat(chunks) });
    res.writeHead(up.status, { ...cors(req), 'content-type': up.headers.get('content-type') || 'application/json' });
    res.end(Buffer.from(await up.arrayBuffer()));
    console.log(new Date().toISOString(), req.method, req.url, up.status);
  } catch (e) {
    send(req, res, 502, { error: { message: 'Model server not reachable at ' + UPSTREAM + ': ' + e.message } });
  }
}).listen(PORT, () => console.log(`Vector bridge on http://127.0.0.1:${PORT} -> ${UPSTREAM}. Allowed: ${ORIGINS.join(', ')}`));
