const { open, assert, empty } = require('./harness');
const MORNING = new Date(2026, 10, 18, 8, 0); // Wed 8:00 am
const fam = () => ({ ...empty(), fitness: { people: [{ id: 'me', name: 'Keith', goals: { activeMin: 150, water: 8, sleep: 8 } }, { id: 'am', name: 'Amanda', goals: {} }], logs: [] } });
const slotNames = app => app.page.$$eval('#meals .nu-slot .h b', b => b.map(x => x.textContent));

module.exports = {
  async 'eating patterns: 3 meals, 6 small meals, one meal a day, custom'() {
    const app = await open({ time: MORNING, data: fam() });
    await app.tab('meals');
    assert.eq(await slotNames(app), ['Breakfast', 'Lunch', 'Dinner']);
    await app.page.click('[data-nu="pattern"]'); await app.page.click('[data-nu="setpat"][data-v="six"]');
    assert.eq(await slotNames(app), ['Meal 1', 'Meal 2', 'Meal 3', 'Meal 4', 'Meal 5', 'Meal 6']);
    assert.eq(await app.page.$$eval('#nu-plan .nu-day >> nth=0', d => d[0].querySelectorAll('button').length), 6, 'plan follows the pattern');
    await app.page.click('[data-nu="pattern"]'); await app.page.click('[data-nu="setpat"][data-v="omad"]');
    assert.eq(await slotNames(app), ['The meal']);
    assert.match(await app.page.$eval('#meals .fa-goals .on', e => e.textContent), /23h/, 'OMAD sets a 23h fast goal');
    await app.page.click('[data-nu="pattern"]'); await app.page.click('[data-nu="setpat"][data-v="custom"]');
    await app.page.fill('#nuCustom', 'Pre-workout, Post-workout, Dinner'); await app.page.click('[data-nu="savecustom"]');
    assert.eq(await slotNames(app), ['Pre-workout', 'Post-workout', 'Dinner']);
    assert.noErrors(app); await app.close();
  },
  async 'targets calculator and food logging with macros'() {
    const app = await open({ time: MORNING, data: fam() });
    await app.tab('meals');
    await app.page.click('[data-nu="targets"]');
    await app.page.fill('#pfAge', '35'); await app.page.fill('#pfFt', '5'); await app.page.fill('#pfIn', '10'); await app.page.fill('#pfWt', '180');
    await app.page.selectOption('#pfAct', '1.55'); await app.page.selectOption('#pfGoal', '0'); await app.page.selectOption('#pfPro', '0.8');
    await app.page.click('[data-nu="calc"]');
    // Mifflin-St Jeor: 10*81.65 + 6.25*177.8 - 5*35 + 5 = 1758 x 1.55 = 2724 -> 2720 cal; 144 P; 85 F; 345 C
    assert.eq((await app.data()).fitness.people[0].nutrition.targets, { cal: 2720, p: 144, c: 345, f: 85 });
    await app.page.click('[data-nu="add"][data-s="s1"]'); await app.page.click('[data-nu="addtab"][data-v="foods"]');
    await app.page.fill('.nu-qty[data-i="0"]', '3'); await app.page.click('[data-nu="addcommon"][data-i="0"]'); // 3 eggs
    const meal = (await app.data()).fitness.logs.find(l => l.kind === 'meal');
    assert.eq([meal.note, meal.calories, meal.protein, meal.slot], ['3 × Egg, large', 216, 18, 's1']);
    assert.match(await app.page.$eval('#meals .nu-macros', e => e.textContent), /216\s*Calories \/ 2720/);
    await app.page.click('[data-nu="addtab"][data-v="recent"]');
    assert.match(await app.page.$eval('.nu-sheet', e => e.textContent), /3 × Egg, large/, 'recent foods for one-tap re-adding');
    assert.noErrors(app); await app.close();
  },
  async 'fasting timer: start, progress, end, streak'() {
    const app = await open({ time: new Date(2026, 10, 17, 20, 0), data: fam() });
    await app.tab('meals');
    await app.page.click('[data-nu="goal"][data-v="16"]'); await app.page.click('[data-nu="startfast"]');
    assert.match(await app.page.$eval('#faT', e => e.textContent), /^0:00$/);
    await app.page.clock.fastForward('17:00:00'); await app.tab('meals');
    assert.match(await app.page.$eval('#faS', e => e.textContent), /Goal reached/);
    await app.page.click('[data-nu="endfast"]');
    const st = await app.page.evaluate(() => window.Nutrition.fastStats('me'));
    assert.eq([st.streak, st.done7, Math.round(st.avg7)], [1, 1, 17]);
    assert.noErrors(app); await app.close();
  },
  async 'voice: fasting and meals go to the right slot'() {
    const app = await open({ time: MORNING, data: fam() });
    assert.eq(await app.cmd('start my 18 hour fast'), ['Fasting: start a 18h fast for Keith']);
    assert.eq(await app.cmd('Amanda started fasting'), ['Fasting: start a 16h fast for Amanda']);
    assert.match((await app.cmd('end my fast')).join(), /isn’t fasting/);
    await app.cmd('start my 18 hour fast', true);
    assert.eq(await app.cmd('end my fast'), ['Fasting: end Keith’s fast']);
    await app.cmd('ate 2 eggs and toast 300 calories and 18 grams of protein', true);
    const m = (await app.data()).fitness.logs.find(l => l.kind === 'meal');
    assert.eq([m.slot, m.calories, m.protein], ['s1', 300, 18], '8 am -> breakfast');
    assert.noErrors(app); await app.close();
  },
  async 'AI: meal plan follows each person’s pattern; estimates include carbs and fat'() {
    const A = o => Object.assign({ kind: null, title: null, task_id: null, date: null, due: null, priority: null, area: null, money_type: null, amount: null, category: null, note: null, bill_id: null, person: null, fit_type: null, activity: null, minutes: null, miles: null, value: null, calories: null, protein: null, meal_slot: null, carbs: null, fat: null, goal_id: null, aisle: null, weekdays: null, exercises: null }, o);
    let ctx;
    const app = await open({ time: MORNING, data: fam(), ai: body => { ctx = JSON.parse(body.messages[0].content.split('CONTEXT:\n')[1].split('\n\n')[0]);
      return /ESTIMATE REQUEST/.test(body.messages[0].content) ? { json: { reply: '', actions: [A({ kind: 'fitness', fit_type: 'meal', note: 'Oatmeal with banana', calories: 350, protein: 10, carbs: 65, fat: 6 })] } }
        : { json: { reply: '', actions: [A({ kind: 'meal_plan', person: 'Keith', date: '2026-11-19', meal_slot: 's4', note: 'Greek yogurt & berries' })] } }; } });
    await app.page.evaluate(() => { const n = window.Nutrition.N('me'); n.pattern = 'six'; n.slots = [1, 2, 3, 4, 5, 6].map(i => ({ id: 's' + i, name: 'Meal ' + i, time: '' })); });
    assert.eq(await app.cmd('plan a high protein meal 4 for tomorrow'), ['Meal plan for Keith: Meal 4 tomorrow · Greek yogurt & berries']);
    assert.eq(ctx.PEOPLE[0].meal_slots.length, 6, 'AI sees the 6 slots');
    await app.cmd('plan a high protein meal 4 for tomorrow', true);
    assert.eq((await app.data()).fitness.plans2.me['2026-11-19'], { s4: 'Greek yogurt & berries' });
    await app.tab('meals'); await app.page.click('[data-nu="add"][data-s="s1"]'); await app.page.click('[data-nu="addtab"][data-v="ai"]');
    await app.page.fill('#aiFood', 'bowl of oatmeal with a banana'); await app.page.click('[data-nu="estimate"]'); await app.page.waitForTimeout(300);
    assert.eq(await app.page.$$eval('#cuName,#cuCal,#cuP,#cuC,#cuF', e => e.map(x => x.value)), ['Oatmeal with banana', '350', '10', '65', '6'], 'estimate prefilled for review');
    assert.noErrors(app); await app.close();
  },
  async 'USDA food search: parses results (mocked API)'() {
    const app = await open({ time: MORNING, data: fam() });
    await app.page.route('https://api.nal.usda.gov/**', r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ foods: [
      { description: 'YOGURT, GREEK, PLAIN, NONFAT', foodNutrients: [{ nutrientId: 1003, nutrientNumber: '203', nutrientName: 'Protein', unitName: 'G', value: 10.3 }, { nutrientId: 1004, nutrientNumber: '204', nutrientName: 'Total lipid (fat)', unitName: 'G', value: 0.37 }, { nutrientId: 1005, nutrientNumber: '205', nutrientName: 'Carbohydrate, by difference', unitName: 'G', value: 3.64 }, { nutrientId: 1062, nutrientNumber: '268', nutrientName: 'Energy', unitName: 'kJ', value: 247 }, { nutrientId: 2047, nutrientNumber: '957', nutrientName: 'Energy (Atwater General Factors)', unitName: 'KCAL', value: 59 }] }] }) }));
    await app.tab('meals'); await app.page.click('[data-nu="add"][data-s="s1"]'); await app.page.click('[data-nu="addtab"][data-v="usda"]');
    await app.page.fill('#usQ', 'greek yogurt'); await app.page.click('[data-nu="usda"]'); await app.page.waitForTimeout(300);
    assert.match(await app.page.$eval('.nu-sheet', e => e.textContent), /Yogurt, greek, plain, nonfat.*59 cal · 10P 4C 0F/, 'kcal (not kJ) from Atwater energy');
    await app.page.fill('.nu-g[data-i="0"]', '170'); await app.page.click('[data-nu="addusda"][data-i="0"]');
    const m = (await app.data()).fitness.logs.find(l => l.kind === 'meal');
    assert.eq([m.calories, m.protein], [100, 18], '170 g scaled from per-100 g');
    assert.noErrors(app); await app.close();
  },
  async 'training: rest timer on set complete, plate calculator'() {
    const plan = { id: 'p', personId: 'me', name: 'Chest Day', days: [3], exercises: [{ id: 'e', name: 'Flat Bench', sets: [{ w: 225, r: 5 }, { w: 205, r: 8 }] }], created: '' };
    const app = await open({ time: MORNING, data: { ...fam(), fitness: { ...fam().fitness, plans: [plan], sessions: [] } } });
    assert.eq(await app.page.evaluate(() => [225, 205, 315, 135, 45].map(w => window.Strength.plates(w))), ['per side: 45 + 45', 'per side: 45 + 35', 'per side: 45 + 45 + 45', 'per side: 45', 'just the bar']);
    await app.tab('strength'); await app.page.click('[data-st="start"][data-id="p"]');
    assert.match(await app.page.$eval('.st-plates', e => e.textContent), /45 \+ 45/);
    await app.page.click('[data-st="done"][data-e="0"][data-s="0"]');
    assert.match(await app.page.$eval('#restBar', e => e.hidden ? '' : e.textContent), /Rest2:30/, '5 reps -> 2:30 rest');
    await app.page.clock.fastForward(151000); await app.page.waitForTimeout(400);
    assert.ok(await app.page.$eval('#restBar', e => e.hidden), 'timer finishes');
    assert.noErrors(app); await app.close();
  },
  async 'health overview: today’s rings and what’s planned'() {
    const plan = { id: 'p', personId: 'me', name: 'Chest Day', days: [3], exercises: [{ id: 'e', name: 'Bench', sets: [{ w: 135, r: 10 }] }], created: '' };
    const app = await open({ time: MORNING, data: { ...fam(), fitness: { ...fam().fitness, plans: [plan], sessions: [], logs: [{ id: 'w', personId: 'me', date: '2026-11-18', kind: 'water', value: 4, created: '' }] } } });
    await app.tab('fitness');
    const head = await app.page.$eval('#fitness .panel', e => e.textContent);
    assert.match(head, /Keith · today/); assert.match(head, /Water4\/8 gl/); assert.match(head, /Chest Day is planned today/);
    assert.noErrors(app); await app.close();
  },
};
