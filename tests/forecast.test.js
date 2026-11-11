const { open, assert, empty } = require('./harness');
const NOV10 = new Date(2026, 10, 10, 9, 0); // Tuesday

// $3,000 start, paid $2,000 every two weeks (Oct 16, Oct 30), $520 of everyday
// spending over the 26 days since the first transaction (= $20/day), and
// $1,500 rent due on the 15th.
const money = () => ({
  accounts: [{ id: 'chk', name: 'Checking', type: 'checking', onBudget: true, start: 300000, created: '' }, { id: 'cc', name: 'Visa', type: 'credit', onBudget: true, start: 0, created: '' }],
  txns: [
    { id: 'p1', type: 'income', amount: 200000, category: 'Paycheck', date: '2026-10-16', payee: 'Acme Payroll', note: 'Acme Payroll', accountId: 'chk', reviewed: true, created: '' },
    { id: 'p2', type: 'income', amount: 200000, category: 'Paycheck', date: '2026-10-30', payee: 'Acme Payroll', note: 'Acme Payroll', accountId: 'chk', reviewed: true, created: '' },
    { id: 'e1', type: 'expense', amount: 26000, category: 'Groceries', date: '2026-10-20', payee: 'Kroger', note: 'Kroger', accountId: 'chk', reviewed: true, created: '' },
    { id: 'e2', type: 'expense', amount: 26000, category: 'Shopping', date: '2026-11-05', payee: 'Target', note: 'Target', accountId: 'chk', reviewed: true, created: '' },
    { id: 'e3', type: 'expense', amount: 9000, category: 'Dining', date: '2026-11-06', payee: 'Steakhouse', note: 'Steakhouse', accountId: 'cc', reviewed: true, created: '' },
  ],
  bills: [{ id: 'rent', name: 'Rent', amount: 150000, dueDay: 15, category: 'Housing', paid: {} }],
  budgets: {}, assign: {}, targets: {}, rules: [],
});
const fam = { people: [{ id: 'me', name: 'Alex', goals: {} }, { id: 'sam', name: 'Sam', goals: {} }], logs: [] };

module.exports = {
  async 'forecast: paychecks, bills and everyday spending, day by day'() {
    const app = await open({ time: NOV10, data: { ...empty(), finance: money(), fitness: fam } });
    const r = await app.page.evaluate(() => { const f = window.Budget.forecast(30); return { start: f.start, low: f.low, end: f.series.at(-1).bal, rate: f.rate, income: f.income, ev: f.events.map(e => e.date + ' ' + e.label + ' ' + e.amount) }; });
    assert.eq(r.start, 648000, 'cash today: 3,000 + 4,000 - 520 (card spending not counted)');
    assert.eq(r.rate, 2000, '$520 over 26 days');
    assert.eq(r.ev, ['2026-11-13 Acme Payroll 200000', '2026-11-15 Rent -150000', '2026-11-27 Acme Payroll 200000']);
    assert.eq(r.low, { date: '2026-11-12', bal: 644000 }, 'lowest just before payday');
    assert.eq(r.end, 648000 - 30 * 2000 + 400000 - 150000);
    assert.eq(r.income.map(x => x.every), ['every 2 weeks']);

    await app.tab('finance'); await app.page.click('.mn-tabs [data-sub="forecast"]');
    let txt = await app.page.$eval('#finance', e => e.textContent);
    assert.match(txt, /Today\$6,480/); assert.match(txt, /Lowest point\$6,440/); assert.match(txt, /Paychecks found: Acme Payroll \$2,000 every 2 weeks/);
    assert.ok(!/could drop/.test(txt), 'no warning above the cushion');
    // raise the cushion: now it warns
    await app.page.fill('#fcFloor', '7000'); await app.page.dispatchEvent('#fcFloor', 'change');
    await app.page.click('.mn-tabs [data-sub="forecast"]');
    assert.match(await app.page.$eval('#finance', e => e.textContent), /Your cash could drop to \$6,440 around Thu, Nov 12, under your \$7,000 cushion/);
    await app.cmd('how is my cash looking');
    assert.match(await app.page.evaluate(() => window.lastVectorReply), /^You have \$6,480 in cash today\. Your lowest point looks like \$6,440 on Thursday, Nov 12/);
    await app.tab('dashboard');
    assert.match(await app.page.$eval('#dashboard', e => e.textContent), /Lowest cash next 30 days\$6,440⚠️ around Nov 12/);
    assert.noErrors(app); await app.close();
  },

  async 'who spent it: voice, this phone’s owner, edit, filter and report'() {
    const app = await open({ time: NOV10, data: { ...empty(), finance: money(), fitness: fam } });
    const items = await app.cmd('Sam spent 40 at Target and I spent 12 on lunch', true);
    assert.match(items.join(' | '), /Expense: \$40\.00 .* 👤 Sam/);
    let tx = (await app.data()).finance.txns;
    assert.eq(tx.find(t => t.amount === 4000).who, 'sam'); assert.eq(tx.find(t => t.amount === 1200).who, 'me', 'my entries default to this phone’s owner');
    // this phone belongs to Sam now
    await app.tab('finance'); await app.page.click('.mn-tabs [data-sub="reports"]');
    await app.page.selectOption('#meSel', 'sam');
    await app.cmd('spent 5 on coffee', true);
    tx = (await app.data()).finance.txns;
    assert.eq(tx.find(t => t.amount === 500).who, 'sam');
    // report by person
    await app.tab('finance'); await app.page.click('.mn-tabs [data-sub="reports"]');
    const rep = await app.page.$eval('#finance', e => e.textContent);
    assert.match(rep, /Who spent it.*Alex\$12.*Sam\$45.*Shared \/ not set\$350/s);
    // filter and edit on Transactions
    await app.page.click('.mn-tabs [data-sub="tx"]');
    await app.page.selectOption('#txWho', 'sam');
    assert.eq((await app.page.$$('#finance .tx')).length, 2, 'only Sam’s two');
    await app.page.click('#finance .tx'); await app.page.selectOption('#edWho', 'me'); await app.page.click('[data-t="saveedit"]');
    assert.eq((await app.page.$$('#finance .tx')).length, 1, 'moved one to Alex');
    assert.noErrors(app); await app.close();
  },
};
