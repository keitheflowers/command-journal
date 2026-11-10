// A tiny in-memory stand-in for the Supabase endpoints the app uses
// (auth, the household RPCs, the records table and the claude-proxy
// function). Shared between pages, so two "phones" can sync through it.
const URL_ = 'https://family.supabase.test';
function fakeSupabase() {
  const db = { users: [], households: [], members: [], records: [], ai: [] };
  let n = 0, clock = Date.parse('2026-11-10T12:00:00Z');
  const now = () => new Date(clock += 1000).toISOString().replace('Z', '+00:00'); // server time, always increasing
  const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: body === undefined ? '' : JSON.stringify(body) });
  const session = u => ({ access_token: 'tok-' + u.id, refresh_token: 'ref-' + u.id, expires_in: 3600, token_type: 'bearer', user: { id: u.id, email: u.email } });
  const who = req => db.users.find(u => req.headers()['authorization'] === 'Bearer tok-' + u.id);
  const member = (u, h) => db.members.some(m => m.user === u.id && m.household === h);
  async function handle(route) {
    const req = route.request(), url = new URL(req.url()), p = url.pathname, body = req.postData() ? JSON.parse(req.postData()) : null;
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (req.headers()['apikey'] !== 'anon-key') return json(route, 401, { message: 'No API key found in request' });
    if (p === '/auth/v1/signup') {
      if (db.users.some(u => u.email === body.email)) return json(route, 422, { msg: 'User already registered' });
      const u = { id: 'u' + (++n), email: body.email, pw: body.password }; db.users.push(u); return json(route, 200, session(u));
    }
    if (p === '/auth/v1/token') {
      const u = url.searchParams.get('grant_type') === 'password' ? db.users.find(x => x.email === body.email && x.pw === body.password) : db.users.find(x => 'ref-' + x.id === body.refresh_token);
      return u ? json(route, 200, session(u)) : json(route, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
    }
    const u = who(req); if (!u) return json(route, 401, { message: 'JWT expired' });
    if (p === '/rest/v1/rpc/create_household') { const h = { id: 'h' + (++n), name: body.p_name, invite_code: 'FAM' + n + 'XYZ' }; db.households.push(h); db.members.push({ user: u.id, household: h.id, role: 'owner' }); return json(route, 200, [h]); }
    if (p === '/rest/v1/rpc/join_household') { const h = db.households.find(x => x.invite_code === body.p_code); if (!h) return json(route, 400, { message: 'That invite code was not found' }); if (!member(u, h.id)) db.members.push({ user: u.id, household: h.id, role: 'member' }); return json(route, 200, [h]); }
    if (p === '/rest/v1/rpc/my_household') { const m = db.members.filter(x => x.user === u.id).at(-1); return json(route, 200, m ? [db.households.find(h => h.id === m.household)] : []); }
    if (p === '/rest/v1/records') {
      if (req.method() === 'POST') {
        for (const r of body) {
          if (!member(u, r.household_id)) return json(route, 403, { message: 'new row violates row-level security policy' });
          const i = db.records.findIndex(x => x.household_id === r.household_id && x.collection === r.collection && x.id === r.id);
          const row = { ...JSON.parse(JSON.stringify(r)), updated_by: u.id, updated_at: now() };
          if (i >= 0) db.records[i] = row; else db.records.push(row);
        }
        return json(route, 201);
      }
      const h = (url.searchParams.get('household_id') || '').replace('eq.', ''), since = (url.searchParams.get('updated_at') || '').replace('gte.', '');
      if (!member(u, h)) return json(route, 200, []);
      const off = +url.searchParams.get('offset') || 0, lim = +url.searchParams.get('limit') || 1000;
      const rows = db.records.filter(r => r.household_id === h && (!since || Date.parse(r.updated_at) >= Date.parse(since))).sort((a, b) => a.updated_at.localeCompare(b.updated_at));
      return json(route, 200, rows.slice(off, off + lim).map(({ collection, id, data, deleted, updated_at }) => ({ collection, id, data, deleted, updated_at })));
    }
    if (p.startsWith('/functions/v1/claude-proxy')) {
      if (!db.members.some(m => m.user === u.id)) return json(route, 403, { type: 'error', error: { type: 'permission_error', message: 'Create or join a family to use Vector AI.' } });
      db.ai.push({ user: u.id, path: p, headers: req.headers(), body });
      const text = db.aiReply ? db.aiReply(body) : '{"actions":[],"reply":"Hi from the family server."}';
      return json(route, 200, { id: 'msg', type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text }] });
    }
    return json(route, 404, { message: 'not found: ' + p });
  }
  return { db, url: URL_, routes: page => page.route(URL_ + '/**', handle), local: { fsSync: JSON.stringify({ url: URL_, anon: 'anon-key' }) } };
}
module.exports = { fakeSupabase };
