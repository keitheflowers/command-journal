const { open, assert, empty } = require('./harness');
const NOV12 = new Date(2026, 10, 12, 9, 0);
const URL_ = 'https://vector.home.test';
const NULLS = { kind: null, title: null, task_id: null, date: null, due: null, priority: null, area: null, money_type: null, amount: null, category: null, note: null, bill_id: null, person: null, fit_type: null, activity: null, minutes: null, miles: null, value: null, calories: null, protein: null, meal_slot: null, goal_id: null, aisle: null, weekdays: null, exercises: null };
const A = o => ({ ...NULLS, ...o });

// a fake home server: OpenAI-compatible chat + models, or a custom Vector API
function home({ mode = 'openai', fail = false, rejectSchema = false } = {}) {
  const seen = [];
  const routes = page => page.route(URL_ + '/**', async route => {
    const req = route.request(), body = req.postData() ? JSON.parse(req.postData()) : null, path = new URL(req.url()).pathname;
    const reply = (status, obj) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(obj) });
    if (fail) return route.abort('connectionrefused');
    seen.push({ path, headers: req.headers(), body });
    if (req.headers()['authorization'] !== 'Bearer home-secret-123') return reply(401, { error: { message: 'Wrong key' } });
    if (path === '/v1/models') return reply(200, { data: [{ id: 'qwen3.5' }, { id: 'qwen3.5:32b' }] });
    if (mode === 'vector' && path === '/family') return reply(200, { reply: 'On it.', actions: [A({ kind: 'add_task', title: 'Call mom', date: '2026-11-13' })] });
    if (path === '/v1/chat/completions') {
      if (rejectSchema && body.response_format && body.response_format.type === 'json_schema') return reply(400, { error: { message: 'response_format not supported' } });
      const content = '<think>The user wants a task for tomorrow.</think>\n```json\n' + JSON.stringify({ reply: '', actions: [A({ kind: 'add_task', title: 'Call mom', date: '2026-11-13' })] }) + '\n```';
      return reply(200, { id: 'x', object: 'chat.completion', model: body.model, choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }] });
    }
    return reply(404, { error: { message: 'nope' } });
  });
  return { routes, seen };
}
const setServer = (app, v) => app.page.evaluate(v => window.VectorAI.server.set(v), v);

module.exports = {
  async 'Vector home server: answers first, Qwen-style thinking ignored, labeled'() {
    const h = home();
    const app = await open({ time: NOV12, routes: h.routes });
    await app.tab('settings');
    await app.page.fill('#vsUrl', URL_); await app.page.fill('#vsModel', 'qwen3.5'); await app.page.fill('#vsKey', 'home-secret-123');
    await app.page.click('[data-vs="save"]');
    await app.page.click('[data-vs="test"]');
    await app.page.waitForFunction(() => /✓|✗/.test(document.getElementById('vsStatus').textContent));
    assert.match(await app.page.$eval('#vsStatus', e => e.textContent), /✓ Working/);
    const items = await app.cmd('remind me to call my mom tomorrow');
    assert.match(items.join(' '), /Add: Call mom · tomorrow/);
    assert.match(await app.page.$eval('#commandPreview', e => e.textContent), /🏠 Vector \(home server\)/);
    const chat = h.seen.filter(s => s.path === '/v1/chat/completions').at(-1);
    assert.eq(chat.body.model, 'qwen3.5'); assert.eq(chat.body.response_format.type, 'json_schema');
    assert.match(chat.body.messages[1].content, /REQUEST:\nremind me to call my mom tomorrow/);
    assert.ok(!app.requests.length, 'nothing went to Anthropic');
    assert.noErrors(app); await app.close();
  },

  async 'Vector home server: schema rejected -> retries; custom Vector API works'() {
    const h = home({ rejectSchema: true });
    let app = await open({ time: NOV12, routes: h.routes });
    await setServer(app, { on: true, url: URL_, mode: 'openai', model: 'qwen3.5', key: 'home-secret-123' });
    assert.match((await app.cmd('remind me to call my mom tomorrow')).join(' '), /Call mom/);
    assert.eq(h.seen.filter(s => s.path === '/v1/chat/completions').map(s => s.body.response_format && s.body.response_format.type), ['json_schema', 'json_object']);
    await app.close();
    const v = home({ mode: 'vector' });
    app = await open({ time: NOV12, routes: v.routes });
    await setServer(app, { on: true, url: URL_ + '/family', mode: 'vector', key: 'home-secret-123' });
    assert.match((await app.cmd('remind me to call my mom tomorrow')).join(' '), /Call mom/);
    const req = v.seen.at(-1).body;
    assert.eq([req.app, req.text, typeof req.context.TODAY, typeof req.schema], ['family-save', 'remind me to call my mom tomorrow', 'string', 'object']);
    assert.noErrors(app); await app.close();
  },

  async 'Vector home server down: Claude answers, then built-in rules; http address explained'() {
    const h = home({ fail: true });
    const app = await open({ time: NOV12, routes: h.routes, ai: () => ({ json: { reply: '', actions: [A({ kind: 'add_task', title: 'Call mom', date: '2026-11-13' })] } }) });
    await setServer(app, { on: true, url: URL_, mode: 'openai', model: 'qwen3.5', key: 'home-secret-123' });
    await app.cmd('remind me to call my mom tomorrow');
    assert.match(await app.page.$eval('#commandPreview', e => e.textContent), /✨ Claude \(Vector didn’t answer\).*Can’t reach Vector/);
    assert.eq(app.requests.length, 1, 'Claude was the backup');
    // Claude off too: built-in rules
    await app.page.evaluate(() => localStorage.setItem('vectorAiOn', ''));
    assert.match((await app.cmd('add call mom tomorrow')).join(' '), /Add: call mom · tomorrow/i);
    assert.match(await app.page.$eval('#commandPreview', e => e.textContent), /Vector AI didn’t answer: Can’t reach Vector/);
    // an http:// address can't work from the secure app
    assert.eq(await app.page.evaluate(() => [window.VectorAI.server.blocked('http://192.168.1.50:11434', 'https:'), window.VectorAI.server.blocked('https://vector.tailnet.ts.net', 'https:'), window.VectorAI.server.blocked('http://localhost:11434', 'https:')]), [true, false, false]);
    await app.close();
  },
};
