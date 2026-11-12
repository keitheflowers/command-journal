// Vector (the family's own AI on a computer) and a phone share one family server.
// The Python bridge in vector/ writes records over HTTP; the phone syncs them in,
// and what the phone writes is what Vector reads back.
//
// The shared server is the Python fake from vector/test_vector.py (started here as
// a subprocess). The phone's requests to its sync server are forwarded to it.
const { spawn, execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const { open, assert, empty, task, ROOT } = require('./harness');
const SYNC_URL = 'https://family.supabase.test';
const T = '2026-11-10';

function python() {
  for (const bin of ['python3', 'python']) {
    try { if (/Python 3\.(9|[1-9]\d)/.test(execFileSync(bin, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))) return bin; } catch (_) { /* next */ }
  }
  return null;
}

// Start the fake family server; resolves with its URL and a stop().
function startServer(py) {
  return new Promise((resolve, reject) => {
    const p = spawn(py, [path.join(ROOT, 'vector', 'test_vector.py'), '--serve'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; const m = out.match(/http:\/\/[\d.]+:\d+/); if (m) resolve({ url: m[0], stop: () => { p.stdin.end(); p.kill(); } }); });
    p.stderr.on('data', d => { err += d; });
    p.on('exit', code => reject(new Error(`fake server exited (${code}): ${err}`)));
    setTimeout(() => reject(new Error('fake server did not start: ' + err)), 15000).unref();
  });
}

// The phone thinks it talks to SYNC_URL; hand each request to the Python server.
const forwardTo = base => page => page.route(SYNC_URL + '/**', async route => {
  const req = route.request();
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  const h = req.headers(), headers = {};
  for (const k of ['apikey', 'authorization', 'content-type', 'prefer']) if (h[k]) headers[k] = h[k];
  const r = await fetch(base + req.url().slice(SYNC_URL.length), { method: req.method(), headers, body: req.postData() || undefined });
  route.fulfill({ status: r.status, contentType: 'application/json', headers: cors, body: await r.text() });
});

module.exports = {
  async 'Vector bridge: the Python client and a phone see each other\'s changes through the family server'() {
    const py = python();
    if (!py) { console.log('      (skipped: Python 3.9+ is not installed here)'); return; }
    const srv = await startServer(py);
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-vector-'));
    const env = { ...process.env, FAMILYSAVE_HOME: home, FAMILYSAVE_URL: srv.url, FAMILYSAVE_ANON_KEY: 'anon-key', FAMILYSAVE_PASSWORD: 'correct horse' };
    const vector = (...args) => JSON.parse(execFileSync(py, [path.join(ROOT, 'vector', 'familysave.py'), ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
    const month = new Date().toISOString().slice(0, 7);
    try {
      // the phone: an account, a family, a task, a bill and a family member
      const phone = await open({ routes: forwardTo(srv.url), local: { fsSync: JSON.stringify({ url: SYNC_URL, anon: 'anon-key' }) },
        data: { ...empty(), tasks: [task('Pay the plumber', T, { area: 'Home' })] } });
      await phone.page.evaluate(async () => {
        await window.Sync.signUp('keith@example.com', 'correct horse'); await window.Sync.createFamily('The Flowers');
        window.Fitness.people(); // creates "Me"
        data.finance = { txns: [], bills: [{ id: 'bill1', name: 'Electric', amount: 14000, dueDay: 15, category: 'Utilities', paid: {} }], budgets: {} };
        persist(); await window.Sync.syncNow();
      });
      assert.match(await phone.page.$eval('#syncPanel', e => e.textContent), /The Flowers/);

      // Vector signs in with the same account and reads what the phone wrote
      const login = vector('login', 'keith@example.com');
      assert.eq(login.household, 'The Flowers', 'Vector joined the family');
      let tasks = vector('tasks');
      assert.eq(tasks.map(t => t.title), ['Pay the plumber'], 'Vector sees the phone\'s task');
      assert.eq(vector('bills').map(b => [b.name, b.due, b.paid_this_month]), [['Electric', `${month}-15`, false]]);
      assert.eq(vector('health').map(p => p.person), ['Me']);

      // Vector changes things: completes the task, adds one, logs spending, pays the bill, adds groceries, writes the journal
      assert.eq(vector('done', 'plumber').status, 'done');
      const added = vector('add', 'Call the dentist', '--date', '2026-11-11', '--priority', 'High', '--area', 'Health');
      vector('spent', '42.50', 'Kroger', '--date', '2026-11-12', '--who', 'me');
      vector('paid', 'electric', '--date', '2026-11-14');
      vector('buy', 'bananas', 'milk');
      vector('morning', 'Ship the Vector bridge', '--plan', 'Tests first');
      vector('log', 'steps', '--value', '7000');

      // the phone pulls and shows all of it
      await phone.page.evaluate(() => window.Sync.syncNow());
      const d = await phone.data();
      const byTitle = Object.fromEntries(d.tasks.map(t => [t.title, t]));
      assert.eq(byTitle['Pay the plumber'].status, 'done', 'completed by Vector');
      assert.eq([byTitle['Call the dentist'].priority, byTitle['Call the dentist'].scheduled, byTitle['Call the dentist'].area], ['High', '2026-11-11', 'Health']);
      assert.eq(byTitle['Call the dentist'].id, added.task_id);
      assert.eq(d.finance.txns.map(t => [t.amount, t.category, t.note]).sort(), [[14000, 'Utilities', 'Electric'], [4250, 'Groceries', 'Kroger']].sort(), 'spending and the bill payment');
      assert.eq(d.finance.txns.find(t => t.note === 'Kroger').who, d.fitness.people[0].id, '"who" resolved to the family member');
      assert.eq(d.finance.bills[0].paid['2026-11'], d.finance.txns.find(t => t.billId === 'bill1').id, 'bill ticked off, linked to its payment');
      assert.eq(d.grocery.items.map(i => i.name).sort(), ['Bananas', 'Milk']);
      assert.eq([d.reviews[0].type, d.reviews[0].goal, d.reviews[0].notes], ['morning', 'Ship the Vector bridge', 'Tests first']);
      assert.eq(d.fitness.logs.map(l => [l.kind, l.value]), [['steps', 7000]]);
      assert.ok(d.events.some(e => e.type === 'task_completed' && /^Vector: /.test(e.details)), 'Vector\'s actions are in the activity log');

      // ...and renders them without errors
      await phone.tab('tasks');
      assert.match(await phone.page.$eval('#allTasks', e => e.textContent), /Call the dentist/);
      await phone.tab('reviews');
      assert.match(await phone.page.$eval('#journalEntries', e => e.textContent), /Ship the Vector bridge/);
      await phone.tab('finance');
      assert.match(await phone.page.$eval('#finance', e => e.textContent), /Groceries\s*spent \$43[\s\S]*Electric[\s\S]*paid ✓/, 'budget shows the spending and the paid bill');
      await phone.tab('fitness');
      assert.match(await phone.page.$eval('#fitness', e => e.textContent), /7,?000/);

      // the phone changes something; Vector sees it, and the briefing reflects everything
      await phone.cmd('add buy birthday card tomorrow', true);
      await phone.page.evaluate(() => window.Sync.syncNow());
      tasks = vector('tasks');
      assert.eq(tasks.map(t => t.title.toLowerCase()).sort(), ['buy birthday card', 'call the dentist'], 'Vector sees the phone\'s new task');
      const today = vector('today');
      assert.eq(today.latest_journal_entry.top_objective, 'Ship the Vector bridge');
      assert.eq(today.grocery_items_to_buy, 2);
      const money = vector('money', '--month', '2026-11');
      assert.eq([money.spent, money.spent_by_category.Groceries, money.spent_by_person.Me, money.unpaid_bills.length], [182.5, 42.5, 42.5, 0]);
      assert.eq(vector('activity')[0].what, 'task_created', 'the phone\'s change is in the log Vector reads');
      assert.noErrors(phone); await phone.close();
    } finally {
      srv.stop();
      fs.rmSync(home, { recursive: true, force: true });
    }
  },
};
