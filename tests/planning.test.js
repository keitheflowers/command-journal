const { open, assert, empty } = require('./harness');
const NOV22 = new Date(2026, 10, 22, 9, 0); // a Sunday
const pd = (base, n) => { const d = new Date(base); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

module.exports = {
  async 'adaptive targets: maintenance from intake vs weight trend'() {
    // 21 days at 2,500 cal while losing 0.5 lb/week -> maintenance ≈ 2,500 + 0.0714 x 3,500 = 2,750
    const logs = [];
    for (let i = 1; i <= 21; i++) logs.push({ id: 'm' + i, personId: 'me', date: pd(NOV22, -i), kind: 'meal', note: 'Food', calories: 2500, created: '' });
    for (const i of [21, 16, 11, 6, 1]) logs.push({ id: 'w' + i, personId: 'me', date: pd(NOV22, -i), kind: 'weight', value: +(200 - (21 - i) * 0.5 / 7).toFixed(2), created: '' });
    const me = { id: 'me', name: 'Keith', goals: {}, nutrition: { pattern: 'classic', slots: [{ id: 's1', name: 'Breakfast' }, { id: 's2', name: 'Lunch' }, { id: 's3', name: 'Dinner' }], fastGoal: 16, targets: { cal: 2500, p: 180, c: 250, f: 78 }, profile: { goal: -500, sex: 'male' } } };
    const app = await open({ time: NOV22, data: { ...empty(), fitness: { people: [me], logs } } });
    const r = await app.page.evaluate(() => window.Nutrition.checkIn('me'));
    assert.eq([r.ready, r.slopeWk, r.tdee, r.suggested], [true, -0.5, 2750, 2250]);
    await app.tab('meals');
    assert.match(await app.page.$eval('#meals', e => e.textContent), /Your real maintenance2,750 cal.*Suggested target2,250 cal/);
    await app.page.click('[data-nu="applyci"]');
    const t = (await app.data()).fitness.people[0].nutrition.targets;
    assert.eq([t.cal, t.p, t.f, t.c], [2250, 180, 70, 225], 'protein kept, fat 28%, carbs the rest');
    assert.noErrors(app); await app.close();
  },
  async 'adaptive targets: explains what is still needed'() {
    const app = await open({ time: NOV22, data: { ...empty(), fitness: { people: [{ id: 'me', name: 'Keith', goals: {} }], logs: [] } } });
    await app.tab('meals');
    assert.match(await app.page.$eval('#meals', e => e.textContent), /log food on 10 more days and weigh in 4 more times/);
    await app.close();
  },
  async 'weekly recap: money, tasks, training, nutrition, focus, voice'() {
    const sess = (id, date, w) => ({ id, personId: 'me', planId: null, name: 'Chest Day', date, created: id, exercises: [{ name: 'Bench', planned: [], actual: [{ w, r: 5 }] }] });
    const data = { ...empty(), tasks: [{ id: 't', title: 'Done thing', next: '', area: 'Vector AI', priority: 'Medium', scheduled: pd(NOV22, -2), due: '', notes: '', status: 'done', created: '', completed: pd(NOV22, -2) + 'T10:00:00Z', rollovers: 0 }],
      finance: { txns: [{ id: 'a', type: 'expense', amount: 12000, category: 'Groceries', date: pd(NOV22, -1), note: 'Kroger', created: '' }, { id: 'b', type: 'expense', amount: 4000, category: 'Dining', date: pd(NOV22, -3), note: 'Tacos', created: '' }, { id: 'c', type: 'expense', amount: 8000, category: 'Groceries', date: pd(NOV22, -9), note: 'Kroger', created: '' }], bills: [{ id: 'b1', name: 'Electric', amount: 14000, dueDay: 25, category: 'Utilities', paid: {} }] },
      fitness: { people: [{ id: 'me', name: 'Keith', goals: {}, nutrition: { pattern: 'classic', slots: [{ id: 's1', name: 'Breakfast' }], fastGoal: 16, targets: { cal: 2400, p: 180 }, profile: {} } }], logs: [{ id: 'm', personId: 'me', date: pd(NOV22, -1), kind: 'meal', note: 'Food', calories: 2300, protein: 120, created: '' }], plans: [], sessions: [sess('s0', pd(NOV22, -10), 225), sess('s1', pd(NOV22, -2), 235)] } };
    const app = await open({ time: NOV22, data });
    const r = await app.page.evaluate(() => window.Recap.build());
    const txt = r.sections.map(s => s[1] + ': ' + s[2]).join(' | ');
    assert.match(txt, /Money: You spent \$160 \(up 100% from the week before\), mostly Groceries \$120 and Dining \$40/);
    assert.match(txt, /Tasks: 1 task done/); assert.match(txt, /Training: 1 workout, 1,175 lb lifted\. New PRs: Bench! 🏆/);
    assert.match(txt, /Nutrition: Averaged 2,300 calories \(target 2,400\) and 120 g protein \(target 180\)/);
    assert.match(txt, /Next week: Bills: Electric \$140/);
    assert.ok(r.focus.some(f => /Hit protein: 180 g/.test(f)), 'focus includes protein: ' + r.focus);
    assert.ok(await app.page.$('#today #recapCard'), 'shown on Home on Sunday');
    await app.page.click('[data-rc="close"]'); await app.tab('today');
    assert.ok(!(await app.page.$('#today #recapCard')), 'dismissed for the week');
    await app.cmd('how was my week');
    assert.match(await app.page.evaluate(() => window.lastVectorReply), /^Here’s your week\. Money: You spent \$160/);
    assert.noErrors(app); await app.close();
  },
  async 'debt payoff: avalanche vs snowball vs minimums'() {
    const app = await open({ time: NOV22 });
    await app.tab('finance'); await app.page.click('.mn-tabs [data-sub="accounts"]');
    const add = async (name, type, bal) => { await app.page.click('[data-a="new"]'); await app.page.fill('#anName', name); await app.page.selectOption('#anType', type); await app.page.fill('#anBal', bal); await app.page.click('[data-a="save"]'); };
    await add('Visa', 'credit', '6200'); await add('Car loan', 'loan', '14800'); await add('Store card', 'credit', '900');
    await app.page.click('.mn-tabs [data-sub="debt"]');
    const ids = await app.page.evaluate(() => Object.fromEntries(window.Budget.accounts().map(a => [a.name, a.id])));
    const set = async (name, apr, min) => { await app.page.fill(`.db-apr[data-id="${ids[name]}"]`, String(apr)); await app.page.dispatchEvent(`.db-apr[data-id="${ids[name]}"]`, 'change'); await app.page.fill(`.db-min[data-id="${ids[name]}"]`, String(min)); await app.page.dispatchEvent(`.db-min[data-id="${ids[name]}"]`, 'change'); };
    await set('Visa', 24.99, 155); await set('Car loan', 6.9, 320); await set('Store card', 19.9, 35);
    await app.page.fill('#dbExtra', '300'); await app.page.dispatchEvent('#dbExtra', 'change');
    const [av, sb, mins] = await app.page.evaluate(() => [window.Budget.debtPlan(300, 'avalanche'), window.Budget.debtPlan(300, 'snowball'), window.Budget.debtPlan(0, 'avalanche', false)]);
    assert.ok(av.interest <= sb.interest, 'avalanche never costs more interest');
    assert.eq(av.order[0].name, 'Visa', 'avalanche pays the highest rate first'); assert.eq(sb.order[0].name, 'Store card', 'snowball pays the smallest first');
    assert.ok(mins.months > av.months && mins.interest > av.interest, 'extra payments save time and interest');
    const txt = await app.page.$eval('#finance', e => e.textContent);
    assert.match(txt, /Avalanche · highest rate first/); assert.match(txt, /Paying \$300 extra saves/);
    assert.noErrors(app); await app.close();
  },
  async 'first-run setup and legal pages'() {
    const app = await open({ time: NOV22, onboard: true });
    assert.ok(await app.page.$eval('#onboard', e => !e.hidden), 'setup shows on a brand-new app');
    await app.page.fill('#obMe', 'Keith'); await app.page.fill('#obFam', 'Amanda, Jordan'); await app.page.click('[data-ob="next"]');
    await app.page.fill('#obChk', '2,500'); await app.page.click('[data-ob="next"]');
    await app.page.click('[data-ob="pat"][data-v="six"]'); await app.page.click('[data-ob="next"]'); await app.page.click('[data-ob="finish"]');
    const d = await app.data();
    assert.eq(d.fitness.people.map(p => p.name), ['Keith', 'Amanda', 'Jordan']);
    assert.eq(d.fitness.people[0].nutrition.slots.length, 6);
    assert.eq(d.finance.accounts[0].start, 250000);
    for (const page of ['privacy.html', 'terms.html']) {
      const res = await app.page.request.get(new URL(page, app.page.url()).href);
      assert.ok(res.ok() && /Family Save/.test(await res.text()), page + ' loads');
    }
    assert.noErrors(app); await app.close();
  },
};
