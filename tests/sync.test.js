const { open, assert, empty, task } = require('./harness');
const { fakeSupabase } = require('./fakesupabase');
const T = '2026-11-10';

const syncNow = app => app.page.evaluate(() => window.Sync.syncNow());

module.exports = {
  async 'family sync: sign up, start a family, a second phone joins and both stay in step'() {
    const sb = fakeSupabase();
    const a = await open({ routes: sb.routes, data: { ...empty(), tasks: [task('Pay the plumber', T)] } });
    // phone A: enter the server, create an account, start a family
    await a.tab('settings');
    await a.page.fill('#syUrl', sb.url); await a.page.fill('#syAnon', 'anon-key'); await a.page.click('[data-sy="cfg"]');
    await a.page.fill('#syEmail', 'keith@example.com'); await a.page.fill('#syPw', 'correct horse'); await a.page.click('[data-sy="up"]');
    await a.page.waitForSelector('#syName');
    await a.page.fill('#syName', 'The Flowers'); await a.page.click('[data-sy="create"]');
    await a.page.waitForSelector('#syInvite');
    const code = await a.page.$eval('#syInvite', e => e.textContent);
    assert.eq(sb.db.records.filter(r => r.collection === 'tasks').length, 1, 'task uploaded');
    await a.page.evaluate(() => { window.Finance.addTxn({ type: 'expense', amount: 4250, category: 'Groceries', date: '2026-11-10', note: 'Kroger' }); persist(); });
    await syncNow(a);

    // phone B: signs in with its own account and joins with the code (replacing its empty data)
    const b = await open({ routes: sb.routes, local: sb.local });
    await b.tab('settings');
    await b.page.fill('#syEmail', 'amanda@example.com'); await b.page.fill('#syPw', 'another pass'); await b.page.click('[data-sy="up"]');
    await b.page.waitForSelector('#syCode');
    await b.page.fill('#syCode', code); await b.page.click('[data-sy="join"]');
    await b.page.waitForSelector('#syInvite');
    let d = await b.data();
    assert.eq(d.tasks.map(t => t.title), ['Pay the plumber'], 'B sees the family task');
    assert.eq(d.finance.txns.map(t => t.note), ['Kroger'], 'B sees the family spending');

    // B completes the task and adds a grocery item; A picks both up
    await b.cmd('complete pay the plumber', true);
    await b.page.evaluate(() => { window.Grocery.add([{ name: 'Milk' }]); persist(); });
    await syncNow(b); await syncNow(a);
    d = await a.data();
    assert.eq(d.tasks[0].status, 'done', 'A sees it done');

    // A deletes the transaction; it disappears on B
    await a.page.evaluate(() => { data.finance.txns = []; persist(); });
    await syncNow(a); await syncNow(b);
    assert.eq((await b.data()).finance.txns.length, 0, 'delete reaches B');
    assert.ok(sb.db.records.some(r => r.collection === 'finance.txns' && r.deleted), 'delete kept as a tombstone');

    // both change different things at once: nothing is lost
    await a.cmd('add call the bank tomorrow', true); await b.cmd('add buy birthday card tomorrow', true);
    await syncNow(a); await syncNow(b); await syncNow(a);
    const titles = d => d.tasks.map(t => t.title.toLowerCase()).sort();
    assert.eq(titles(await a.data()), ['buy birthday card', 'call the bank', 'pay the plumber']);
    assert.eq(titles(await b.data()), titles(await a.data()), 'phones match');
    assert.match(await b.page.$eval('#syncPanel', e => e.textContent), /Synced/);
    assert.noErrors(a); assert.noErrors(b); await a.close(); await b.close();
  },

  async 'family sync: wrong password and wrong invite code explain themselves'() {
    const sb = fakeSupabase();
    const app = await open({ routes: sb.routes, local: sb.local });
    await app.tab('settings');
    await app.page.fill('#syEmail', 'x@example.com'); await app.page.fill('#syPw', 'whatever123'); await app.page.click('[data-sy="in"]');
    await app.page.waitForSelector('#syMsg');
    assert.match(await app.page.$eval('#syMsg', e => e.textContent), /Invalid login credentials/);
    await app.page.fill('#syPw', 'whatever123'); await app.page.click('[data-sy="up"]'); await app.page.waitForSelector('#syCode');
    await app.page.fill('#syCode', 'NOPE1234'); await app.page.click('[data-sy="join"]');
    await app.page.waitForFunction(() => /✗/.test(document.getElementById('syMsg')?.textContent));
    assert.match(await app.page.$eval('#syMsg', e => e.textContent), /invite code was not found/);
    assert.noErrors(app); await app.close();
  },

  async 'Vector AI through the family server: no key on the phone'() {
    const sb = fakeSupabase();
    sb.db.aiReply = () => JSON.stringify({ actions: [{ kind: 'add_task', title: 'Call mom', task_id: null, date: '2026-11-11', due: null, priority: null, area: null, money_type: null, amount: null, category: null, note: null, bill_id: null, person: null, fit_type: null, activity: null, minutes: null, miles: null, value: null, calories: null, protein: null, meal_slot: null, goal_id: null, aisle: null, weekdays: null, exercises: null }], reply: '' });
    const app = await open({ routes: sb.routes, local: sb.local, time: new Date(2026, 10, 10, 9, 0) });
    await app.page.evaluate(async () => { await window.Sync.signUp('keith@example.com', 'correct horse'); await window.Sync.createFamily('Flowers'); });
    await app.tab('settings');
    await app.page.check('#syAi');
    assert.ok(await app.page.evaluate(() => window.VectorAI.enabled()), 'AI on without a key');
    const items = await app.cmd('remind me to call my mom tomorrow');
    assert.match(items.join(' '), /Call mom/);
    const req = sb.db.ai[0];
    assert.ok(req, 'request went to the family server');
    assert.match(req.path, /^\/functions\/v1\/claude-proxy\/v1\/messages/);
    assert.eq(req.headers['authorization'], 'Bearer tok-u1', 'signed-in user token, not an API key');
    assert.ok(!/sk-ant/.test(JSON.stringify(req.headers)), 'no Anthropic key on the phone');
    assert.noErrors(app); await app.close();
  },
};
