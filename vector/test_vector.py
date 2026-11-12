"""Tests for the Vector bridge, against a small fake Supabase served over HTTP.

    python3 -m unittest discover -s vector -p 'test_*.py' -v
"""
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import familysave  # noqa: E402
import tools  # noqa: E402
from familysave import Client, FamilySaveError  # noqa: E402

# The exact field sets the app writes (index.html, finance.js, grocery.js, fitness.js, savings.js),
# so a record from Vector is indistinguishable from one made on a phone.
TASK_KEYS = {'id', 'title', 'next', 'area', 'priority', 'scheduled', 'due', 'notes', 'status', 'created', 'completed', 'rollovers'}
TXN_KEYS = {'id', 'type', 'amount', 'category', 'date', 'note', 'payee', 'accountId', 'who', 'reviewed', 'billId', 'created'}
MORNING_KEYS = {'id', 'date', 'type', 'timestamp', 'goal', 'notes'}
EVENING_KEYS = {'id', 'date', 'type', 'timestamp', 'wins', 'lessons', 'tomorrowFirst', 'carried'}
GROCERY_KEYS = {'id', 'name', 'qty', 'aisle', 'checked', 'source', 'added'}


class FakeSupabase:
    """Auth (password + refresh), my_household and the records table, like tests/fakesupabase.js."""

    def __init__(self):
        self.users = {'keith@example.com': {'id': 'u1', 'pw': 'correct horse'}}
        self.households = {'h1': {'id': 'h1', 'name': 'The Flowers', 'invite_code': 'FAM1XYZ'}}
        self.members = [('u1', 'h1')]
        self.records = []  # dicts: household_id, collection, id, data, deleted, updated_at, updated_by
        self.requests = []
        self.token_ttl = 3600
        self.lock = threading.Lock()
        self.clock = 1_700_000_000.0

    def now(self):
        # server time, always increasing, in Postgres' format (compares as text like the phone does)
        self.clock += 1
        return time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime(self.clock)) + '.000000+00:00'

    def seed(self, collection, item, household='h1'):
        with self.lock:
            self.records.append({'household_id': household, 'collection': collection, 'id': str(item['id']), 'data': item,
                                 'deleted': False, 'updated_at': self.now(), 'updated_by': 'phone'})

    def rows(self, collection):
        return [r['data'] for r in self.records if r['collection'] == collection and not r['deleted']]

    def row(self, collection, id_):
        return next((r['data'] for r in self.records if r['collection'] == collection and r['id'] == id_), None)

    def serve(self):
        fake = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _json(self, status, body=None):
                data = b'' if body is None else json.dumps(body).encode()
                self.send_response(status)
                self.send_header('content-type', 'application/json')
                self.send_header('content-length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def _user(self):
                auth = self.headers.get('Authorization', '')
                for email, u in fake.users.items():
                    if auth == 'Bearer tok-' + u['id']:
                        return u
                return None

            def do_GET(self):
                self.handle_any()

            def do_POST(self):
                self.handle_any()

            def handle_any(self):
                u = urllib.parse.urlsplit(self.path)
                qs = urllib.parse.parse_qs(u.query)
                n = int(self.headers.get('content-length') or 0)
                body = json.loads(self.rfile.read(n).decode()) if n else None
                fake.requests.append((self.command, u.path, dict(qs), body, {k.lower(): v for k, v in self.headers.items()}))
                if self.headers.get('apikey') != 'anon-key':
                    return self._json(401, {'message': 'No API key found in request'})
                if u.path == '/auth/v1/signup':  # used by the phone in the end-to-end test
                    if body.get('email') in fake.users:
                        return self._json(422, {'msg': 'User already registered'})
                    uid = 'u%d' % (len(fake.users) + 1)
                    fake.users[body['email']] = {'id': uid, 'pw': body.get('password')}
                    return self._json(200, {'access_token': 'tok-' + uid, 'refresh_token': 'ref-' + uid, 'expires_in': fake.token_ttl,
                                            'token_type': 'bearer', 'user': {'id': uid, 'email': body['email']}})
                if u.path == '/auth/v1/token':
                    grant = qs.get('grant_type', [''])[0]
                    if grant == 'password':
                        acc = fake.users.get(body.get('email'))
                        if not acc or acc['pw'] != body.get('password'):
                            return self._json(400, {'error': 'invalid_grant', 'error_description': 'Invalid login credentials'})
                    else:
                        acc = next((x for x in fake.users.values() if 'ref-' + x['id'] == body.get('refresh_token')), None)
                        if not acc:
                            return self._json(400, {'error': 'invalid_grant', 'error_description': 'Invalid Refresh Token'})
                    email = next(e for e, x in fake.users.items() if x is acc)
                    return self._json(200, {'access_token': 'tok-' + acc['id'], 'refresh_token': 'ref-' + acc['id'], 'expires_in': fake.token_ttl,
                                            'token_type': 'bearer', 'user': {'id': acc['id'], 'email': email}})
                user = self._user()
                if not user:
                    return self._json(401, {'message': 'JWT expired'})
                if u.path == '/rest/v1/rpc/my_household':
                    hh = [fake.households[h] for (uid, h) in fake.members if uid == user['id']]
                    return self._json(200, hh[-1:])
                if u.path == '/rest/v1/rpc/create_household':
                    hid = 'h%d' % (len(fake.households) + 1)
                    fake.households[hid] = {'id': hid, 'name': body.get('p_name') or 'Family', 'invite_code': 'FAM%sXYZ' % hid}
                    fake.members.append((user['id'], hid))
                    return self._json(200, [fake.households[hid]])
                if u.path == '/rest/v1/records':
                    with fake.lock:
                        if self.command == 'POST':
                            assert 'merge-duplicates' in self.headers.get('Prefer', ''), 'upsert expected'
                            for r in body:
                                if (user['id'], r['household_id']) not in fake.members:
                                    return self._json(403, {'message': 'new row violates row-level security policy'})
                                row = {**json.loads(json.dumps(r)), 'updated_by': user['id'], 'updated_at': fake.now()}
                                i = next((k for k, x in enumerate(fake.records) if (x['household_id'], x['collection'], x['id']) ==
                                          (r['household_id'], r['collection'], r['id'])), None)
                                if i is None:
                                    fake.records.append(row)
                                else:
                                    fake.records[i] = row
                            return self._json(201)
                        # GET with PostgREST-style filters
                        rows = list(fake.records)
                        h = qs.get('household_id', [''])[0]
                        if h.startswith('eq.'):
                            rows = [r for r in rows if r['household_id'] == h[3:]]
                        if (user['id'], h[3:]) not in fake.members:
                            rows = []
                        if qs.get('deleted', [''])[0] == 'is.false':
                            rows = [r for r in rows if not r['deleted']]
                        since = qs.get('updated_at', [''])[0]
                        if since.startswith('gte.'):
                            rows = [r for r in rows if r['updated_at'] >= since[4:].replace('Z', '+00:00')]
                        c = qs.get('collection', [''])[0]
                        if c.startswith('in.('):
                            want = {x.strip().strip('"') for x in c[4:-1].split(',')}
                            rows = [r for r in rows if r['collection'] in want]
                        elif c.startswith('eq.'):
                            rows = [r for r in rows if r['collection'] == c[3:]]
                        rows.sort(key=lambda r: (r['updated_at'], r['collection'], r['id']) if 'updated_at' in qs.get('order', [''])[0] else (r['collection'], r['id']))
                        off, lim = int(qs.get('offset', ['0'])[0]), int(qs.get('limit', ['1000'])[0])
                        return self._json(200, [{k: r[k] for k in ('collection', 'id', 'data', 'deleted', 'updated_at')} for r in rows[off:off + lim]])
                return self._json(404, {'message': 'not found: ' + u.path})

        srv = ThreadingHTTPServer(('127.0.0.1', 0), H)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        self.url = 'http://127.0.0.1:%d' % srv.server_address[1]
        self.server = srv
        return self


class Base(unittest.TestCase):
    def setUp(self):
        self.sb = FakeSupabase().serve()
        self.home = tempfile.mkdtemp(prefix='fs-')
        self.c = Client(home=self.home)
        with self.assertRaises(FamilySaveError):
            self.c.configure('family.supabase.test', 'anon-key'.ljust(20, '0'))  # no scheme
        self.c.configure(self.sb.url, 'anon-key'.ljust(20, '0'))
        self.c.anon = 'anon-key'  # the fake checks this exact header value (shorter than a real anon key)
        self.c.login('keith@example.com', 'correct horse')

    def tearDown(self):
        self.sb.server.shutdown()
        self.sb.server.server_close()

    def events(self):
        return self.sb.rows('events')


class TestSignIn(Base):
    def test_login_stores_session_and_household(self):
        with open(os.path.join(self.home, 'session.json')) as f:
            s = json.load(f)
        self.assertEqual(s['user']['email'], 'keith@example.com')
        self.assertEqual(s['household'], {'id': 'h1', 'name': 'The Flowers'})
        self.assertNotIn('correct horse', json.dumps(s), 'password must never be stored')
        st = self.c.status()
        self.assertTrue(st['signed_in'])
        self.assertEqual(st['family'], 'The Flowers')

    def test_wrong_password(self):
        c = Client(home=self.home)
        c.anon = 'anon-key'
        with self.assertRaises(FamilySaveError) as cm:
            c.login('keith@example.com', 'nope')
        self.assertIn('Invalid login credentials', str(cm.exception))

    def test_expired_token_is_refreshed(self):
        self.c.session['expires_at'] = 1  # long ago
        self.c._save_session()
        self.c.tasks()
        self.assertTrue(any(p == '/auth/v1/token' and q.get('grant_type') == ['refresh_token'] for _, p, q, _, _ in self.sb.requests))
        self.assertGreater(self.c.session['expires_at'], time.time())

    def test_not_signed_in_message(self):
        c = Client(home=tempfile.mkdtemp())
        c.url, c.anon = self.sb.url, 'anon-key'
        with self.assertRaises(FamilySaveError) as cm:
            c.tasks()
        self.assertIn('login', str(cm.exception))

    def test_no_family_yet(self):
        self.sb.members = []
        self.c.session['household'] = None
        with self.assertRaises(FamilySaveError) as cm:
            self.c.tasks()
        self.assertIn('not in a family', str(cm.exception))


class TestTasks(Base):
    def test_add_task_matches_app_shape(self):
        t = self.c.add_task('Call the plumber', '2026-11-13', priority='high', area='Home', notes='about the leak')
        rows = self.sb.rows('tasks')
        self.assertEqual(len(rows), 1)
        self.assertEqual(set(rows[0]), TASK_KEYS)
        self.assertEqual(rows[0]['priority'], 'High')
        self.assertEqual(rows[0]['status'], 'open')
        self.assertEqual(rows[0]['rollovers'], 0)
        self.assertIsNone(rows[0]['completed'])
        self.assertRegex(rows[0]['created'], r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$')
        self.assertEqual(t['task_id'], rows[0]['id'])
        ev = self.events()
        self.assertEqual([(e['type'], e['taskId']) for e in ev], [('task_created', rows[0]['id'])])
        self.assertTrue(ev[0]['details'].startswith('Vector: '))
        row = next(r for r in self.sb.records if r['collection'] == 'tasks')
        self.assertEqual(row['updated_by'], 'u1', 'written as the signed-in user')

    def test_defaults(self):
        t = self.c.add_task('  Water plants ')
        self.assertEqual(t['title'], 'Water plants')
        self.assertEqual(t['scheduled'], familysave.today())
        self.assertEqual(t['area'], 'Vector AI')
        self.assertEqual(t['priority'], 'Medium')
        with self.assertRaises(FamilySaveError):
            self.c.add_task('')
        with self.assertRaises(FamilySaveError):
            self.c.add_task('x', 'tomorrow')

    def test_complete_move_reopen_by_title(self):
        self.sb.seed('tasks', {'id': 'a', 'title': 'Pay the plumber', 'next': '', 'area': 'Home', 'priority': 'High', 'scheduled': '2026-11-10',
                               'due': '', 'notes': '', 'status': 'open', 'created': 'x', 'completed': None, 'rollovers': 0})
        self.sb.seed('tasks', {'id': 'b', 'title': 'Call the bank', 'next': '', 'area': 'Money', 'priority': 'Low', 'scheduled': '2026-11-10',
                               'due': '', 'notes': '', 'status': 'open', 'created': 'x', 'completed': None, 'rollovers': 0})
        done = self.c.complete_task('plumber')
        self.assertEqual(done['status'], 'done')
        self.assertEqual(self.sb.row('tasks', 'a')['status'], 'done')
        self.assertIsNotNone(self.sb.row('tasks', 'a')['completed'])
        self.assertEqual([t['title'] for t in self.c.tasks()], ['Call the bank'])
        moved = self.c.move_task('b', '2026-11-20')
        self.assertEqual((moved['scheduled'], self.sb.row('tasks', 'b')['rollovers']), ('2026-11-20', 1))
        self.c.move_task('bank')  # default: tomorrow
        self.assertEqual(self.sb.row('tasks', 'b')['scheduled'], familysave.plus_days(familysave.today(), 1))
        re_ = self.c.reopen_task('plumber')
        self.assertEqual((re_['status'], re_['completed']), ('open', None))
        self.assertEqual([e['type'] for e in self.events()], ['task_completed', 'task_moved', 'task_moved', 'task_reopened'])

    def test_ambiguous_and_missing(self):
        for i, t in enumerate(['Call mom', 'Call dad']):
            self.sb.seed('tasks', {'id': str(i), 'title': t, 'next': '', 'area': 'Family', 'priority': 'Medium', 'scheduled': '2026-11-10',
                                   'due': '', 'notes': '', 'status': 'open', 'created': 'x', 'completed': None, 'rollovers': 0})
        with self.assertRaises(FamilySaveError) as cm:
            self.c.complete_task('call')
        self.assertIn('More than one', str(cm.exception))
        with self.assertRaises(FamilySaveError) as cm:
            self.c.complete_task('dentist')
        self.assertIn('No open task', str(cm.exception))
        self.assertEqual(self.c.complete_task('Call mom')['title'], 'Call mom', 'exact title wins over partial matches')

    def test_update_task(self):
        t = self.c.add_task('Fix the fence')
        u = self.c.update_task(t['task_id'], due='2026-12-01', priority='low', next_action='buy nails')
        self.assertEqual((u['due'], u['priority'], u['next_action'], u['title']), ('2026-12-01', 'Low', 'buy nails', 'Fix the fence'))
        with self.assertRaises(FamilySaveError):
            self.c.update_task(t['task_id'], priority='urgent')

    def test_list_filters_and_order(self):
        for i, (t, s, p, st) in enumerate([('B', '2026-11-12', 'Low', 'open'), ('A', '2026-11-12', 'High', 'open'), ('C', '2026-11-11', 'Medium', 'open'), ('D', '2026-11-01', 'High', 'done')]):
            self.sb.seed('tasks', {'id': str(i), 'title': t, 'next': '', 'area': 'Work' if t != 'C' else 'Home', 'priority': p, 'scheduled': s, 'due': '2026-01-01' if t == 'A' else '',
                                   'notes': '', 'status': st, 'created': 'x', 'completed': '2026-11-02T10:00:00.000Z' if st == 'done' else None, 'rollovers': 0})
        self.assertEqual([t['title'] for t in self.c.tasks()], ['C', 'A', 'B'])
        self.assertEqual([t['title'] for t in self.c.tasks(area='work')], ['A', 'B'])
        self.assertEqual([t['title'] for t in self.c.tasks('done')], ['D'])
        self.assertEqual(len(self.c.tasks('all')), 4)
        self.assertTrue(self.c.tasks()[1]['overdue'])


class TestJournal(Base):
    def test_morning_and_evening_shapes(self):
        m = self.c.add_journal_entry('morning', top_objective='Ship the bridge', plan='Heads down till noon')
        self.assertEqual(set(self.sb.rows('reviews')[0]), MORNING_KEYS)
        self.assertEqual(m['top_objective'], 'Ship the bridge')
        self.sb.seed('tasks', {'id': 'a', 'title': 'Old task', 'next': '', 'area': 'Home', 'priority': 'High', 'scheduled': '2026-01-05',
                               'due': '', 'notes': '', 'status': 'open', 'created': 'x', 'completed': None, 'rollovers': 2})
        self.sb.seed('tasks', {'id': 'b', 'title': 'Future task', 'next': '', 'area': 'Home', 'priority': 'High', 'scheduled': '2999-01-05',
                               'due': '', 'notes': '', 'status': 'open', 'created': 'x', 'completed': None, 'rollovers': 0})
        e = self.c.add_journal_entry('evening', wins='Bridge works', tomorrow_first_action='Write the README', carry_forward=True)
        ev = next(r for r in self.sb.rows('reviews') if r['type'] == 'evening')
        self.assertEqual(set(ev), EVENING_KEYS)
        self.assertEqual(e['tasks_carried_forward'], 1)
        self.assertEqual(self.sb.row('tasks', 'a')['scheduled'], familysave.plus_days(familysave.today(), 1))
        self.assertEqual(self.sb.row('tasks', 'a')['rollovers'], 3)
        self.assertEqual(self.sb.row('tasks', 'b')['scheduled'], '2999-01-05', 'future tasks stay put')
        self.assertIn('task_carried', [x['type'] for x in self.events()])
        j = self.c.journal()
        self.assertEqual([x['type'] for x in j], ['evening', 'morning'], 'newest first')
        with self.assertRaises(FamilySaveError):
            self.c.add_journal_entry('morning')


class TestMoney(Base):
    def setUp(self):
        super().setUp()
        self.sb.seed('fitness.people', {'id': 'p1', 'name': 'Keith', 'goals': {}})
        self.sb.seed('fitness.people', {'id': 'p2', 'name': 'Sam', 'goals': {}})
        self.sb.seed('finance.bills', {'id': 'b1', 'name': 'Electric', 'amount': 14000, 'dueDay': 15, 'category': 'Utilities', 'paid': {}})
        self.sb.seed('finance.bills', {'id': 'b2', 'name': 'Rent', 'amount': 120000, 'dueDay': 1, 'category': 'Housing', 'paid': {'2026-11': 'tx0'}})
        self.sb.seed('_doc', {'id': 'finance.budgets'})  # placeholder id; doc rows carry the object itself
        self.sb.records[-1]['data'] = {'Groceries': 60000, 'Dining': 20000}
        self.sb.records[-1]['id'] = 'finance.budgets'

    def test_log_transaction_shape_and_guess(self):
        tx = self.c.log_transaction('expense', '42.50', 'Kroger run', who='sam', on='2026-11-05')
        row = self.sb.rows('finance.txns')[0]
        self.assertEqual(set(row), TXN_KEYS)
        self.assertEqual((row['amount'], row['category'], row['who'], row['type'], row['date'], row['payee']), (4250, 'Groceries', 'p2', 'expense', '2026-11-05', 'Kroger run'))
        self.assertEqual((tx['amount'], tx['who']), (42.5, 'Sam'))
        inc = self.c.log_transaction('income', 1500, 'paycheck')
        self.assertEqual(self.sb.row('finance.txns', inc['txn_id'])['category'], 'Paycheck')
        self.assertEqual(self.c.log_transaction('expense', 9.99, 'something odd', category='subscriptions')['category'], 'Subscriptions')
        with self.assertRaises(FamilySaveError):
            self.c.log_transaction('expense', 'ten', 'x')
        with self.assertRaises(FamilySaveError):
            self.c.log_transaction('expense', 5, 'x', category='Fun')
        with self.assertRaises(FamilySaveError):
            self.c.log_transaction('expense', 5, 'x', who='Nobody')
        self.assertEqual(self.events()[0]['details'], 'Vector: $42.50 · Groceries · Kroger run')

    def test_summary_math(self):
        for amt, cat, d, ty, who in [(4250, 'Groceries', '2026-11-05', 'expense', 'p1'), (1200, 'Dining', '2026-11-06', 'expense', None),
                                     (150000, 'Paycheck', '2026-11-01', 'income', None), (999, 'Dining', '2026-10-30', 'expense', None)]:
            self.sb.seed('finance.txns', {'id': 't%d' % amt, 'type': ty, 'amount': amt, 'category': cat, 'date': d, 'note': cat, 'payee': cat,
                                          'accountId': None, 'who': who, 'reviewed': True, 'billId': None, 'created': 'x'})
        self.sb.seed('finance.txns', {'id': 'tr', 'type': 'transfer', 'amount': 5000, 'date': '2026-11-02', 'accountId': 'a', 'created': 'x'})
        s = self.c.money_summary('2026-11')
        self.assertEqual((s['income'], s['spent']), (1500.0, 54.5))
        self.assertEqual(s['spent_by_category'], {'Groceries': 42.5, 'Dining': 12.0})
        self.assertEqual(s['spent_by_person'], {'Keith': 42.5, 'Shared': 12.0})
        self.assertEqual(s['category_budgets'], {'Groceries': 600.0, 'Dining': 200.0})
        self.assertEqual(s['unpaid_bills'], [{'name': 'Electric', 'amount': 140.0, 'due': '2026-11-15'}])
        self.assertEqual(s['unpaid_bills_total'], 140.0)
        self.assertEqual([t['amount'] for t in s['recent']], [12.0, 42.5, 1500.0])
        self.assertEqual(len(self.c.transactions('2026-11', 'dining')), 1)
        with self.assertRaises(FamilySaveError):
            self.c.money_summary('November')

    def test_bills_and_mark_paid(self):
        b = self.c.bills('2026-11')
        self.assertEqual([(x['name'], x['due'], x['paid_this_month']) for x in b], [('Rent', '2026-11-01', True), ('Electric', '2026-11-15', False)])
        r = self.c.mark_bill_paid('the electric bill', on='2026-11-14', who='Keith')
        tx = self.sb.rows('finance.txns')[0]
        self.assertEqual(set(tx), TXN_KEYS)
        self.assertEqual((tx['amount'], tx['billId'], tx['category'], tx['note'], tx['who']), (14000, 'b1', 'Utilities', 'Electric', 'p1'))
        self.assertEqual(self.sb.row('finance.bills', 'b1')['paid'], {'2026-11': tx['id']})
        self.assertEqual(r['transaction']['amount'], 140.0)
        with self.assertRaises(FamilySaveError) as cm:
            self.c.mark_bill_paid('electric', on='2026-11-20')
        self.assertIn('already', str(cm.exception))
        self.c.mark_bill_paid('b1', amount=151.25, on='2026-12-02')
        self.assertEqual(self.sb.row('finance.bills', 'b1')['paid'].keys(), {'2026-11', '2026-12'})
        with self.assertRaises(FamilySaveError):
            self.c.mark_bill_paid('water')
        self.assertEqual(familysave.bill_due({'dueDay': 31}, '2026-02'), '2026-02-28')

    def test_savings(self):
        self.sb.seed('finance.goals', {'id': 'g1', 'name': 'Vacation', 'target': 300000, 'deadline': '2027-06-01', 'created': 'x',
                                       'contributions': [{'id': 'c1', 'date': '2026-10-01', 'amount': 50000, 'note': ''}]})
        self.assertEqual(self.c.savings_goals()[0], {'goal_id': 'g1', 'name': 'Vacation', 'target': 3000.0, 'saved': 500.0, 'remaining': 2500.0, 'deadline': '2027-06-01'})
        r = self.c.add_to_savings('vacation', 125)
        self.assertEqual(r['saved'], 625.0)
        self.assertEqual(len(self.sb.row('finance.goals', 'g1')['contributions']), 2)
        with self.assertRaises(FamilySaveError):
            self.c.add_to_savings('vacation', -1000)
        self.assertEqual(self.c.add_to_savings('g1', '-25')['saved'], 600.0)


class TestGroceryHealth(Base):
    def test_grocery(self):
        self.sb.seed('grocery.items', {'id': 'i1', 'name': 'Milk', 'qty': '', 'aisle': 'Dairy & Eggs', 'checked': False, 'source': 'manual', 'added': 'x'})
        r = self.c.add_grocery([{'name': 'bananas', 'qty': '6'}, 'milk', {'name': 'chicken thighs', 'aisle': 'Meat & Seafood'}, {'name': 'rice'}])
        self.assertEqual(r, {'added': ['Bananas', 'Chicken thighs', 'Rice'], 'already_on_list': ['milk']})
        rows = self.sb.rows('grocery.items')
        self.assertEqual(set(rows[1]), GROCERY_KEYS)
        by = {x['name']: x['aisle'] for x in rows}
        self.assertEqual((by['Bananas'], by['Chicken thighs'], by['Rice']), ('Produce', 'Meat & Seafood', 'Pantry'))
        self.assertEqual([x['name'] for x in self.c.grocery()], ['Bananas', 'Chicken thighs', 'Milk', 'Rice'], 'store order')
        self.c.check_grocery('milk')
        self.assertEqual([x['name'] for x in self.c.grocery()], ['Bananas', 'Chicken thighs', 'Rice'])
        self.assertEqual(len(self.c.grocery(include_checked=True)), 4)
        self.assertEqual(self.c.add_grocery('eggs, butter')['added'], ['Eggs', 'Butter'])
        with self.assertRaises(FamilySaveError):
            self.c.add_grocery(['eggs'])

    def test_health(self):
        with self.assertRaises(FamilySaveError) as cm:
            self.c.log_health('steps', value=5000)
        self.assertIn('Health tab', str(cm.exception))
        self.sb.seed('fitness.people', {'id': 'p1', 'name': 'Keith', 'goals': {'steps': 8000}})
        self.sb.seed('fitness.people', {'id': 'p2', 'name': 'Sam', 'goals': {}})
        w = self.c.log_health('workout', who='sam', minutes=30, activity='run', miles=3.1)
        self.assertEqual((w['person'], w['entry']), ('Sam', {'date': familysave.today(), 'kind': 'workout', 'activity': 'run', 'minutes': 30, 'miles': 3.1}))
        row = self.sb.rows('fitness.logs')[0]
        self.assertEqual(set(row), {'id', 'personId', 'date', 'kind', 'created', 'activity', 'minutes', 'miles'})
        self.c.log_health('steps', value=6543.7)
        self.c.log_health('weight', value=181.26)
        self.c.log_health('meal', note='Oatmeal', calories=350, protein=12)
        self.c.log_health('water', value=2)
        with self.assertRaises(FamilySaveError):
            self.c.log_health('sleep')
        with self.assertRaises(FamilySaveError):
            self.c.log_health('workout', activity='run')
        with self.assertRaises(FamilySaveError):
            self.c.log_health('nap', value=1)
        h = self.c.health_today()
        me = h[0]
        self.assertEqual((me['person'], me['steps'], me['latest_weight_lb'], me['calories'], me['protein_g'], me['water_glasses'], me['meals']),
                         ('Keith', 6544, 181.3, 350, 12, 2, ['Oatmeal']))
        self.assertEqual(h[1]['active_minutes'], 30)
        self.assertEqual([p['name'] for p in self.c.people()], ['Keith', 'Sam'])


class TestOverviewAndTools(Base):
    def test_today_overview(self):
        T = familysave.today()
        self.sb.seed('tasks', {'id': 'a', 'title': 'Today thing', 'next': '', 'area': 'Home', 'priority': 'Low', 'scheduled': T, 'due': '', 'notes': '', 'status': 'open', 'created': 'x', 'completed': None, 'rollovers': 0})
        self.sb.seed('tasks', {'id': 'b', 'title': 'Late thing', 'next': '', 'area': 'Home', 'priority': 'High', 'scheduled': '2020-01-01', 'due': '2020-01-02', 'notes': '', 'status': 'open', 'created': 'x', 'completed': None, 'rollovers': 0})
        self.sb.seed('tasks', {'id': 'c', 'title': 'Soon thing', 'next': '', 'area': 'Home', 'priority': 'High', 'scheduled': familysave.plus_days(T, 3), 'due': '', 'notes': '', 'status': 'open', 'created': 'x', 'completed': None, 'rollovers': 0})
        self.sb.seed('tasks', {'id': 'd', 'title': 'Done thing', 'next': '', 'area': 'Home', 'priority': 'High', 'scheduled': T, 'due': '', 'notes': '', 'status': 'done', 'created': 'x', 'completed': T + 'T09:00:00.000Z', 'rollovers': 0})
        due_soon = int(familysave.plus_days(T, 2)[8:])
        self.sb.seed('finance.bills', {'id': 'b1', 'name': 'Soon bill', 'amount': 5000, 'dueDay': due_soon, 'category': 'Utilities', 'paid': {}})
        far = familysave.plus_days(T, 20)  # 20 days out, possibly next month: never in the 7-day window
        self.sb.seed('finance.bills', {'id': 'b2', 'name': 'Far bill', 'amount': 5000, 'dueDay': int(far[8:]), 'category': 'Utilities',
                                       'paid': {} if far[:7] == T[:7] else {T[:7]: 'paid-earlier'}})
        self.sb.seed('finance.bills', {'id': 'b3', 'name': 'Missed bill', 'amount': 5000, 'dueDay': 1, 'category': 'Utilities', 'paid': {}}) if int(T[8:]) > 1 else None
        self.sb.seed('reviews', {'id': 'r', 'date': T, 'type': 'morning', 'timestamp': 'x', 'goal': 'Win', 'notes': ''})
        o = self.c.today_overview()
        self.assertEqual(o['date'], T)
        self.assertEqual([t['title'] for t in o['tasks_for_today']], ['Late thing', 'Today thing'], 'overdue first, by priority')
        self.assertEqual([t['title'] for t in o['overdue_tasks']], ['Late thing'])
        self.assertEqual([t['title'] for t in o['upcoming_tasks']], ['Soon thing'])
        self.assertEqual(o['completed_today'], ['Done thing'])
        want = (['Missed bill'] if int(T[8:]) > 1 else []) + ['Soon bill']
        self.assertEqual([b['name'] for b in o['bills_next_7_days']], want, 'due soon, plus unpaid and already past due this month')
        if int(T[8:]) > 1:
            self.assertTrue(o['bills_next_7_days'][0]['overdue'])
        self.assertEqual(o['latest_journal_entry']['top_objective'], 'Win')
        self.assertEqual(o['money_this_month'], {'income': 0.0, 'spent': 0.0})

    def test_tool_definitions_are_sound(self):
        names = [t['name'] for t in tools.TOOLS]
        self.assertEqual(len(names), len(set(names)))
        for t in tools.TOOLS:
            self.assertEqual(t['parameters']['type'], 'object')
            for r in t['parameters']['required']:
                self.assertIn(r, t['parameters']['properties'], '%s requires unknown %s' % (t['name'], r))
            self.assertLess(len(t['description']), 400)
        oa = tools.openai_tools()
        self.assertEqual(oa[0]['type'], 'function')
        self.assertEqual(set(tools.mcp_tools()[0]), {'name', 'description', 'inputSchema'})

    def test_dispatcher(self):
        out = tools.call('add_task', {'title': 'From a tool', 'priority': 'Low'}, self.c)
        self.assertEqual(out['priority'], 'Low')
        self.assertEqual(tools.call('list_tasks', '{"status":"open"}', self.c)[0]['title'], 'From a tool')
        self.assertEqual(tools.call('complete_task', {'task': 'from a tool'}, self.c)['status'], 'done')
        txt, err = tools.call_text('complete_task', {'task': 'nothing here'}, self.c)
        self.assertTrue(err)
        self.assertIn('No open task', json.loads(txt)['error'])
        txt, err = tools.call_text('fly', {}, self.c)
        self.assertTrue(err)
        self.assertIn('Unknown tool', txt)
        txt, err = tools.call_text('log_transaction', {'type': 'expense', 'amount': 12.34, 'note': 'coffee'}, self.c)
        self.assertFalse(err)
        self.assertEqual(json.loads(txt)['category'], 'Dining')
        self.assertEqual(tools.call('add_grocery_items', {'items': [{'name': 'apples'}]}, self.c)['added'], ['Apples'])
        # every read-only tool runs on an empty family
        for name in ('today_overview', 'journal_entries', 'money_summary', 'list_transactions', 'list_bills', 'savings_goals', 'grocery_list', 'health_today', 'recent_activity'):
            tools.call(name, {}, self.c)


class TestMcpServer(Base):
    def test_handshake_list_and_call(self):
        env = {**os.environ, 'FAMILYSAVE_HOME': self.home, 'FAMILYSAVE_ANON_KEY': 'anon-key', 'FAMILYSAVE_URL': self.sb.url}
        p = subprocess.Popen([sys.executable, os.path.join(HERE, 'mcp_server.py')], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, env=env, text=True)
        msgs = [
            {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {'protocolVersion': '2025-06-18', 'capabilities': {}, 'clientInfo': {'name': 'test', 'version': '0'}}},
            {'jsonrpc': '2.0', 'method': 'notifications/initialized'},
            {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list'},
            {'jsonrpc': '2.0', 'id': 3, 'method': 'tools/call', 'params': {'name': 'add_task', 'arguments': {'title': 'Via MCP', 'date': '2026-11-20'}}},
            {'jsonrpc': '2.0', 'id': 4, 'method': 'tools/call', 'params': {'name': 'complete_task', 'arguments': {'task': 'missing'}}},
            {'jsonrpc': '2.0', 'id': 5, 'method': 'ping'},
            {'jsonrpc': '2.0', 'id': 6, 'method': 'resources/list'},
            {'jsonrpc': '2.0', 'id': 7, 'method': 'nope/what'},
            'not json',
        ]
        out, err = p.communicate('\n'.join(m if isinstance(m, str) else json.dumps(m) for m in msgs) + '\n', timeout=30)
        self.assertEqual(p.returncode, 0, err)
        res = {}
        for line in out.strip().split('\n'):
            m = json.loads(line)
            self.assertEqual(m['jsonrpc'], '2.0')
            res[m['id']] = m
        self.assertEqual(res[1]['result']['protocolVersion'], '2025-06-18')
        self.assertEqual(res[1]['result']['serverInfo']['name'], 'family-save')
        self.assertIn('tools', res[1]['result']['capabilities'])
        self.assertEqual([t['name'] for t in res[2]['result']['tools']], tools.TOOL_NAMES)
        self.assertFalse(res[3]['result']['isError'])
        self.assertEqual(json.loads(res[3]['result']['content'][0]['text'])['title'], 'Via MCP')
        self.assertEqual(self.sb.rows('tasks')[0]['scheduled'], '2026-11-20', 'the MCP call reached the server')
        self.assertTrue(res[4]['result']['isError'])
        self.assertEqual(res[5]['result'], {})
        self.assertEqual(res[6]['result'], {'resources': []})
        self.assertEqual(res[7]['error']['code'], -32601)
        self.assertEqual(res[None]['error']['code'], -32700)
        self.assertNotIn('notifications', out, 'notifications get no reply')


class TestChat(Base):
    """chat.py against a fake OpenAI-compatible model server that asks for a tool, then answers."""

    def test_tool_call_round_trip(self):
        import chat
        seen = []

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers['content-length'])))
                seen.append(body)
                if not any(m['role'] == 'tool' for m in body['messages']):
                    msg = {'role': 'assistant', 'content': None, 'tool_calls': [{'id': 'call_1', 'type': 'function', 'function': {
                        'name': 'add_task', 'arguments': json.dumps({'title': 'Buy stamps', 'date': '2026-11-21'})}}]}
                else:
                    tool_msg = next(m for m in body['messages'] if m['role'] == 'tool')
                    msg = {'role': 'assistant', 'content': 'Added "Buy stamps" for %s.' % json.loads(tool_msg['content'])['scheduled']}
                out = json.dumps({'choices': [{'message': msg, 'finish_reason': 'stop'}]}).encode()
                self.send_response(200)
                self.send_header('content-type', 'application/json')
                self.send_header('content-length', str(len(out)))
                self.end_headers()
                self.wfile.write(out)

        srv = ThreadingHTTPServer(('127.0.0.1', 0), H)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            opts = type('O', (), {'base_url': 'http://127.0.0.1:%d/v1' % srv.server_address[1], 'api_key': '', 'model': 'qwen3', 'verbose': False})()
            messages = [{'role': 'system', 'content': 'sys'}, {'role': 'user', 'content': 'remind me to buy stamps on the 21st'}]
            answer = chat.turn(messages, opts, self.c, tools.openai_tools())
            self.assertEqual(answer, 'Added "Buy stamps" for 2026-11-21.')
            self.assertEqual(self.sb.rows('tasks')[0]['title'], 'Buy stamps', 'the tool really ran')
            self.assertEqual(len(seen), 2)
            self.assertEqual(seen[0]['model'], 'qwen3')
            self.assertEqual([t['function']['name'] for t in seen[0]['tools']], tools.TOOL_NAMES, 'tools sent with the request')
            roles = [m['role'] for m in messages]
            self.assertEqual(roles, ['system', 'user', 'assistant', 'tool', 'assistant'], 'conversation kept in order')
            self.assertEqual(messages[3]['tool_call_id'], 'call_1')
        finally:
            srv.shutdown()
            srv.server_close()


class TestCli(Base):
    def run_cli(self, *args, ok=True):
        env = {**os.environ, 'FAMILYSAVE_HOME': self.home, 'FAMILYSAVE_ANON_KEY': 'anon-key', 'FAMILYSAVE_URL': self.sb.url}
        r = subprocess.run([sys.executable, os.path.join(HERE, 'familysave.py'), *args], env=env, capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode == 0, ok, r.stdout + r.stderr)
        return json.loads(r.stdout) if ok else json.loads(r.stderr)

    def test_commands(self):
        self.assertEqual(self.run_cli('status')['family'], 'The Flowers')
        t = self.run_cli('add', 'Walk the dog', '--priority', 'High')
        self.assertEqual(self.run_cli('tasks')[0]['task_id'], t['task_id'])
        self.assertEqual(self.run_cli('done', 'walk the dog')['status'], 'done')
        self.assertIn('No open task', self.run_cli('done', 'walk the dog', ok=False)['error'])
        self.assertEqual(self.run_cli('spent', '12.5', 'coffee')['category'], 'Dining')
        self.assertEqual(self.run_cli('buy', 'eggs', 'milk')['added'], ['Eggs', 'Milk'])
        self.assertEqual(self.run_cli('morning', 'Ship it')['top_objective'], 'Ship it')
        self.assertIn('tasks_for_today', self.run_cli('today'))
        self.assertEqual(len(self.run_cli('tools')), len(tools.TOOLS))
        self.assertEqual(self.run_cli('activity')[0]['what'], 'review_saved')
        self.run_cli('logout')
        self.assertIn('login', self.run_cli('tasks', ok=False)['error'])
        self.assertFalse(self.run_cli('status')['signed_in'])
        self.assertEqual(self.run_cli('login', 'keith@example.com', '--password', 'correct horse')['household'], 'The Flowers')


if __name__ == '__main__':
    if '--serve' in sys.argv:
        # For tests/vector.test.js: host the fake family server, print its URL, run until stdin closes.
        fake = FakeSupabase()
        fake.users.clear(); fake.households.clear(); fake.members.clear()  # the phone creates everything
        fake.clock = time.time()
        fake.serve()
        print(fake.url, flush=True)
        sys.stdin.read()
        fake.server.shutdown()
    else:
        unittest.main()
