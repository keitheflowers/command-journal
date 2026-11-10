const fs = require('fs');
const { open, assert, task, empty } = require('./harness');
const NOV10 = new Date(2026, 10, 10, 12, 0);
const withTask = () => ({ ...empty(), tasks: [task('Call the bank', '2026-11-10')] });
const A = o => Object.assign({ kind: null, title: null, task_id: null, date: null, due: null, priority: null, area: null, money_type: null, amount: null, category: null, note: null, bill_id: null, person: null, fit_type: null, activity: null, minutes: null, miles: null, value: null, calories: null, protein: null, meal_slot: null, goal_id: null, aisle: null, weekdays: null, exercises: null }, o);

module.exports = {
  async 'backups: reminder, download, restore points'() {
    const app = await open({ time: NOV10, data: withTask() });
    assert.ok(await app.page.$eval('#backupNag', e => !e.classList.contains('hidden')), 'reminder shows when never backed up');
    const [dl] = await Promise.all([app.page.waitForEvent('download'), app.page.click('#backupNag [data-bk="now"]')]);
    const j = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    assert.eq([dl.suggestedFilename(), j.app, j.tasks.length], ['family-save-2026-11-10.json', 'the-family-save', 1]);
    assert.ok(!JSON.stringify(j).includes('sk-ant'), 'backup never contains the AI key');
    assert.ok(await app.page.$eval('#backupNag', e => e.classList.contains('hidden')), 'reminder hides after backup');
    await app.page.evaluate(async () => { await window.Backup.snapshot('manual'); data.tasks = []; persist(); });
    const id = await app.page.evaluate(async () => (await window.Backup.snapshots()).find(s => s.reason === 'manual').id);
    await app.page.evaluate(id => window.Backup.restore(id), id);
    assert.eq((await app.data()).tasks.map(t => t.title), ['Call the bank'], 'restore point brings data back');
    assert.noErrors(app); await app.close();
  },
  async 'app lock: PIN, wrong PIN, auto-lock, fingerprint, turn off'() {
    const app = await open({ time: NOV10, data: withTask() });
    const p = app.page;
    await app.tab('settings'); await p.click('[data-lks="set"]'); await p.fill('#lkNew', '2580'); await p.fill('#lkNew2', '2580'); await p.click('[data-lks="savepin"]'); await p.waitForTimeout(300);
    assert.ok(!(await p.evaluate(() => localStorage.getItem('lockPin'))).includes('2580'), 'PIN is stored hashed');
    await p.reload(); await p.waitForTimeout(500);
    assert.ok(await p.evaluate(() => !document.getElementById('lockScreen').hidden), 'locked on open');
    assert.eq(await p.evaluate(() => getComputedStyle(document.querySelector('main')).visibility), 'hidden', 'content hidden while locked');
    const type = async pin => { for (const d of pin) await p.click(`[data-lk="${d}"]`); await p.waitForTimeout(350); };
    await type('1111'); assert.match(await p.$eval('#lkMsg', e => e.textContent), /Wrong PIN/);
    await type('2580'); assert.ok(await p.evaluate(() => document.getElementById('lockScreen').hidden), 'unlocked');
    await p.evaluate(() => { const set = v => Object.defineProperty(document, 'hidden', { configurable: true, get: () => v }); set(true); document.dispatchEvent(new Event('visibilitychange')); set(false); document.dispatchEvent(new Event('visibilitychange')); });
    assert.ok(await p.evaluate(() => !document.getElementById('lockScreen').hidden), 'locks after leaving the app');
    await type('2580');
    const cdp = await app.ctx.newCDPSession(p); await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    await app.tab('settings'); await p.click('[data-lks="bio-on"]'); await p.waitForTimeout(800);
    await p.click('[data-lks="locknow"]'); await p.waitForTimeout(1500);
    assert.ok(await p.evaluate(() => document.getElementById('lockScreen').hidden), 'fingerprint unlocks');
    app.dialogs.push('2580'); await app.tab('settings'); await p.click('[data-lks="off"]'); await p.waitForTimeout(500);
    assert.ok(await p.evaluate(() => !localStorage.getItem('lockPin')), 'lock turned off');
    assert.noErrors(app); await app.close();
  },
  async 'AI: request shape, actions mapped, unknown task skipped'() {
    let reqTask;
    const app = await open({ time: NOV10, data: withTask(), ai: body => { reqTask = JSON.parse(body.messages[0].content.split('CONTEXT:\n')[1].split('\n\n')[0]).OPEN_TASKS[0]; return { json: { reply: '', actions: [A({ kind: 'add_task', title: 'Call Amanda', date: '2026-11-13', priority: 'High', area: 'Family / Personal' }), A({ kind: 'move_task', task_id: reqTask.task_id, date: '2026-11-16' }), A({ kind: 'txn', money_type: 'expense', amount: 40, category: 'Groceries', note: 'Kroger' }), A({ kind: 'complete_task', task_id: 'made-up' })] } }; } });
    const out = await app.cmd('remind me friday to call amanda, push the bank thing to monday and I spent forty at kroger');
    assert.eq(out, ['Add: Call Amanda · Fri, Nov 13 · High priority · Family / Personal', 'Move to Mon, Nov 16: Call the bank', 'Expense: $40.00 · Groceries · Kroger · today']);
    const r = app.requests[0];
    assert.eq([r.headers['x-api-key'], r.headers['anthropic-dangerous-direct-browser-access'], r.body.model, r.body.fallbacks], ['sk-ant-test', 'true', 'claude-opus-5-5', 'default']);
    assert.match(await app.page.$eval('#commandPreview', e => e.textContent), /Skipped: Could not find that task/);
    assert.noErrors(app); await app.close();
  },
  async 'AI: schema rejected falls back to plain JSON; bad key shows the reason'() {
    let mode = 'schema';
    const app = await open({ time: NOV10, ai: body => mode === '401' ? { status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } }
      : body.output_config && body.output_config.format ? { status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'Schema is too complex' } } }
      : { text: 'Sure:\n{"actions":[],"reply":"Nothing due today."}' } });
    const out = await app.cmd('what is due today');
    assert.match(out.join(), /Nothing due today/);
    assert.eq(app.requests.map(r => !!(r.body.output_config && r.body.output_config.format)), [true, false], 'retried without the schema');
    mode = '401';
    const bad = await app.cmd('add task test');
    assert.match(bad.join(), /Add: test/, 'built-in rules still work');
    assert.match(await app.page.$eval('#commandPreview', e => e.textContent), /Vector AI didn’t answer: API key was rejected/);
    assert.noErrors(app); await app.close();
  },
  async 'AI off: nothing leaves the phone'() {
    const app = await open({ time: NOV10, ai: () => ({ json: { actions: [], reply: 'x' } }), local: {} });
    await app.page.evaluate(() => localStorage.setItem('vectorAiOn', ''));
    await app.cmd('add task gym');
    assert.eq(app.requests.length, 0);
    await app.close();
  },
};
