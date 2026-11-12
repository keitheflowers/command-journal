const fs = require('fs'), path = require('path'), os = require('os');
const { open, assert } = require('./harness');
const NOV9 = new Date(2026, 10, 9, 12, 0);

// Old-format finance data (before accounts/budgets) to prove migration is safe.
function legacy() {
  const txns = [], id = () => Math.random().toString(36).slice(2);
  for (const [m, lim] of [['08', 30], ['09', 31], ['10', 9]]) {
    const D = d => `2026-${String(+m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    for (const d of [1, 15]) if (d <= lim) txns.push({ id: id(), type: 'income', amount: 242500, category: 'Paycheck', date: D(d), note: 'Paycheck', created: '' });
    txns.push({ id: id(), type: 'expense', amount: 145000, category: 'Housing', date: D(1), note: 'Rent', created: '' });
    if (lim >= 6) txns.push({ id: id(), type: 'expense', amount: 1549, category: 'Subscriptions', date: D(6), note: 'Netflix', created: '' });
    for (const d of [2, 5, 8]) if (d <= lim) txns.push({ id: id(), type: 'expense', amount: 6000, category: 'Groceries', date: D(d), note: 'Kroger', created: '' });
  }
  return { version: 1, events: [], reviews: [], tasks: [], finance: { txns, bills: [], budgets: { Groceries: 70000, Housing: 145000 }, goals: [{ id: 'g1', name: 'Vacation', target: 300000, deadline: '2027-06-01', created: '2026-09-01T00:00:00Z', contributions: [{ id: 'c', date: '2026-09-02', amount: 50000, note: '' }] }] } };
}
const pill = (app, c) => app.page.evaluate(c => [...document.querySelectorAll('.bg-row')].find(r => r.querySelector(`[data-c="${c}"]`)).querySelector('.pill').textContent, c);

module.exports = {
  async 'fixing a wrong starting balance removes the old number and its adjustment'() {
    // setup saved $178,332 instead of $1,783.32, then Reconcile added a -$176,548.68 adjustment
    const data = { version: 1, events: [], reviews: [], tasks: [], finance: { accounts: [{ id: 'chk', name: 'Checking', type: 'checking', onBudget: true, start: 17833200, created: '2026-11-09T12:00:00.000Z' }],
      txns: [{ id: 'adj1', type: 'adjust', accountId: 'chk', amount: 178332 - 17833200, date: '2026-11-09', payee: 'Balance adjustment', reviewed: true, created: '' }, { id: 'k1', type: 'expense', accountId: 'chk', amount: 4312, category: 'Groceries', date: '2026-11-09', payee: 'Kroger', reviewed: true, created: '' }], assign: {}, targets: {}, rules: [], bills: [], goals: [] } };
    const app = await open({ time: NOV9, data });
    await app.tab('finance');
    await app.page.click('[data-sub="accounts"]');
    app.dialogs.push('1783.32'); // the prompt; the "also remove the adjustment?" question is accepted too
    await app.page.click('[data-a="start"][data-id="chk"]'); await app.page.waitForTimeout(300);
    const f = (await app.data()).finance;
    assert.eq(f.accounts[0].start, 178332, 'starting balance replaced');
    assert.eq(f.txns.map(t => t.id), ['k1'], 'adjustment removed, spending kept');
    assert.eq(await app.page.evaluate(() => window.Budget.balance(window.Budget.accounts()[0])), 178332 - 4312, 'balance = start minus spending');
    assert.ok(!/\$17\d,\d{3}|\$178K|176,5/.test(await app.page.$eval('#finance', e => e.textContent)), 'the $178K is gone from the page');
    await app.page.click('[data-sub="budget"]');
    assert.eq(await app.page.$eval('.rta .v', e => e.textContent), '$1,783.32', 'budget starts from the corrected number');
    const snaps = await app.page.evaluate(() => window.Backup.snapshots());
    assert.ok(snaps.some(x => x.reason === 'before-balance-fix'), 'restore point with the old number kept');
    assert.noErrors(app); await app.close();
  },
  async 'setup reads 1783,32 as $1,783.32, not $178,332'() {
    const app = await open({ time: NOV9, onboard: true });
    await app.page.fill('#obMe', 'Keith'); await app.page.click('[data-ob="next"]');
    await app.page.fill('#obChk', '1783,32'); await app.page.click('[data-ob="next"]');
    await app.page.click('[data-ob="next"]'); await app.page.click('[data-ob="finish"]'); await app.page.waitForTimeout(200);
    assert.eq((await app.data()).finance.accounts[0].start, 178332);
    assert.noErrors(app); await app.close();
  },
  async 'reconciling a wrong starting balance also corrects Ready to Assign'() {
    // someone typed the wrong checking balance during setup, then reconciled to the real one
    const data = { version: 1, events: [], reviews: [], tasks: [], finance: { accounts: [{ id: 'chk', name: 'Checking', type: 'checking', onBudget: true, start: 500000, created: '2026-11-09T12:00:00.000Z' }], txns: [], assign: {}, targets: {}, rules: [], bills: [], goals: [] } };
    const app = await open({ time: NOV9, data });
    await app.page.evaluate(() => { localStorage.setItem('moneySub', 'budget'); });
    await app.tab('finance');
    assert.eq(await app.page.$eval('.rta .v', e => e.textContent), '$5,000.00', 'wrong setup number in the budget');
    await app.page.click('[data-sub="accounts"]');
    app.dialogs.push('1783.32');
    await app.page.click('[data-a="rec"][data-id="chk"]'); await app.page.waitForTimeout(200);
    assert.eq(await app.page.evaluate(() => window.Budget.balance(window.Budget.accounts()[0])), 178332, 'checking corrected');
    await app.page.click('[data-sub="budget"]');
    assert.eq(await app.page.$eval('.rta .v', e => e.textContent), '$1,783.32', 'Ready to Assign follows the corrected balance');
    assert.noErrors(app); await app.close();
  },
  async 'old data migrates without loss'() {
    const app = await open({ time: NOV9, data: legacy() });
    await app.tab('finance');
    const f = (await app.data()).finance;
    assert.eq(f.accounts.length, 1); assert.ok(f.txns.every(t => t.accountId && t.payee != null), 'every txn has an account');
    assert.eq(f.targets.Groceries, { type: 'monthly', amount: 70000 }, 'old limit became a target');
    assert.ok(await app.page.$('#sv-panel'), 'savings goals shown under the budget');
    assert.noErrors(app); await app.close();
  },
  async 'zero-based budget: ready to assign, fund targets, overspend, move'() {
    const app = await open({ time: NOV9, data: legacy() });
    await app.tab('finance');
    const rta0 = await app.page.$eval('.rta .v', e => e.textContent);
    await app.page.click('[data-b="fund"]');
    const asg = (await app.data()).finance.assign['2026-11'];
    assert.eq(asg, { Housing: 145000, Groceries: 70000 }, 'targets funded');
    assert.ok(rta0 !== await app.page.$eval('.rta .v', e => e.textContent), 'ready to assign went down');
    // Groceries spent $180 in Nov (3 x $60); assign only $100 -> overspent
    await app.page.fill('input[data-asg="Groceries"]', '100'); await app.page.dispatchEvent('input[data-asg="Groceries"]', 'change'); await app.page.waitForTimeout(150);
    assert.eq(await pill(app, 'Groceries'), '−$80.00', 'overspent shows negative');
    await app.page.click('.bg-row .n[data-c="Groceries"]');
    await app.page.fill('#mvAmt', '80'); await app.page.click('[data-b="move"][data-c="Groceries"]'); await app.page.waitForTimeout(150);
    assert.eq(await pill(app, 'Groceries'), '$0.00', 'covered from Ready to Assign');
    assert.noErrors(app); await app.close();
  },
  async 'income and spending buttons open the transaction form'() {
    const app = await open({ time: NOV9 });
    await app.tab('finance');
    await app.page.click('[data-b="income"]');
    assert.eq(await app.page.$eval('.seg .on', e => e.textContent), 'Money in');
    await app.page.fill('#ntPayee', 'Paycheck'); await app.page.fill('#ntAmt', '2425'); await app.page.click('[data-t="savenew"]');
    await app.page.click('.mn-tabs [data-sub="budget"]');
    assert.eq(await app.page.$eval('.rta .v', e => e.textContent), '$2,425.00');
    await app.page.click('.mn-tabs [data-sub="tx"]'); await app.page.click('[data-t="new"]');
    assert.ok(await app.page.$('#ntPayee'), '+ Transaction opens the form');
    assert.noErrors(app); await app.close();
  },
  async 'accounts, transfers and net worth'() {
    const app = await open({ time: NOV9 });
    await app.tab('finance'); await app.page.click('.mn-tabs [data-sub="accounts"]');
    const add = async (name, type, bal) => { await app.page.click('[data-a="new"]'); await app.page.fill('#anName', name); await app.page.selectOption('#anType', type); await app.page.fill('#anBal', bal); await app.page.click('[data-a="save"]'); };
    await add('Visa', 'credit', '1000'); await add('401k', 'investment', '50000'); await add('Car loan', 'loan', '15000');
    app.dialogs.push('5000'); await app.page.click('[data-a="rec"] >> nth=0'); await app.page.waitForTimeout(150);
    assert.eq(await app.page.$eval('.dz-hero', e => e.textContent), '$39,000', '5000 - 1000 + 50000 - 15000');
    await app.page.click('.mn-tabs [data-sub="tx"]'); await app.page.click('[data-t="xfer"]');
    await app.page.selectOption('#xfTo', { label: 'Visa' }); await app.page.fill('#xfAmt', '400'); await app.page.click('[data-t="savexfer"]');
    const bal = await app.page.evaluate(() => window.Budget.accounts().map(a => [a.name, window.Budget.balance(a)]));
    assert.eq(bal.slice(0, 2), [['Checking', 460000], ['Visa', -60000]], 'card payment moved money');
    assert.noErrors(app); await app.close();
  },
  async 'bank CSV import: columns, duplicates, categories, rules, splits'() {
    const csv = path.join(os.tmpdir(), `fs-bank-${process.pid}.csv`);
    fs.writeFileSync(csv, 'Posting Date,Description,Debit,Credit\n11/02/2026,"KROGER #1234 HOUSTON, TX",84.12,\n11/03/2026,NETFLIX.COM,15.49,\n11/04/2026,PAYROLL ACME,,2425.00\n11/06/2026,STARBUCKS STORE 0091,6.75,\n11/06/2026,TARGET T-1203,57.88,\n11/02/2026,"KROGER #1234 HOUSTON, TX",84.12,\n');
    const app = await open({ time: NOV9 });
    await app.tab('finance'); await app.page.click('.mn-tabs [data-sub="tx"]'); await app.page.click('[data-t="import"]');
    await app.page.setInputFiles('#csvFile', csv); await app.page.waitForTimeout(300);
    await app.page.click('[data-t="csvgo"]'); await app.page.waitForTimeout(200);
    assert.match(await app.page.$eval('#toast', e => e.textContent), /Imported 5, skipped 1 duplicate/);
    const cats = (await app.data()).finance.txns.filter(t => t.imported).map(t => t.category);
    assert.eq(cats, ['Groceries', 'Subscriptions', 'Paycheck', 'Dining', 'Shopping']);
    // fix a category and make it a rule
    const sb = await app.page.evaluate(() => data.finance.txns.find(t => t.payee.startsWith('STARBUCKS')).id);
    await app.page.click(`.tx[data-id="${sb}"]`); await app.page.selectOption('#edCat', 'Entertainment'); await app.page.check('#edRule'); await app.page.click('[data-t="saveedit"]');
    assert.eq((await app.data()).finance.rules.map(r => [r.match, r.category]), [['starbucks store', 'Entertainment']]);
    assert.eq(await app.page.evaluate(() => window.Budget.categorize('Starbucks Store 77', 'expense')), 'Entertainment', 'rule applies to new payees');
    // a split must add up
    const tg = await app.page.evaluate(() => data.finance.txns.find(t => t.payee.startsWith('TARGET')).id);
    await app.page.click(`.tx[data-id="${tg}"]`); await app.page.fill('#edSplit', 'Groceries 30\nShopping 20'); await app.page.click('[data-t="saveedit"]');
    assert.match(await app.page.$eval('#toast', e => e.textContent), /add up to \$50\.00, not \$57\.88/);
    await app.page.fill('#edSplit', 'Groceries 30\nShopping 27.88'); await app.page.click('[data-t="saveedit"]');
    assert.eq((await app.data()).finance.txns.find(t => t.id === tg).splits.length, 2);
    fs.unlinkSync(csv); assert.noErrors(app); await app.close();
  },
  async 'recurring detection, reports and bills with a calendar date'() {
    const app = await open({ time: NOV9, data: legacy() });
    await app.tab('finance'); await app.page.click('.mn-tabs [data-sub="recurring"]');
    const rec = await app.page.$$eval('.ac .t', e => e.map(x => x.textContent));
    assert.ok(rec.some(t => /Netflix/.test(t)) && rec.some(t => /Rent/.test(t)), 'found Netflix and Rent: ' + rec);
    await app.page.click('.mn-tabs [data-sub="reports"]'); await app.page.click('[data-m="prev"]');
    assert.match(await app.page.$eval('.dz-tile .v', e => e.textContent), /\$4,850/, 'October income');
    assert.ok(await app.page.$('svg[aria-label^="Cash flow"]'), 'cash flow chart drawn');
    await app.page.click('.mn-tabs [data-sub="budget"]'); await app.page.click('[data-bl="form"]');
    assert.eq(await app.page.$eval('#blDate', e => e.type), 'date', 'due date uses a calendar');
    await app.page.fill('#blName', 'Electric'); await app.page.fill('#blAmt', '140'); await app.page.fill('#blDate', '2026-11-22'); await app.page.click('[data-bl="save"]');
    assert.eq((await app.data()).finance.bills.map(b => [b.name, b.dueDay]), [['Electric', 22]]);
    assert.noErrors(app); await app.close();
  },
  async 'voice: spending, income, budget moves, savings'() {
    const app = await open({ time: NOV9, data: legacy() });
    const cases = {
      'spent 45 on groceries': /Expense: \$45\.00 · Groceries/,
      'got paid 2,100': /Income: \$2,100\.00 · Paycheck/,
      'move 50 from dining to groceries': /Budget: move \$50\.00 from Dining to Groceries/,
      'assign 200 to gas': /Budget: assign \$200\.00 to Gas/,
      'put 100 toward vacation': /Savings: \+\$100\.00 → Vacation/,
      'spent 45 minutes on the bike': /Bike · 45 min/,
    };
    for (const [say, re] of Object.entries(cases)) assert.match((await app.cmd(say)).join(' | '), re, say);
    assert.noErrors(app); await app.close();
  },
};
