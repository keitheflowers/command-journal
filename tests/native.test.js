const { open, assert, empty, task } = require('./harness');
const NOV10 = new Date(2026, 10, 10, 6, 0); // Tuesday 6 AM

// Pretend to be the Android app: a fake Capacitor with the plugins native.js uses.
const fakeAndroid = page => page.addInitScript(() => {
  window.__calls = [];
  const rec = name => new Proxy({}, { get: (_, m) => m === 'then' ? undefined : (...a) => { window.__calls.push([name, m, a[0]]); return Promise.resolve(window.__answers?.[name + '.' + m] ?? {}); } });
  window.__answers = {
    'SpeechRecognition.checkPermissions': { speechRecognition: 'granted' },
    'SpeechRecognition.start': { matches: ['add milk to the grocery list'] },
    'LocalNotifications.getPending': { notifications: [] },
    'LocalNotifications.checkPermissions': { display: 'granted' },
    'WakeWord.status': { running: false, canOpenFromBackground: false },
  };
  const plugins = {};
  window.Capacitor = { isNativePlatform: () => true, registerPlugin: n => plugins[n] || (plugins[n] = rec(n)) };
});

module.exports = {
  async 'reminders: bills, tasks, workouts and fasting goals'() {
    const data = { ...empty(), tasks: [task('Call the dentist', '2026-11-10'), task('Renew tags', '2026-11-12', { due: '2026-11-12' })],
      finance: { txns: [], bills: [{ id: 'b1', name: 'Electric', amount: 14000, dueDay: 13, category: 'Utilities', paid: {} }, { id: 'b2', name: 'Rent', amount: 150000, dueDay: 1, category: 'Housing', paid: { '2026-12': 'tx' } }] },
      fitness: { people: [{ id: 'me', name: 'Keith', goals: {} }], logs: [], plans: [{ id: 'p1', personId: 'me', name: 'Chest Day', days: [3], exercises: [{ id: 'e', name: 'Bench', sets: [{ w: 225, r: 5 }] }] }], sessions: [] } };
    const app = await open({ time: NOV10, data });
    const plan = await app.page.evaluate(() => window.Native.plan().map(n => [n.title, n.body, new Date(n.at).toString().slice(0, 21)]));
    const has = (title, body) => assert.ok(plan.some(n => n[0] === title && n[1].includes(body)), `${title} / ${body} in ${JSON.stringify(plan)}`);
    has('Bill due Friday', 'Electric $140 is due Friday'); has('Bill due today', 'Electric $140');
    has('1 task today', 'Call the dentist'); has('1 task today', 'Renew tags');
    has('Today: Chest Day', 'Bench');
    assert.ok(!plan.some(n => /Rent/.test(n[1])), 'December rent already paid, November past: no rent reminders');
    assert.eq(plan.find(n => n[1].includes('Call the dentist'))[2], 'Tue Nov 10 2026 08:00', 'tasks at 8 AM');
    assert.ok(!(await app.page.$('#nativePanel')), 'no phone panel in a browser');
    assert.noErrors(app); await app.close();
  },

  async 'Android app: voice uses the phone recognizer and voice; phone settings show'() {
    const app = await open({ time: NOV10, routes: fakeAndroid });
    // the voice code gets a working SpeechRecognition backed by the plugin
    const heard = await app.page.evaluate(() => new Promise(res => { const r = new window.SpeechRecognition(); r.onresult = e => res(e.results[0][0].transcript + '|' + e.results[0].isFinal); r.start(); }));
    assert.eq(heard, 'add milk to the grocery list|true');
    await app.page.evaluate(() => { const u = new SpeechSynthesisUtterance('Saved.'); u.rate = 1.2; speechSynthesis.speak(u); });
    await app.page.waitForTimeout(50);
    const calls = await app.page.evaluate(() => window.__calls);
    assert.ok(calls.some(c => c[0] === 'TextToSpeech' && c[1] === 'speak' && c[2].text === 'Saved.'), 'spoke through the phone');
    await app.tab('settings');
    const txt = await app.page.$eval('#nativePanel', e => e.textContent);
    assert.match(txt, /Turn on reminders/); assert.match(txt, /Connect Health Connect/); assert.match(txt, /Hey Vector/);
    await app.page.click('[data-nx="non"]'); await app.page.waitForTimeout(100);
    assert.match(await app.page.$eval('#nativePanel', e => e.textContent), /Turn reminders off/);
    assert.noErrors(app); await app.close();
  },

  async 'Health Connect import: steps, weight, sleep, workouts without duplicates'() {
    const app = await open({ time: NOV10, routes: fakeAndroid, data: { ...empty(), fitness: { people: [{ id: 'me', name: 'Keith', goals: {} }], logs: [] } } });
    await app.page.evaluate(() => Object.assign(window.__answers, {
      'Health.isAvailable': { available: true }, 'Health.requestAuthorization': { readAuthorized: ['steps', 'weight', 'sleep', 'workouts'] },
      'Health.queryAggregated': { samples: [{ startDate: '2026-11-09T06:00:00.000Z', endDate: '2026-11-10T06:00:00.000Z', value: 9123.4 }] },
      'Health.readSamples': { samples: [{ dataType: 'weight', value: 90, unit: 'kilogram', startDate: '2026-11-09T13:00:00.000Z', endDate: '2026-11-09T13:00:00.000Z' }] },
      'Health.queryWorkouts': { workouts: [{ workoutType: 'strengthTraining', duration: 3600, startDate: '2026-11-09T17:00:00.000Z', endDate: '2026-11-09T18:00:00.000Z', platformId: 'abc' }] },
    }));
    await app.tab('settings'); await app.page.click('[data-nx="hon"]'); await app.page.waitForTimeout(150);
    let logs = (await app.data()).fitness.logs;
    const kinds = logs.map(l => l.kind + ':' + (l.value ?? l.activity + ' ' + l.minutes)).sort();
    assert.ok(kinds.includes('steps:9123') && kinds.includes('weight:198.4') && kinds.includes('workout:Strength Training 60'), JSON.stringify(kinds));
    await app.page.evaluate(() => window.Native.importHealth(14));
    assert.eq((await app.data()).fitness.logs.length, logs.length, 'importing again adds nothing');
    assert.noErrors(app); await app.close();
  },
};
