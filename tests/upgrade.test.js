// Updating the app must never lose or duplicate anyone's data.
// These tests install the previously published version (git commit OLD_REF),
// fill it with a sample family's journal, settings and AI connection, then load
// the current code on the same "phone" (same browser profile and address).
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const { assert, ROOT } = require('./harness');

const OLD_REF = process.env.OLD_REF || '704b460'; // last published version before safe updates
const KEY = 'command_journal_v1';
let oldDir = null;
function oldApp() {
  if (oldDir) return oldDir;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-old-'));
  const tar = execFileSync('git', ['-C', ROOT, 'archive', OLD_REF], { maxBuffer: 1 << 28 });
  execFileSync('tar', ['-x', '-C', dir], { input: tar });
  return (oldDir = dir);
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
// one address, two versions of the app: flip `root` to "ship an update"
function server() {
  const s = { root: null };
  s.srv = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    if (u.endsWith('sw.js')) { res.writeHead(404); return res.end(); }
    const f = path.join(s.root, u === '/' ? 'index.html' : u);
    fs.readFile(f, (err, buf) => { if (err) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(buf); });
  });
  return new Promise(r => s.srv.listen(0, '127.0.0.1', () => { s.url = `http://localhost:${s.srv.address().port}/`; r(s); }));
}

async function phone() {
  const s = await server(), browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept(d.type() === 'prompt' ? '' : undefined));
  return {
    s, page, errors,
    async run(version, setup) { // open the given version, optionally seeding storage first
      s.root = version === 'old' ? oldApp() : ROOT;
      if (setup) { await page.goto(s.url + 'privacy.html'); await page.evaluate(setup.fn, setup.arg); }
      await page.goto(s.url); await page.waitForTimeout(700);
    },
    local: () => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)]))),
    journal: () => page.evaluate(k => JSON.parse(localStorage.getItem(k)), KEY),
    snapshots: () => page.evaluate(() => new Promise(res => { const r = indexedDB.open('familysave', 1); r.onupgradeneeded = () => r.result.createObjectStore('snapshots', { keyPath: 'id' }); r.onsuccess = () => { const t = r.result.transaction('snapshots').objectStore('snapshots').getAll(); t.onsuccess = () => { r.result.close(); res(t.result); }; }; })),
    close: async () => { await browser.close(); s.srv.close(); },
  };
}

// a family's data in the shape the published app stores it
function sampleFamily() {
  const t = (id, title, extra = {}) => ({ id, title, next: '', area: 'Home', priority: 'Medium', scheduled: '2026-11-10', due: '', notes: '', status: 'open', created: '2026-11-01T10:00:00.000Z', completed: null, rollovers: 0, ...extra });
  const dupTask = t('t-dup', 'Call the plumber');
  return {
    version: 1,
    areas: ['Home', 'Kids', 'Church', 'Money'],
    tasks: [t('t1', 'Pay the water bill', { area: 'Money', due: '2026-11-20' }), dupTask, { ...dupTask }, t('t3', 'Soccer signup', { area: 'Kids', status: 'done', completed: '2026-11-09T18:00:00.000Z', notes: 'Bring the birth certificate 📄' })],
    events: [{ id: 'e1', timestamp: '2026-11-09T18:00:00.000Z', type: 'complete', taskId: 't3', details: 'Soccer signup' }],
    reviews: [
      { id: 'r1', type: 'morning', date: '2026-11-09', goal: 'Finish the budget and call Mom', created: '2026-11-09T07:00:00.000Z' },
      { type: 'evening', date: '2026-11-09', wins: 'Budget done. Kids asleep by 8!', carried: 1, created: '2026-11-09T21:30:00.000Z' }, // no id (older entries)
    ],
    finance: {
      txns: [{ id: 'x1', type: 'expense', amount: 4312, category: 'Groceries', date: '2026-11-08', note: 'Kroger', created: '' }, { id: 'x2', type: 'income', amount: 210000, category: 'Paycheck', date: '2026-11-07', note: '', created: '' }],
      bills: [{ id: 'b1', name: 'Electric', amount: 14000, dueDay: 25, category: 'Utilities', paid: { '2026-10': 'x0' } }],
      budgets: { Groceries: 70000 },
      goals: [{ id: 'g1', name: 'Vacation', target: 300000, deadline: '2027-06-01', created: '2026-09-01T00:00:00Z', contributions: [{ id: 'c1', date: '2026-09-02', amount: 50000, note: '' }] }],
    },
    fitness: { people: [{ id: 'me', name: 'Dad', goals: { steps: 9000 } }, { id: 'kid', name: 'Ava', goals: {} }], logs: [{ id: 'l1', person: 'me', type: 'weight', date: '2026-11-08', value: 201.4 }], mealPlan: { '2026-11-10': { dinner: 'Tacos' } } },
    grocery: { items: [{ id: 'gi1', name: 'Milk', section: 'Dairy', done: false }] },
    futureSection: { keepMe: true }, // something a newer build might have added
  };
}
const SETTINGS = {
  onboardDone: '1', navLast: '{"g":"money","v":"finance"}', fsMe: 'me', wakeAuto: '0', vectorAiOn: '1',
  vectorAiKey: 'sk-ant-PRIVATE-user-key', usdaKey: 'usda-private',
  vectorServer: JSON.stringify({ on: true, url: 'https://vectorcore.tailnet.ts.net', type: 'openai', model: 'vector-pilot:9b', key: 'bridge-secret-123' }),
};
const seed = (data, extra = {}, raw) => ({ fn: ({ KEY, data, settings, raw }) => { localStorage.clear(); localStorage.setItem(KEY, raw ?? JSON.stringify(data)); for (const [k, v] of Object.entries(settings)) localStorage.setItem(k, v); }, arg: { KEY, data, settings: { ...SETTINGS, ...extra }, raw } });
const strip = d => { const c = JSON.parse(JSON.stringify(d)); delete c.schemaVersion; return c; };

module.exports = {
  async 'update from the published version keeps every journal, setting and AI connection'() {
    const p = await phone();
    try {
      await p.run('old', seed(sampleFamily()));
      // use the old app the normal way, so its own code writes the data
      await p.page.evaluate(() => { document.getElementById('command').value = 'add task renew the car tags'; return interpretCommand().then(() => applyPreview()); });
      await p.page.waitForTimeout(300);
      const before = await p.journal(), beforeRaw = (await p.local())[KEY], beforeLocal = await p.local();
      assert.ok(before.tasks.some(t => /renew the car tags/i.test(t.title)), 'old app saved the new task');

      await p.run('new'); // the update arrives
      const after = await p.journal(), local = await p.local();
      assert.eq(after.schemaVersion, 2, 'data upgraded to schema 2');
      // nothing lost: everything from before is still there, except one exact duplicate
      const want = strip(before);
      want.tasks = want.tasks.filter((t, i, a) => a.findIndex(x => JSON.stringify(x) === JSON.stringify(t)) === i);
      const got = strip(after);
      assert.ok(got.reviews[1].id && got.reviews[1].id.startsWith('m-reviews-'), 'old journal entry got a stable id');
      delete got.reviews[1].id;
      assert.eq(got, want, 'journal identical apart from the removed exact duplicate');
      assert.eq(after.tasks.filter(t => t.id === 't-dup').length, 1, 'duplicate task removed once');
      assert.eq(after.futureSection, { keepMe: true }, 'unknown sections kept');
      for (const k of Object.keys(SETTINGS)) assert.eq(local[k], beforeLocal[k], 'setting kept: ' + k);
      assert.ok(!local.fsUpdateBackup, 'temporary update copy cleaned up');
      const snaps = await p.snapshots(), pre = snaps.find(s => s.reason === 'before-update');
      assert.ok(pre && pre.data === beforeRaw, 'exact pre-update copy kept as a restore point');
      assert.match(await p.page.$eval('#updateNotice', e => e.textContent), /App updated/);
      assert.eq(p.errors, [], 'no page errors');

      await p.run('new'); // opening again must not migrate or duplicate anything
      const again = await p.journal();
      assert.eq(again, after, 'second start changes nothing');
      assert.eq((await p.snapshots()).filter(s => s.reason === 'before-update').length, 1, 'one pre-update restore point');
    } finally { await p.close(); }
  },

  async 'an update interrupted halfway resumes from the saved original'() {
    const p = await phone();
    try {
      const orig = JSON.stringify(sampleFamily());
      // crash right after the safety copy was written, before the upgraded data was saved
      await p.run('new', { fn: ({ KEY, orig }) => { localStorage.clear(); localStorage.setItem(KEY, orig); localStorage.setItem('fsUpdateBackup', JSON.stringify({ from: 1, to: 2, at: '2026-11-12T03:00:00.000Z', raw: orig })); localStorage.setItem('onboardDone', '1'); }, arg: { KEY, orig } });
      const d = await p.journal();
      assert.eq(d.schemaVersion, 2);
      assert.eq(d.tasks.map(t => t.id), ['t1', 't-dup', 't3'], 'tasks intact, no duplicates');
      assert.eq(d.reviews.length, 2, 'journal entries intact');
      assert.ok(!(await p.local()).fsUpdateBackup, 'finished and cleaned up');

      // crash that left the journal unreadable: go back to the original, keep the broken copy
      await p.run('new', { fn: ({ KEY, orig }) => { localStorage.clear(); localStorage.setItem(KEY, '{"tasks":[{"id":"t1",'); localStorage.setItem('fsUpdateBackup', JSON.stringify({ from: 1, to: 2, at: '2026-11-12T03:00:00.000Z', raw: orig })); localStorage.setItem('onboardDone', '1'); }, arg: { KEY, orig } });
      const r = await p.journal();
      assert.eq(r.tasks.length, 3, 'recovered from the pre-update copy');
      assert.eq((await p.local())['command_journal_v1__unreadable'], '{"tasks":[{"id":"t1",', 'broken data kept, not deleted');
      assert.match(await p.page.$eval('#updateNotice', e => e.textContent), /Recovered/);
      assert.eq(p.errors, []);
    } finally { await p.close(); }
  },

  async 'unreadable data is never replaced with an empty journal'() {
    const p = await phone();
    try {
      await p.run('old', seed(sampleFamily()));
      await p.page.waitForTimeout(300); // old app makes its daily restore point
      await p.page.evaluate(k => localStorage.setItem(k, '{"tasks": [ broken'), KEY); // storage damaged
      await p.run('new');
      assert.match(await p.page.$eval('#updateNotice', e => e.textContent), /couldn’t be read/);
      // trying to add something must not overwrite the damaged data
      await p.page.evaluate(() => { document.getElementById('command').value = 'add task test'; return interpretCommand().then(() => applyPreview()); });
      assert.eq((await p.local())[KEY], '{"tasks": [ broken', 'damaged data left untouched');
      await p.page.click('[data-bk="latest"]'); await p.page.waitForTimeout(500);
      const d = await p.journal();
      assert.eq(d.tasks.length, 3, 'restored from the restore point (exact duplicate dropped)');
      assert.eq(d.schemaVersion, 2, 'restored data upgraded');
      assert.eq((await p.local())['command_journal_v1__unreadable'], '{"tasks": [ broken', 'damaged copy still kept');
      assert.eq((await p.local()).vectorAiKey, SETTINGS.vectorAiKey, 'AI key untouched');
    } finally { await p.close(); }
  },

  async 'backup file: settings included, keys left out unless asked, restore puts everything back'() {
    const p = await phone();
    try {
      await p.run('new', seed(sampleFamily()));
      const original = await p.journal();
      const file = async () => { const [dl] = await Promise.all([p.page.waitForEvent('download'), p.page.evaluate(() => exportData())]); return JSON.parse(fs.readFileSync(await dl.path(), 'utf8')); };
      const b = await file();
      assert.eq(b._familySave.settings.fsMe, 'me', 'settings in the file');
      assert.eq(JSON.parse(b._familySave.settings.vectorServer).url, 'https://vectorcore.tailnet.ts.net', 'AI connection address in the file');
      const text = JSON.stringify(b);
      for (const secret of ['sk-ant-PRIVATE-user-key', 'bridge-secret-123', 'usda-private']) assert.ok(!text.includes(secret), 'secret left out: ' + secret);
      await p.page.evaluate(() => localStorage.setItem('backupWithKeys', '1'));
      assert.eq((await file())._familySave.secrets.vectorServerKey, 'bridge-secret-123', 'keys included when ticked');

      // new phone (empty), restore the file without keys: data and settings back, no keys invented
      const bundle = JSON.stringify(b);
      await p.run('new', { fn: () => { localStorage.clear(); localStorage.setItem('onboardDone', '1'); }, arg: null });
      await p.page.setInputFiles('#importFile', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(bundle) });
      await p.page.waitForTimeout(500);
      const d = await p.journal(), local = await p.local();
      assert.eq(strip(d), strip(original), 'journal fully restored');
      assert.eq(d.areas, ['Home', 'Kids', 'Church', 'Money'], 'custom areas restored');
      assert.eq(local.fsMe, 'me', 'settings restored');
      assert.eq(JSON.parse(local.vectorServer).model, 'vector-pilot:9b', 'AI connection restored');
      assert.ok(!JSON.parse(local.vectorServer).key && !local.vectorAiKey, 'no keys restored from a file without them');
      assert.eq(p.errors, []);
    } finally { await p.close(); }
  },

  async 'old and new backup files work in both directions'() {
    const p = await phone();
    try {
      // a file made by the published version restores into the new one, all sections kept
      await p.run('old', seed(sampleFamily()));
      const [dl] = await Promise.all([p.page.waitForEvent('download'), p.page.evaluate(() => exportData())]);
      const oldFile = fs.readFileSync(await dl.path());
      await p.run('new', { fn: () => { localStorage.clear(); localStorage.setItem('onboardDone', '1'); }, arg: null });
      await p.page.setInputFiles('#importFile', { name: 'old.json', mimeType: 'application/json', buffer: oldFile });
      await p.page.waitForTimeout(400);
      const d = await p.journal();
      assert.eq(d.areas, ['Home', 'Kids', 'Church', 'Money'], 'areas kept (the old import dropped these)');
      assert.eq(d.futureSection, { keepMe: true }, 'every section kept');
      assert.eq(d.tasks.length, 3, 'exact duplicate removed');
      // a file made by the new version still restores into the published version
      const [dl2] = await Promise.all([p.page.waitForEvent('download'), p.page.evaluate(() => exportData())]);
      const newFile = fs.readFileSync(await dl2.path());
      await p.run('old', { fn: () => { localStorage.clear(); localStorage.setItem('onboardDone', '1'); }, arg: null });
      await p.page.setInputFiles('#importFile', { name: 'new.json', mimeType: 'application/json', buffer: newFile });
      await p.page.waitForTimeout(400);
      assert.eq((await p.journal()).tasks.length, 3, 'older version can read the new file');
    } finally { await p.close(); }
  },

  async 'phone storage full: the change is refused and the saved data stays intact'() {
    const p = await phone();
    try {
      await p.run('new', seed(sampleFamily()));
      const before = (await p.local())[KEY];
      await p.page.evaluate(k => { const orig = Storage.prototype.setItem; Storage.prototype.setItem = function (key, v) { if (key === k) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; } return orig.call(this, key, v); }; }, KEY);
      await p.page.evaluate(() => { document.getElementById('command').value = 'add task one more thing'; return interpretCommand().then(() => applyPreview()); });
      assert.eq((await p.local())[KEY], before, 'saved data untouched');
      assert.match(await p.page.$eval('#updateNotice', e => e.textContent), /storage is full/i, 'person is told');
    } finally { await p.close(); }
  },
};
