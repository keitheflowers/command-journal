const { open, assert, empty } = require('./harness');
const NOV18 = new Date(2026, 10, 18, 9, 0);
const family = () => ({ ...empty(), fitness: { people: [{ id: 'me', name: 'Keith', goals: {} }, { id: 'am', name: 'Amanda', goals: {} }], logs: [], mealPlan: { '2026-11-18': { dinner: 'Salmon, rice & broccoli' } } } });

module.exports = {
  async 'fitness: voice logging for the family'() {
    const app = await open({ time: NOV18, data: family() });
    const cases = {
      'I ran 3 miles in 30 minutes': /Log for Keith: 🏃 Run · 30 min · 3 mi/,
      'Amanda walked 20 minutes': /Log for Amanda: 🚶 Walk · 20 min/,
      'I ran 5k': /Run · 3\.1 mi/,
      'I weigh 182.4': /⚖️ 182\.4 lb/,
      'drank 2 glasses of water': /💧 2 glasses/,
      'slept 7 and a half hours': /😴 7\.5 h/,
      'ate a turkey sandwich 450 calories and 30 grams of protein': /turkey sandwich · 450 cal · 30 g protein/,
      '10,000 steps': /10,000 steps/,
      'add task walk the dog for 20 minutes': /^Add: walk the dog/,
    };
    for (const [say, re] of Object.entries(cases)) assert.match((await app.cmd(say)).join(' | '), re, say);
    assert.eq(await app.cmd('I ran 2 miles and Amanda did yoga for 30 minutes'), ['Log for Keith: 🏃 Run · 2 mi · today', 'Log for Amanda: 🧘 Yoga · 30 min · today'], 'two people in one sentence');
    assert.eq((await app.cmd('add task buy milk and add task buy milk')).length, 1, 'exact repeats merge');
    await app.cmd('Amanda walked 20 minutes and I drank 2 glasses of water', true);
    const logs = (await app.data()).fitness.logs.map(l => l.personId + ':' + l.kind);
    assert.eq(logs, ['am:workout', 'me:water']);
    assert.noErrors(app); await app.close();
  },
  async 'grocery list: voice, sections, from the meal plan'() {
    const app = await open({ time: NOV18, data: family() });
    assert.match((await app.cmd('add milk, eggs and 2 lb chicken to the grocery list')).join(), /Grocery list: milk, eggs, 2 lb chicken/);
    assert.match((await app.cmd('we need to call mom')).join(), /Unrecognized/, 'not groceries');
    await app.cmd('add milk, eggs and 2 lb chicken to the grocery list', true);
    await app.tab('meals');
    await app.page.click('#gr-panel [data-gr="plan"][data-v="0"]'); await app.page.waitForTimeout(200);
    const items = (await app.data()).grocery.items.map(i => i.name + '/' + i.aisle);
    for (const want of ['Milk/Dairy & Eggs', 'Chicken/Meat & Seafood', 'Salmon/Meat & Seafood', 'Broccoli/Produce', 'Rice/Pantry']) assert.ok(items.includes(want), 'missing ' + want + ' in ' + items);
    assert.noErrors(app); await app.close();
  },
  async 'savings goals: create, contribute, overdraw blocked'() {
    const app = await open({ time: NOV18 });
    assert.match((await app.cmd('create a savings goal Christmas gifts 800 by December')).join(), /New savings goal: Christmas gifts · \$800\.00 · by Thu, Dec 31/);
    await app.cmd('create a savings goal Vacation 3,000 by June', true);
    await app.cmd('put 200 toward vacation', true);
    assert.match((await app.cmd('took 900 out of vacation')).join(), /Only \$200\.00 is saved/);
    assert.match((await app.cmd('put 100 toward the boat')).join(), /No savings goal called/);
    assert.eq((await app.data()).finance.goals[0].contributions.map(c => c.amount), [20000]);
    assert.noErrors(app); await app.close();
  },
  async 'strength: the set parser understands how people talk'() {
    const app = await open({ time: NOV18 });
    const P = t => app.page.evaluate(t => window.Strength.parseSets(t).map(e => e.name + ':' + e.sets.map(s => `${s.w}x${s.r}`).join(',')), t);
    assert.eq(await P('flat bench 225 15 reps 315 10 reps 405 8 reps'), ['Flat Bench:225x15,315x10,405x8']);
    assert.eq(await P('1st set was 225 for 10, 2nd set 315 for 8 and the third set was 405 for 6'), [':225x10,315x8,405x6']);
    assert.eq(await P('bench 3x10 at 185 then squats 315 5 sets of 5'), ['Bench:185x10,185x10,185x10', 'Squats:315x5,315x5,315x5,315x5,315x5']);
    assert.eq(await P('pull ups bodyweight 3 sets of 12 and dips 3 sets of 15'), ['Pull Ups:0x12,0x12,0x12', 'Dips:0x15,0x15,0x15']);
    assert.eq(await P('cable fly 50 x 15 x3'), ['Cable Fly:50x15,50x15,50x15']);
    assert.eq(await P('flat bench two twenty five for ten'), ['Flat Bench:225x10']);
    assert.eq(await P('lateral raises 25 for 15 three sets'), ['Lateral Raises:25x15,25x15,25x15']);
    assert.eq(await app.page.evaluate(() => ['Back Squat', 'Romanian Deadlift', 'Incline DB', 'Lat pulldown'].map(window.Strength.muscle)), ['Legs', 'Legs', 'Chest', 'Back']);
    await app.close();
  },
  async 'strength: plan vs actual, progress verdicts, PRs, next targets'() {
    const plan = { id: 'pc', personId: 'me', name: 'Chest Day', days: [3], exercises: [{ id: 'e', name: 'Flat Bench', sets: [{ w: 225, r: 10 }, { w: 315, r: 8 }] }, { id: 'f', name: 'Dips', sets: [{ w: 0, r: 15 }] }], created: '' };
    const old = { id: 's0', personId: 'me', planId: 'pc', name: 'Chest Day', date: '2026-11-11', created: 'a', exercises: [{ name: 'Flat Bench', planned: plan.exercises[0].sets, actual: [{ w: 225, r: 10 }, { w: 305, r: 8 }] }, { name: 'Dips', planned: [{ w: 0, r: 15 }], actual: [{ w: 0, r: 15 }] }] };
    const app = await open({ time: NOV18, data: { ...family(), fitness: { ...family().fitness, plans: [plan], sessions: [old] } } });
    const out = await app.cmd('I did chest day: flat bench 225 for 10, 315 for 8 and dips bodyweight 1 set of 10');
    assert.match(out.join(), /Flat Bench 225×10, 315×8 .*▲ Progress \+3% 🏆 PR/);
    assert.match(out.join(), /Dips BW×10 .*▼ Decline −33%/);
    await app.cmd('I did chest day: flat bench 225 for 10, 315 for 8 and dips bodyweight 1 set of 10', true);
    const R = await app.page.evaluate(() => { const s = window.Strength.sessions('me').at(-1); return window.Strength.analyze(s).map(r => [r.name, r.hit, r.next && r.next.sets.map(x => x.w)]); });
    assert.eq(R, [['Flat Bench', 2, [230, 320]], ['Dips', 0, [0]]], 'all sets hit -> +5 lb; missed -> hold');
    assert.noErrors(app); await app.close();
  },
  async 'strength: program library installs weights from 1-rep maxes'() {
    const app = await open({ time: NOV18, data: family() });
    await app.page.evaluate(() => { const pr = window.Strength.PROGRAMS.find(p => p.id === 'bro7'); window.Strength.installProgram('me', pr, { B: 300, S: 400, D: 450, P: 180 }); });
    const plans = await app.page.evaluate(() => window.Strength.plans('me').map(p => [p.name, p.days[0], p.exercises[0].name, p.exercises[0].sets.map(s => s.w + 'x' + s.r).join(',')]));
    assert.eq(plans[0], ['Chest Day', 1, 'Flat Bench Press', '180x12,210x10,230x8,245x6']);
    assert.eq(plans.length, 7); assert.eq(plans.map(p => p[1]), [1, 2, 3, 4, 5, 6, 0]);
    await app.close();
  },
};
