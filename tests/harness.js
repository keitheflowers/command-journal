// Test harness for The Family Save: serves the app, opens it in Chromium
// with seeded data, a fixed clock, and fake speech / AI when asked.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.csv': 'text/csv' };

function startServer() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let u = decodeURIComponent(req.url.split('?')[0]);
      if (u.endsWith('sw.js')) { res.writeHead(404); return res.end(); } // no service worker in tests
      const f = path.join(ROOT, u === '/' ? 'index.html' : u);
      if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
      fs.readFile(f, (err, buf) => {
        if (err) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
        res.end(buf);
      });
    }).listen(0, '127.0.0.1', () => resolve({ srv, url: `http://localhost:${srv.address().port}/` }));
  });
}

let browser, server;
async function setup() { server = await startServer(); browser = await chromium.launch(); }
async function teardown() { await browser?.close(); server?.srv.close(); }

const empty = () => ({ version: 1, events: [], reviews: [], tasks: [] });
const task = (title, scheduled, extra = {}) => ({ id: 't' + Math.random().toString(36).slice(2), title, next: '', area: 'Vector AI', priority: 'Medium', scheduled, due: '', notes: '', status: 'open', created: '', completed: null, rollovers: 0, ...extra });

/**
 * Open the app. Options:
 *  data: object stored as the journal (default: empty)
 *  time: Date to freeze the clock at
 *  speech: true -> fake SpeechRecognition + speechSynthesis (window.__final, window.__said)
 *  ai: function(body) -> {status, body} answering api.anthropic.com, with AI turned on
 *  local: extra localStorage entries
 */
async function open(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [], dialogs = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept(dialogs.shift() ?? ''));
  if (opts.time) await page.clock.install({ time: opts.time });
  const requests = [];
  if (opts.ai) {
    await page.route('https://api.anthropic.com/**', route => {
      const body = JSON.parse(route.request().postData() || '{}');
      requests.push({ headers: route.request().headers(), body });
      const r = opts.ai(body);
      const payload = r.status && r.status !== 200 ? r.body : { id: 'msg', type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: typeof r.text === 'string' ? r.text : JSON.stringify(r.json) }] };
      route.fulfill({ status: r.status || 200, contentType: 'application/json', body: JSON.stringify(payload) });
    });
  }
  await page.addInitScript(({ data, local, speech, ai }) => {
    if (sessionStorage.getItem('__seeded')) return; // keep state across reloads
    sessionStorage.setItem('__seeded', '1');
    localStorage.setItem('command_journal_v1', JSON.stringify(data));
    for (const [k, v] of Object.entries(local || {})) localStorage.setItem(k, v);
    if (ai) { localStorage.setItem('vectorAiKey', 'sk-ant-test'); localStorage.setItem('vectorAiOn', '1'); }
    try { Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true }); } catch (_) {}
    if (speech) {
      window.__said = [];
      window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { cancel() {}, speak(u) { window.__said.push(u.text); setTimeout(() => { u.onstart && u.onstart(); setTimeout(() => u.onend && u.onend(), 50); }, 5); } } });
      window.SpeechRecognition = class { start() { window.__rec = this; } abort() {} };
      let n = 0;
      window.__final = t => { const res = []; for (let i = 0; i <= n; i++) { const x = [{ transcript: i === n ? t : 'old' }]; x.isFinal = true; res.push(x); } n++; window.__rec.onresult({ results: res }); };
    }
  }, { data: opts.data || empty(), local: opts.local, speech: !!opts.speech, ai: !!opts.ai });
  await page.goto(server.url);
  await page.waitForTimeout(400);
  const app = {
    page, ctx, errors, dialogs, requests,
    // type an instruction into the Today box and return the proposed changes
    async cmd(text, confirm = false) {
      return page.evaluate(async ({ text, confirm }) => {
        document.getElementById('command').value = text;
        await interpretCommand();
        const box = document.getElementById('commandPreview');
        const items = [...box.querySelectorAll('li')].map(x => x.textContent);
        if (confirm && items.length) applyPreview();
        return items.length ? items : [box.textContent];
      }, { text, confirm });
    },
    tab: async v => { await page.click(`#tabs [data-view="${v}"]`); await page.waitForTimeout(150); },
    say: async (t, ms = 300) => { await page.evaluate(t => window.__final(t), t); await page.waitForTimeout(ms); },
    lastSaid: () => page.evaluate(() => window.__said.at(-1)),
    data: () => page.evaluate(() => JSON.parse(JSON.stringify(data))),
    close: () => ctx.close(),
  };
  return app;
}

// tiny assertions with readable messages
const assert = {
  ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); },
  eq(a, b, msg) { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error(`${msg || 'not equal'}\n      got:      ${A}\n      expected: ${B}`); },
  match(s, re, msg) { if (!re.test(String(s))) throw new Error(`${msg || 'no match'}\n      got: ${JSON.stringify(s)}\n      expected to match: ${re}`); },
  noErrors(app) { if (app.errors.length) throw new Error('page errors: ' + app.errors.join(' | ')); },
};

module.exports = { setup, teardown, open, assert, empty, task, ROOT };
