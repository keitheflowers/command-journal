const { open, assert, task } = require('./harness');
const NOV18 = new Date(2026, 10, 18, 10, 0); // a Wednesday

module.exports = {
  async 'every tab opens without errors and nothing blocks taps'() {
    const app = await open({ time: NOV18 });
    const tabs = await app.page.$$eval('#tabs .tab', b => b.map(x => x.dataset.view));
    assert.ok(tabs.length >= 9, 'expected all tabs, got ' + tabs.join(','));
    for (const v of tabs) {
      await app.page.click(`#tabs [data-view="${v}"]`, { timeout: 3000 }); // fails if an overlay intercepts
      assert.ok(await app.page.$eval('#' + v, e => !e.classList.contains('hidden')), v + ' did not open');
    }
    assert.eq(await app.page.evaluate(() => document.documentElement.scrollWidth), 390, 'page scrolls sideways');
    assert.ok(await app.page.$eval('#lockScreen', e => getComputedStyle(e).display === 'none'), 'lock screen covers the app');
    assert.noErrors(app); await app.close();
  },
  async 'app name, version and header'() {
    const app = await open();
    assert.eq(await app.page.title(), 'The Family Save');
    assert.eq(await app.page.$eval('h1', e => e.textContent), 'The Family Save');
    await app.close();
  },
  async 'tasks: voice dates and multiple actions'() {
    const app = await open({ time: NOV18, data: { version: 1, events: [], reviews: [], tasks: [task('Call the bank', '2026-11-18')] } });
    const cases = {
      'add task dentist Friday high priority': /Add: dentist · Fri, Nov 20 · High priority/,
      'add task pay rent December 1st': /Add: pay rent · Tue, Dec 1/,
      'add task renew license in 3 days': /Sat, Nov 21/,
      'add task submit report due Friday': /today · due Fri, Nov 20/,
      'move call the bank to Monday': /Move to Mon, Nov 23: Call the bank/,
      'complete task call the bank': /Complete: Call the bank/,
    };
    for (const [say, re] of Object.entries(cases)) assert.match((await app.cmd(say)).join(' | '), re, say);
    const two = await app.cmd('add task buy milk and add task call mom tomorrow');
    assert.eq(two.length, 2, 'two actions');
    await app.cmd('add task dentist Friday', true);
    const d = await app.data();
    assert.ok(d.tasks.some(t => t.title === 'dentist' && t.scheduled === '2026-11-20'), 'task saved on Friday');
    assert.noErrors(app); await app.close();
  },
  async 'calendar lists tasks for a day and a week'() {
    const app = await open({ time: NOV18, data: { version: 1, events: [], reviews: [], tasks: [task('Gym', '2026-11-18'), task('Pay rent', '2026-11-20')] } });
    await app.tab('calendar');
    await app.page.click('[data-day="2026-11-20"]');
    assert.match(await app.page.$eval('#calList', e => e.textContent), /Pay rent/);
    await app.page.click('.cal-wk >> nth=2');
    const wk = await app.page.$eval('#calList', e => e.textContent);
    assert.match(wk, /Gym/); assert.match(wk, /Pay rent/);
    await app.close();
  },
  async 'hands-free: wake, instruct, read back, confirm, keep listening, end'() {
    const app = await open({ time: NOV18, speech: true });
    await app.say('Vector open family save');
    assert.match(await app.page.$eval('#wakePill', e => e.textContent), /Listening/);
    await app.say('add task call the plumber tomorrow', 1600);
    assert.match(await app.lastSaid(), /call the plumber, tomorrow/);
    await app.say('confirm', 500);
    assert.match(await app.lastSaid(), /What else\?/);
    assert.ok((await app.data()).tasks.some(t => t.title === 'call the plumber'), 'task saved');
    await app.say('what else', 1600); // Journal's own words echoing back are ignored
    assert.eq((await app.data()).tasks.length, 1);
    await app.say("that's all", 300);
    assert.match(await app.page.$eval('#wakePill', e => e.textContent), /Vector, open/);
    assert.noErrors(app); await app.close();
  },
};
