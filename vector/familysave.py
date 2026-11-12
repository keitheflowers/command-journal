#!/usr/bin/env python3
"""Family Save client for Vector (your own AI running on your computer).

Talks to the same Supabase project the phones sync with (see
supabase/README.md), using the same record contract as sync.js: every task,
transaction, bill, journal entry... is one row in the ``records`` table, so
anything written here shows up on every phone within about a minute, and
everything the phones change is visible here.

No third-party packages: Python 3.9+ standard library only.

Quick start (one time):
    python3 vector/familysave.py setup --url https://abcd.supabase.co --anon-key eyJ...
    python3 vector/familysave.py login you@example.com
Then:
    python3 vector/familysave.py today
    python3 vector/familysave.py add "Call the plumber" --date 2026-11-13
    python3 vector/familysave.py spent 42.50 "Kroger"

Settings and the sign-in live in ~/.familysave (or $FAMILYSAVE_HOME). The
password is never stored; only the session tokens are.
"""
import json
import os
import re
import sys
import uuid
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

VERSION = "1.0.0"

# The app's fixed lists (finance.js, grocery.js, fitness.js, index.html).
EXPENSE = ['Housing', 'Utilities', 'Groceries', 'Dining', 'Gas', 'Transportation', 'Insurance', 'Health', 'Kids',
           'Giving', 'Subscriptions', 'Shopping', 'Entertainment', 'Debt', 'Savings', 'Other']
INCOME = ['Paycheck', 'Side income', 'Gift', 'Refund', 'Other income']
AISLES = ['Produce', 'Meat & Seafood', 'Dairy & Eggs', 'Bakery', 'Pantry', 'Frozen', 'Snacks & Drinks', 'Household', 'Other']
PRIORITIES = ['High', 'Medium', 'Low']
DEFAULT_AREAS = ['Work', 'Home', 'Family', 'Health', 'Money', 'Personal']
ACTIVITIES = ['run', 'walk', 'bike', 'swim', 'strength', 'yoga', 'hike', 'sports', 'other']
FIT_KINDS = ['workout', 'weight', 'steps', 'water', 'sleep', 'meal']
DEFAULT_AREA = 'Vector AI'  # what the app itself uses for tasks created by voice/AI

# Same keyword guesses as finance.js, so Vector and the phone categorize alike.
KEYWORDS = [
    (r"\b(groceries|grocery|walmart|kroger|h-?e-?b|costco|aldi|sam'?s club|publix|safeway|food lion|trader joe)", 'Groceries'),
    (r"\b(lunch|dinner|breakfast|restaurant|coffee|starbucks|mcdonald|chick-?fil-?a|pizza|takeout|doordash|uber eats|taco|burger|eating out)", 'Dining'),
    (r"\b(gas|fuel|shell|exxon|chevron|valero|qt|quiktrip|buc-?ee)", 'Gas'),
    (r"\b(uber|lyft|parking|toll|car wash|oil change|tires?|mechanic|car repair|bus|train)", 'Transportation'),
    (r"\b(rent|mortgage|hoa)\b", 'Housing'),
    (r"\b(electric|electricity|water|internet|wifi|phone bill|cell|utility|utilities|trash|sewer)", 'Utilities'),
    (r"\b(insurance)\b", 'Insurance'),
    (r"\b(doctor|pharmacy|medicine|prescription|dentist|copay|hospital|cvs|walgreens)", 'Health'),
    (r"\b(kids?|school|daycare|tuition|diapers|babysitter)", 'Kids'),
    (r"\b(church|tithe|offering|donation|charity|giving)", 'Giving'),
    (r"\b(netflix|spotify|hulu|disney|subscription|youtube|prime|icloud|chatgpt|apple music)", 'Subscriptions'),
    (r"\b(amazon|target|clothes|shoes|shopping|best buy|home depot|lowe'?s)", 'Shopping'),
    (r"\b(movie|movies|games?|concert|tickets|bowling|entertainment)", 'Entertainment'),
    (r"\b(credit card|loan|car payment|student loan|debt)", 'Debt'),
    (r"\b(savings|save|investment|ira|401k)", 'Savings'),
]
INCOME_KEYWORDS = [
    (r"\b(paycheck|salary|work|job|payroll|direct deposit)", 'Paycheck'),
    (r"\b(refund|return|rebate)", 'Refund'),
    (r"\b(gift|birthday)", 'Gift'),
    (r"\b(side|freelance|gig|sold|sale|client)", 'Side income'),
]
AISLE_KEYWORDS = [
    (r"\b(apple|banana|berry|berries|lettuce|spinach|tomato|onion|pepper|avocado|lemon|lime|grape|orange|potato|carrot|broccoli|fruit|vegetable)", 'Produce'),
    (r"\b(chicken|beef|steak|pork|turkey|fish|salmon|shrimp|sausage|bacon|ground)", 'Meat & Seafood'),
    (r"\b(milk|cheese|yogurt|butter|egg|cream)", 'Dairy & Eggs'),
    (r"\b(bread|bagel|tortilla|bun|roll)", 'Bakery'),
    (r"\b(frozen|ice cream|pizza)", 'Frozen'),
    (r"\b(chip|chips|soda|juice|water|snack|cracker|cookie|coffee|tea)", 'Snacks & Drinks'),
    (r"\b(paper towel|toilet paper|soap|detergent|shampoo|trash bag|cleaner)", 'Household'),
    (r"\b(rice|pasta|beans|oil|flour|sugar|salt|cereal|oats|sauce|can|canned|spice)", 'Pantry'),
]

PAGE = 1000
HOME = os.environ.get('FAMILYSAVE_HOME') or os.path.join(os.path.expanduser('~'), '.familysave')


class FamilySaveError(Exception):
    """Something a person (or Vector) should be told about, in plain words."""


# ---- small helpers, matching the app's own ----------------------------------
def today():
    return date.today().isoformat()


def this_month():
    return today()[:7]


def plus_days(day, n):
    return (date.fromisoformat(day) + timedelta(days=n)).isoformat()


def stamp():
    # like JavaScript's Date.toISOString(): 2026-11-12T03:04:05.123Z
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def new_id():
    return str(uuid.uuid4())


def is_date(s):
    try:
        return bool(s) and bool(re.fullmatch(r'\d{4}-\d{2}-\d{2}', s)) and date.fromisoformat(s) is not None
    except ValueError:
        return False


def to_cents(amount):
    try:
        n = float(str(amount).replace('$', '').replace(',', '').strip())
    except ValueError:
        raise FamilySaveError('Amount must be a number of dollars, e.g. 42.50.')
    if not n > 0:
        raise FamilySaveError('Amount must be more than zero.')
    return int(round(n * 100))


def dollars(cents):
    return round((cents or 0) / 100, 2)


def guess_category(text, kind):
    for pat, cat in (INCOME_KEYWORDS if kind == 'income' else KEYWORDS):
        if re.search(pat, text or '', re.I):
            return cat
    return 'Other income' if kind == 'income' else 'Other'


def guess_aisle(name):
    for pat, aisle in AISLE_KEYWORDS:
        if re.search(pat, name or '', re.I):
            return aisle
    return 'Other'


def bill_due(bill, month):
    y, m = (int(x) for x in month.split('-'))
    last = (date(y + (m // 12), m % 12 + 1, 1) - timedelta(days=1)).day
    return '%s-%02d' % (month, min(int(bill.get('dueDay') or 1), last))


def _norm(s):
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9 ]', ' ', str(s or '').lower())).strip()


def _read_json(path, default):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def _write_json(path, value):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(value, f, indent=1)
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass
    os.replace(tmp, path)


class Client:
    """One signed-in person's view of their family's data."""

    def __init__(self, url=None, anon_key=None, home=None):
        self.home = home or HOME
        cfg = _read_json(os.path.join(self.home, 'config.json'), {})
        self.url = (url or os.environ.get('FAMILYSAVE_URL') or cfg.get('url') or '').strip().rstrip('/')
        self.anon = (anon_key or os.environ.get('FAMILYSAVE_ANON_KEY') or cfg.get('anon_key') or '').strip()
        self.session = _read_json(os.path.join(self.home, 'session.json'), None)
        self._cache = {}

    # ---- setup and sign-in ---------------------------------------------------
    def configure(self, url, anon_key):
        url = str(url or '').strip().rstrip('/')
        if not re.match(r'^https?://', url):
            raise FamilySaveError('The server URL should look like https://abcd1234.supabase.co')
        if not anon_key or len(anon_key) < 20:
            raise FamilySaveError('The anon key is the long "anon public" key from Supabase → Project Settings → API.')
        self.url, self.anon = url, anon_key.strip()
        _write_json(os.path.join(self.home, 'config.json'), {'url': self.url, 'anon_key': self.anon})

    def configured(self):
        return bool(self.url and self.anon)

    def signed_in(self):
        return bool(self.session and self.session.get('refresh_token'))

    def _save_session(self):
        path = os.path.join(self.home, 'session.json')
        if self.session:
            _write_json(path, self.session)
        else:
            try:
                os.remove(path)
            except OSError:
                pass

    def _keep(self, s, household=None):
        now = int(datetime.now(timezone.utc).timestamp())
        user = s.get('user') or {}
        self.session = {
            'access_token': s['access_token'], 'refresh_token': s['refresh_token'],
            'expires_at': s.get('expires_at') or now + int(s.get('expires_in') or 3600),
            'user': {'id': user.get('id'), 'email': user.get('email')},
            'household': household if household is not None else (self.session or {}).get('household'),
        }
        self._save_session()

    def login(self, email, password):
        if not self.configured():
            raise FamilySaveError('Run setup first: familysave.py setup --url ... --anon-key ...')
        s = self._request('/auth/v1/token?grant_type=password', method='POST', auth=False,
                          body={'email': email, 'password': password})
        self._keep(s, household=None)
        self.session['household'] = None
        hh = self.household(refresh=True)
        return {'email': email, 'household': hh['name'] if hh else None,
                'note': None if hh else 'Signed in, but this account is not in a family yet. Start or join one in the app (Settings → Family sync).'}

    def logout(self):
        self.session = None
        self._save_session()

    def token(self):
        s = self.session
        if not s:
            raise FamilySaveError('Not signed in. Run: familysave.py login you@example.com')
        if s['expires_at'] - 60 > datetime.now(timezone.utc).timestamp():
            return s['access_token']
        try:
            fresh = self._request('/auth/v1/token?grant_type=refresh_token', method='POST', auth=False,
                                  body={'refresh_token': s['refresh_token']})
        except FamilySaveError as e:
            if 400 <= (getattr(e, 'status', 0) or 0) < 500:
                self.logout()
                raise FamilySaveError('Your sign-in expired. Run: familysave.py login you@example.com')
            raise
        self._keep(fresh)
        return self.session['access_token']

    def household(self, refresh=False):
        if not refresh and self.session and self.session.get('household'):
            return self.session['household']
        rows = self._request('/rest/v1/rpc/my_household', method='POST', body={})
        row = rows[0] if isinstance(rows, list) and rows else (rows if isinstance(rows, dict) and rows.get('id') else None)
        hh = {'id': row['id'], 'name': row.get('name')} if row else None
        if self.session is not None:
            self.session['household'] = hh
            self._save_session()
        return hh

    def household_id(self):
        hh = self.household()
        if not hh:
            raise FamilySaveError('This account is not in a family yet. In the app: Settings → Family sync → start or join a family.')
        return hh['id']

    def status(self):
        out = {'server': self.url or None, 'configured': self.configured(), 'signed_in': self.signed_in(),
               'email': (self.session or {}).get('user', {}).get('email'), 'family': None}
        if self.signed_in():
            try:
                hh = self.household(refresh=True)
                out['family'] = hh['name'] if hh else None
            except FamilySaveError as e:
                out['error'] = str(e)
        return out

    # ---- HTTP ----------------------------------------------------------------
    def _request(self, path, method='GET', body=None, auth=True, headers=None):
        if not self.configured():
            raise FamilySaveError('Family Save server not set up. Run: familysave.py setup --url ... --anon-key ...')
        h = {'apikey': self.anon, 'content-type': 'application/json', 'accept': 'application/json'}
        if auth:
            h['Authorization'] = 'Bearer ' + self.token()
        h.update(headers or {})
        data = None if body is None else json.dumps(body).encode('utf-8')
        req = urllib.request.Request(self.url + path, data=data, method=method, headers=h)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                txt = r.read().decode('utf-8')
        except urllib.error.HTTPError as e:
            txt = e.read().decode('utf-8', 'replace')
            msg = None
            try:
                j = json.loads(txt)
                msg = j.get('msg') or j.get('message') or j.get('error_description') or j.get('error')
                if isinstance(msg, dict):
                    msg = msg.get('message') or json.dumps(msg)
            except ValueError:
                pass
            err = FamilySaveError(str(msg or ('HTTP %d' % e.code)))
            err.status = e.code
            raise err
        except (urllib.error.URLError, OSError) as e:
            err = FamilySaveError("Can't reach the Family Save server (offline?): %s" % getattr(e, 'reason', e))
            err.offline = True
            raise err
        if not txt:
            return None
        try:
            return json.loads(txt)
        except ValueError:
            return txt

    # ---- records (the sync contract) -----------------------------------------
    def fetch(self, *collections):
        """Live records as {collection: {id: data}} (tombstones left out)."""
        H = self.household_id()
        out = {c: {} for c in collections}
        q = {'select': 'collection,id,data,deleted', 'household_id': 'eq.' + H, 'deleted': 'is.false',
             'order': 'collection.asc,id.asc', 'limit': str(PAGE)}
        if collections:
            q['collection'] = 'in.(' + ','.join('"%s"' % c for c in collections) + ')'
        off = 0
        while True:
            q['offset'] = str(off)
            rows = self._request('/rest/v1/records?' + urllib.parse.urlencode(q, quote_via=urllib.parse.quote)) or []
            for r in rows:
                if r.get('deleted') or r.get('data') is None:
                    continue
                if collections and r['collection'] not in out:
                    continue
                out.setdefault(r['collection'], {})[str(r['id'])] = r['data']
            if len(rows) < PAGE:
                break
            off += PAGE
        return out

    def items(self, collection, sort_key=None, reverse=False):
        rows = list(self.fetch(collection).get(collection, {}).values())
        if sort_key:
            rows.sort(key=lambda x: str(x.get(sort_key) or ''), reverse=reverse)
        return rows

    def doc(self, name, default=None):
        d = self.fetch('_doc').get('_doc', {})
        return d.get(name, default)

    def put(self, collection, item_id, data):
        self.put_many([(collection, item_id, data)])

    def put_many(self, rows):
        H = self.household_id()
        body = [{'household_id': H, 'collection': c, 'id': str(i), 'data': d, 'deleted': False} for c, i, d in rows]
        for i in range(0, len(body), 400):
            self._request('/rest/v1/records?on_conflict=household_id,collection,id', method='POST', body=body[i:i + 400],
                          headers={'Prefer': 'resolution=merge-duplicates,return=minimal'})

    def event(self, kind, details, task_id=None):
        """Audit trail: the same activity log the app keeps, marked as Vector's."""
        e = {'id': new_id(), 'timestamp': stamp(), 'type': kind, 'taskId': task_id, 'details': 'Vector: ' + details, 'by': 'vector'}
        self.put('events', e['id'], e)
        return e

    # ---- tasks ---------------------------------------------------------------
    def areas(self):
        a = self.doc('areas')
        return [str(x) for x in a] if isinstance(a, list) and a else list(DEFAULT_AREAS)

    @staticmethod
    def _task_view(t):
        return {'task_id': t['id'], 'title': t.get('title'), 'scheduled': t.get('scheduled'), 'due': t.get('due') or None,
                'priority': t.get('priority'), 'area': t.get('area'), 'status': t.get('status'),
                'next_action': t.get('next') or None, 'notes': t.get('notes') or None,
                'overdue': bool(t.get('status') != 'done' and t.get('due') and t['due'] < today()),
                'completed': t.get('completed')}

    def tasks(self, status='open', area=None, limit=50):
        rows = self.items('tasks')
        if status == 'open':
            rows = [t for t in rows if t.get('status') != 'done']
        elif status == 'done':
            rows = [t for t in rows if t.get('status') == 'done']
        if area:
            rows = [t for t in rows if _norm(t.get('area')) == _norm(area)]
        pr = {'High': 0, 'Medium': 1, 'Low': 2}
        rows.sort(key=lambda t: (str(t.get('scheduled') or ''), pr.get(t.get('priority'), 1), str(t.get('title') or '')))
        if status == 'done':
            rows.sort(key=lambda t: str(t.get('completed') or ''), reverse=True)
        return [self._task_view(t) for t in rows[:max(1, int(limit or 50))]]

    def add_task(self, title, scheduled=None, due=None, priority='Medium', area=None, notes='', next_action=''):
        title = str(title or '').strip()[:180]
        if not title:
            raise FamilySaveError('A task needs a title.')
        if scheduled and not is_date(scheduled):
            raise FamilySaveError('Date must be YYYY-MM-DD.')
        if due and not is_date(due):
            raise FamilySaveError('Due date must be YYYY-MM-DD.')
        p = str(priority or 'Medium').capitalize()
        t = {'id': new_id(), 'title': title, 'next': str(next_action or '')[:200], 'area': str(area or DEFAULT_AREA)[:40],
             'priority': p if p in PRIORITIES else 'Medium', 'scheduled': scheduled or today(), 'due': due or '',
             'notes': str(notes or '')[:1000], 'status': 'open', 'created': stamp(), 'completed': None, 'rollovers': 0}
        self.put_many([('tasks', t['id'], t)])
        self.event('task_created', title, t['id'])
        return self._task_view(t)

    def find_task(self, query, include_done=False):
        q = _norm(query)
        if not q:
            raise FamilySaveError('Say which task (its title or task_id).')
        rows = [t for t in self.items('tasks') if include_done or t.get('status') != 'done']
        hit = [t for t in rows if t['id'] == str(query).strip()]
        if not hit:
            hit = [t for t in rows if _norm(t.get('title')) == q]
        if not hit:
            hit = [t for t in rows if q in _norm(t.get('title'))]
        if not hit:
            raise FamilySaveError('No open task matches "%s".' % query)
        if len(hit) > 1:
            raise FamilySaveError('More than one task matches "%s": %s. Use the task_id.' %
                                  (query, '; '.join('%s (%s)' % (t['title'], t['id']) for t in hit[:5])))
        return hit[0]

    def complete_task(self, query):
        t = self.find_task(query)
        t['status'], t['completed'] = 'done', stamp()
        self.put('tasks', t['id'], t)
        self.event('task_completed', t['title'], t['id'])
        return self._task_view(t)

    def reopen_task(self, query):
        t = self.find_task(query, include_done=True)
        t['status'], t['completed'] = 'open', None
        self.put('tasks', t['id'], t)
        self.event('task_reopened', t['title'], t['id'])
        return self._task_view(t)

    def move_task(self, query, scheduled=None):
        if scheduled and not is_date(scheduled):
            raise FamilySaveError('Date must be YYYY-MM-DD.')
        t = self.find_task(query)
        t['scheduled'] = scheduled or plus_days(today(), 1)
        t['rollovers'] = int(t.get('rollovers') or 0) + 1
        self.put('tasks', t['id'], t)
        self.event('task_moved', '%s → %s' % (t['title'], t['scheduled']), t['id'])
        return self._task_view(t)

    def update_task(self, query, title=None, due=None, priority=None, area=None, notes=None, next_action=None):
        t = self.find_task(query)
        if title is not None and str(title).strip():
            t['title'] = str(title).strip()[:180]
        if due is not None:
            if due and not is_date(due):
                raise FamilySaveError('Due date must be YYYY-MM-DD.')
            t['due'] = due or ''
        if priority is not None:
            p = str(priority).capitalize()
            if p not in PRIORITIES:
                raise FamilySaveError('Priority must be High, Medium or Low.')
            t['priority'] = p
        if area is not None and str(area).strip():
            t['area'] = str(area).strip()[:40]
        if notes is not None:
            t['notes'] = str(notes)[:1000]
        if next_action is not None:
            t['next'] = str(next_action)[:200]
        self.put('tasks', t['id'], t)
        self.event('task_updated', t['title'], t['id'])
        return self._task_view(t)

    # ---- journal (morning briefing / evening review) ---------------------------
    @staticmethod
    def _review_view(r):
        v = {'id': r['id'], 'date': r.get('date'), 'type': r.get('type')}
        if r.get('type') == 'morning':
            v.update(top_objective=r.get('goal') or None, plan=r.get('notes') or None)
        else:
            v.update(wins=r.get('wins') or None, lessons=r.get('lessons') or None,
                     tomorrow_first_action=r.get('tomorrowFirst') or None, tasks_carried_forward=r.get('carried'))
        return v

    def journal(self, limit=10):
        rows = self.items('reviews', sort_key='timestamp', reverse=True)
        return [self._review_view(r) for r in rows[:max(1, int(limit or 10))]]

    def add_journal_entry(self, kind, top_objective='', plan='', wins='', lessons='', tomorrow_first_action='',
                          carry_forward=False, on=None):
        kind = 'morning' if str(kind).lower().startswith('m') else 'evening'
        if on and not is_date(on):
            raise FamilySaveError('Date must be YYYY-MM-DD.')
        d = on or today()
        r = {'id': new_id(), 'date': d, 'type': kind, 'timestamp': stamp()}
        rows = []
        if kind == 'morning':
            r['goal'], r['notes'] = str(top_objective or '').strip(), str(plan or '').strip()
            if not r['goal'] and not r['notes']:
                raise FamilySaveError('A morning entry needs a top objective or a plan.')
        else:
            r['wins'], r['lessons'], r['tomorrowFirst'] = (str(wins or '').strip(), str(lessons or '').strip(),
                                                           str(tomorrow_first_action or '').strip())
            if not r['wins'] and not r['lessons'] and not r['tomorrowFirst']:
                raise FamilySaveError('An evening entry needs wins, lessons or tomorrow\'s first action.')
            carried = 0
            if carry_forward:
                for t in self.items('tasks'):
                    if t.get('status') != 'done' and str(t.get('scheduled') or '') <= d:
                        t['scheduled'] = plus_days(d, 1)
                        t['rollovers'] = int(t.get('rollovers') or 0) + 1
                        rows.append(('tasks', t['id'], t))
                        e = {'id': new_id(), 'timestamp': stamp(), 'type': 'task_carried', 'taskId': t['id'],
                             'details': 'Vector: %s → %s' % (t['title'], t['scheduled']), 'by': 'vector'}
                        rows.append(('events', e['id'], e))
                        carried += 1
            r['carried'] = carried
        rows.append(('reviews', r['id'], r))
        self.put_many(rows)
        self.event('review_saved', '%s %s' % (kind, d))
        return self._review_view(r)

    # ---- money -----------------------------------------------------------------
    def _people(self):
        return self.items('fitness.people')

    def _person(self, name_or_id, people=None):
        people = self._people() if people is None else people
        if not name_or_id:
            return None
        q = _norm(name_or_id)
        for p in people:
            if p.get('id') == name_or_id or _norm(p.get('name')) == q:
                return p
        if re.fullmatch(r'(i|me|my|myself)', q) and people:
            return people[0]
        raise FamilySaveError('No family member named "%s". Known: %s.' %
                              (name_or_id, ', '.join(p.get('name', '?') for p in people) or 'none yet'))

    @staticmethod
    def _txn_view(t, names):
        return {'txn_id': t['id'], 'date': t.get('date'), 'type': t.get('type'), 'amount': dollars(t.get('amount')),
                'category': t.get('category'), 'note': t.get('note') or t.get('payee') or None,
                'who': names.get(t.get('who')) if t.get('who') else None}

    def _names(self, people=None):
        return {p['id']: p.get('name') for p in (self._people() if people is None else people)}

    def transactions(self, month=None, category=None, limit=30):
        names = self._names()
        rows = [t for t in self.items('finance.txns') if t.get('type') in ('expense', 'income')]
        if month:
            rows = [t for t in rows if str(t.get('date') or '').startswith(month)]
        if category:
            rows = [t for t in rows if _norm(t.get('category')) == _norm(category)]
        rows.sort(key=lambda t: (str(t.get('date') or ''), str(t.get('created') or '')), reverse=True)
        return [self._txn_view(t, names) for t in rows[:max(1, int(limit or 30))]]

    def money_summary(self, month=None):
        m = month or this_month()
        if not re.fullmatch(r'\d{4}-\d{2}', m):
            raise FamilySaveError('Month must be YYYY-MM.')
        got = self.fetch('finance.txns', 'finance.bills', '_doc', 'fitness.people')
        names = {p['id']: p.get('name') for p in got.get('fitness.people', {}).values()}
        tx = [t for t in got.get('finance.txns', {}).values() if str(t.get('date') or '').startswith(m) and t.get('type') in ('expense', 'income')]
        by_cat, by_who = {}, {}
        for t in tx:
            if t.get('type') == 'expense':
                by_cat[t.get('category') or 'Other'] = by_cat.get(t.get('category') or 'Other', 0) + int(t.get('amount') or 0)
                w = names.get(t.get('who'), 'Shared') if t.get('who') else 'Shared'
                by_who[w] = by_who.get(w, 0) + int(t.get('amount') or 0)
        budgets = got.get('_doc', {}).get('finance.budgets') or {}
        bills = list(got.get('finance.bills', {}).values())
        unpaid = [b for b in bills if not (b.get('paid') or {}).get(m)]
        tx.sort(key=lambda t: (str(t.get('date') or ''), str(t.get('created') or '')), reverse=True)
        return {'month': m,
                'income': dollars(sum(int(t.get('amount') or 0) for t in tx if t.get('type') == 'income')),
                'spent': dollars(sum(int(t.get('amount') or 0) for t in tx if t.get('type') == 'expense')),
                'spent_by_category': {k: dollars(v) for k, v in sorted(by_cat.items(), key=lambda kv: -kv[1])},
                'spent_by_person': {k: dollars(v) for k, v in by_who.items()},
                'category_budgets': {k: dollars(v) for k, v in budgets.items() if v},
                'unpaid_bills_total': dollars(sum(int(b.get('amount') or 0) for b in unpaid)),
                'unpaid_bills': [{'name': b.get('name'), 'amount': dollars(b.get('amount')), 'due': bill_due(b, m)} for b in sorted(unpaid, key=lambda b: int(b.get('dueDay') or 0))],
                'recent': [self._txn_view(t, names) for t in tx[:10]]}

    def log_transaction(self, kind, amount, note='', category=None, on=None, who=None):
        kind = 'income' if str(kind).lower().startswith('in') else 'expense'
        cents = to_cents(amount)
        if on and not is_date(on):
            raise FamilySaveError('Date must be YYYY-MM-DD.')
        cats = INCOME if kind == 'income' else EXPENSE
        cat = None
        if category:
            cat = next((c for c in cats if _norm(c) == _norm(category)), None)
            if not cat:
                raise FamilySaveError('Category must be one of: %s.' % ', '.join(cats))
        people = self._people()
        P = self._person(who, people) if who else None
        note = str(note or '')[:140]
        tx = {'id': new_id(), 'type': kind, 'amount': cents, 'category': cat or guess_category(note, kind), 'date': on or today(),
              'note': note, 'payee': note[:80], 'accountId': None, 'who': P['id'] if P else None, 'reviewed': True,
              'billId': None, 'created': stamp()}
        self.put('finance.txns', tx['id'], tx)
        self.event('finance_' + kind, '$%.2f · %s%s' % (cents / 100, tx['category'], ' · ' + note if note else ''))
        return self._txn_view(tx, self._names(people))

    def bills(self, month=None):
        m = month or this_month()
        out = []
        for b in sorted(self.items('finance.bills'), key=lambda b: int(b.get('dueDay') or 0)):
            out.append({'bill_id': b['id'], 'name': b.get('name'), 'amount': dollars(b.get('amount')), 'category': b.get('category'),
                        'due': bill_due(b, m), 'paid_this_month': bool((b.get('paid') or {}).get(m))})
        return out

    def find_bill(self, query):
        bills = self.items('finance.bills')
        hit = [b for b in bills if b['id'] == str(query).strip()]
        if not hit:
            q = re.sub(r'\b(the|my|bill|payment)\b', ' ', _norm(query))
            q = re.sub(r'\s+', ' ', q).strip()
            if q:
                hit = [b for b in bills if _norm(b.get('name')) == q] or \
                      [b for b in bills if q in _norm(b.get('name')) or _norm(b.get('name')) in q]
        if not hit:
            raise FamilySaveError('No bill matches "%s". Bills: %s.' % (query, ', '.join(b.get('name', '?') for b in bills) or 'none'))
        if len(hit) > 1:
            raise FamilySaveError('More than one bill matches "%s". Use the bill_id.' % query)
        return hit[0]

    def mark_bill_paid(self, query, amount=None, on=None, who=None):
        if on and not is_date(on):
            raise FamilySaveError('Date must be YYYY-MM-DD.')
        b = self.find_bill(query)
        d = on or today()
        m = d[:7]
        if (b.get('paid') or {}).get(m):
            raise FamilySaveError('%s is already marked paid for %s.' % (b.get('name'), m))
        cents = to_cents(amount) if amount is not None else int(b.get('amount') or 0)
        people = self._people()
        P = self._person(who, people) if who else None
        tx = {'id': new_id(), 'type': 'expense', 'amount': cents, 'category': b.get('category') or 'Other', 'date': d,
              'note': b.get('name') or '', 'payee': (b.get('name') or '')[:80], 'accountId': None, 'who': P['id'] if P else None,
              'reviewed': True, 'billId': b['id'], 'created': stamp()}
        b['paid'] = dict(b.get('paid') or {})
        b['paid'][m] = tx['id']
        self.put_many([('finance.txns', tx['id'], tx), ('finance.bills', b['id'], b)])
        self.event('finance_expense', '$%.2f · %s · %s (bill paid)' % (cents / 100, tx['category'], b.get('name')))
        return {'bill': b.get('name'), 'month': m, 'transaction': self._txn_view(tx, self._names(people))}

    # ---- savings goals -------------------------------------------------------------
    def savings_goals(self):
        out = []
        for g in self.items('finance.goals', sort_key='created'):
            saved = sum(int(c.get('amount') or 0) for c in g.get('contributions') or [])
            out.append({'goal_id': g['id'], 'name': g.get('name'), 'target': dollars(g.get('target')), 'saved': dollars(saved),
                        'remaining': dollars(max(0, int(g.get('target') or 0) - saved)), 'deadline': g.get('deadline')})
        return out

    def add_to_savings(self, goal, amount, on=None, note=''):
        if on and not is_date(on):
            raise FamilySaveError('Date must be YYYY-MM-DD.')
        goals = self.items('finance.goals')
        q = _norm(goal)
        hit = [g for g in goals if g['id'] == str(goal).strip()] or [g for g in goals if _norm(g.get('name')) == q] or \
              [g for g in goals if q and q in _norm(g.get('name'))]
        if len(hit) != 1:
            raise FamilySaveError('%s savings goal matches "%s". Goals: %s.' % ('No' if not hit else 'More than one', goal,
                                                                             ', '.join(g.get('name', '?') for g in goals) or 'none'))
        g = hit[0]
        try:
            n = float(str(amount).replace('$', '').replace(',', ''))
        except ValueError:
            raise FamilySaveError('Amount must be a number of dollars (negative to withdraw).')
        cents = int(round(n * 100))
        if not cents:
            raise FamilySaveError('Amount must not be zero.')
        saved = sum(int(c.get('amount') or 0) for c in g.get('contributions') or [])
        if cents < 0 and -cents > saved:
            raise FamilySaveError('Only $%.2f is saved in %s.' % (saved / 100, g.get('name')))
        g['contributions'] = list(g.get('contributions') or []) + [{'id': new_id(), 'date': on or today(), 'amount': cents, 'note': str(note or '')[:80]}]
        self.put('finance.goals', g['id'], g)
        self.event('savings_contribution', '%s $%.2f → %s' % ('+' if cents > 0 else '−', abs(cents) / 100, g.get('name')))
        return {'goal': g.get('name'), 'saved': dollars(saved + cents), 'target': dollars(g.get('target'))}

    # ---- grocery list ----------------------------------------------------------------
    def grocery(self, include_checked=False):
        rows = self.items('grocery.items', sort_key='added')
        if not include_checked:
            rows = [i for i in rows if not i.get('checked')]
        order = {a: n for n, a in enumerate(AISLES)}
        rows.sort(key=lambda i: order.get(i.get('aisle'), 99))
        return [{'item_id': i['id'], 'name': i.get('name'), 'qty': i.get('qty') or None, 'aisle': i.get('aisle'), 'checked': bool(i.get('checked'))} for i in rows]

    def add_grocery(self, items):
        if isinstance(items, str):
            items = [x.strip() for x in re.split(r',|\n', items) if x.strip()]
        existing = {_norm(i.get('name')) for i in self.items('grocery.items') if not i.get('checked')}
        rows, added, skipped = [], [], []
        for it in items or []:
            if isinstance(it, str):
                it = {'name': it}
            name = str(it.get('name') or '').strip()[:60]
            if not name:
                continue
            if _norm(name) in existing:
                skipped.append(name)
                continue
            existing.add(_norm(name))
            aisle = it.get('aisle')
            aisle = next((a for a in AISLES if _norm(a) == _norm(aisle)), None) if aisle else None
            g = {'id': new_id(), 'name': name[0].upper() + name[1:], 'qty': str(it.get('qty') or '')[:30], 'aisle': aisle or guess_aisle(name),
                 'checked': False, 'source': 'vector', 'added': stamp()}
            rows.append(('grocery.items', g['id'], g))
            added.append(g['name'])
        if not rows:
            raise FamilySaveError('Nothing to add.' if not skipped else 'Already on the list: ' + ', '.join(skipped))
        self.put_many(rows)
        self.event('grocery_added', ', '.join(added))
        return {'added': added, 'already_on_list': skipped}

    def check_grocery(self, name, checked=True):
        rows = [i for i in self.items('grocery.items') if _norm(i.get('name')) == _norm(name) or i['id'] == str(name).strip()]
        if not rows:
            raise FamilySaveError('"%s" is not on the grocery list.' % name)
        for i in rows:
            i['checked'] = bool(checked)
        self.put_many([('grocery.items', i['id'], i) for i in rows])
        return {'item': rows[0].get('name'), 'checked': bool(checked)}

    # ---- health ----------------------------------------------------------------------------
    def people(self):
        return [{'name': p.get('name'), 'goals': p.get('goals') or {}} for p in self._people()]

    def log_health(self, kind, who=None, value=None, minutes=None, miles=None, activity=None, note=None,
                   calories=None, protein=None, carbs=None, fat=None, on=None):
        kind = str(kind or '').lower()
        if kind not in FIT_KINDS:
            raise FamilySaveError('Kind must be one of: %s.' % ', '.join(FIT_KINDS))
        if on and not is_date(on):
            raise FamilySaveError('Date must be YYYY-MM-DD.')
        people = self._people()
        if not people:
            raise FamilySaveError('No family members in Health yet. Open the Health tab on the phone once to create one.')
        P = self._person(who, people) if who else people[0]

        def pos(v):
            try:
                return float(v) if v is not None and float(v) > 0 else None
            except (TypeError, ValueError):
                return None

        e = {'id': new_id(), 'personId': P['id'], 'date': on or today(), 'kind': kind, 'created': stamp()}
        if kind == 'workout':
            mi, ml = pos(minutes), pos(miles)
            if not mi and not ml:
                raise FamilySaveError('A workout needs minutes or miles.')
            e['activity'] = activity if activity in ACTIVITIES else 'other'
            if mi:
                e['minutes'] = int(round(mi))
            if ml:
                e['miles'] = round(ml, 2)
            if note:
                e['note'] = str(note)[:80]
            what = '%s %s' % (e['activity'], ('%d min' % e['minutes']) if mi else ('%.1f mi' % ml))
        elif kind == 'meal':
            if not note and not pos(calories):
                raise FamilySaveError('A meal needs a description.')
            e['note'] = str(note or 'Meal')[:80]
            for k, v in (('calories', calories), ('protein', protein), ('carbs', carbs), ('fat', fat)):
                if pos(v):
                    e[k] = int(round(pos(v)))
            what = e['note'] + (' (%d kcal)' % e['calories'] if e.get('calories') else '')
        else:
            v = pos(value)
            if not v:
                raise FamilySaveError('A %s entry needs a number (%s).' % (kind, {'weight': 'lb', 'steps': 'steps', 'water': 'glasses', 'sleep': 'hours'}[kind]))
            e['value'] = int(round(v)) if kind in ('steps', 'water') else round(v, 1)
            what = '%s %s' % (kind, e['value'])
        self.put('fitness.logs', e['id'], e)
        self.event('fitness_' + kind, '%s: %s' % (P.get('name'), what))
        return {'person': P.get('name'), 'date': e['date'], 'kind': kind, 'entry': {k: v for k, v in e.items() if k not in ('id', 'personId', 'created')}}

    def health_today(self, who=None, on=None):
        d = on or today()
        people = self._people()
        logs = [l for l in self.items('fitness.logs') if l.get('date') == d]
        out = []
        for P in ([self._person(who, people)] if who else people):
            L = [l for l in logs if l.get('personId') == P['id']]
            weights = sorted([l for l in self.items('fitness.logs') if l.get('personId') == P['id'] and l.get('kind') == 'weight'], key=lambda l: l.get('date') or '')
            out.append({'person': P.get('name'), 'date': d,
                        'steps': sum(int(l.get('value') or 0) for l in L if l.get('kind') == 'steps') or None,
                        'water_glasses': sum(int(l.get('value') or 0) for l in L if l.get('kind') == 'water') or None,
                        'sleep_hours': next((l.get('value') for l in L if l.get('kind') == 'sleep'), None),
                        'active_minutes': sum(int(l.get('minutes') or 0) for l in L if l.get('kind') == 'workout') or None,
                        'calories': sum(int(l.get('calories') or 0) for l in L if l.get('kind') == 'meal') or None,
                        'protein_g': sum(int(l.get('protein') or 0) for l in L if l.get('kind') == 'meal') or None,
                        'meals': [l.get('note') for l in L if l.get('kind') == 'meal'],
                        'latest_weight_lb': weights[-1].get('value') if weights else None,
                        'goals': P.get('goals') or {}})
        return out

    # ---- the one-call briefing ------------------------------------------------------------
    def today_overview(self):
        d = today()
        got = self.fetch('tasks', 'finance.txns', 'finance.bills', 'reviews', 'grocery.items', 'finance.goals')
        tasks = list(got.get('tasks', {}).values())
        open_ = [t for t in tasks if t.get('status') != 'done']
        m = d[:7]
        week = plus_days(d, 7)
        # Bills due in the next 7 days (this month or early next month), plus unpaid ones already past due this month.
        next_month = plus_days(m + '-28', 7)[:7]
        bills = []
        for b in got.get('finance.bills', {}).values():
            for mon in (m, next_month):
                due, paid = bill_due(b, mon), bool((b.get('paid') or {}).get(mon))
                if d <= due <= week or (mon == m and due < d and not paid):
                    bills.append({'name': b.get('name'), 'amount': dollars(b.get('amount')), 'due': due, 'paid': paid, 'overdue': due < d and not paid})
        tx = [t for t in got.get('finance.txns', {}).values() if str(t.get('date') or '').startswith(m) and t.get('type') in ('expense', 'income')]
        reviews = sorted(got.get('reviews', {}).values(), key=lambda r: str(r.get('timestamp') or ''), reverse=True)
        pr = {'High': 0, 'Medium': 1, 'Low': 2}
        due_today = sorted([t for t in open_ if str(t.get('scheduled') or '') <= d], key=lambda t: (pr.get(t.get('priority'), 1), t.get('title') or ''))
        return {'date': d, 'weekday': date.fromisoformat(d).strftime('%A'),
                'tasks_for_today': [self._task_view(t) for t in due_today],
                'overdue_tasks': [self._task_view(t) for t in open_ if t.get('due') and t['due'] < d],
                'upcoming_tasks': [self._task_view(t) for t in sorted(open_, key=lambda t: t.get('scheduled') or '') if d < str(t.get('scheduled') or '') <= week][:10],
                'completed_today': [t.get('title') for t in tasks if t.get('status') == 'done' and str(t.get('completed') or '')[:10] == d],
                'bills_next_7_days': sorted(bills, key=lambda b: b['due']),
                'money_this_month': {'income': dollars(sum(int(t.get('amount') or 0) for t in tx if t.get('type') == 'income')),
                                     'spent': dollars(sum(int(t.get('amount') or 0) for t in tx if t.get('type') == 'expense'))},
                'grocery_items_to_buy': len([i for i in got.get('grocery.items', {}).values() if not i.get('checked')]),
                'savings_goals': [{'name': g.get('name'), 'saved': dollars(sum(int(c.get('amount') or 0) for c in g.get('contributions') or [])), 'target': dollars(g.get('target'))} for g in got.get('finance.goals', {}).values()],
                'latest_journal_entry': self._review_view(reviews[0]) if reviews else None}

    def activity(self, limit=20):
        rows = self.items('events', sort_key='timestamp', reverse=True)
        return [{'when': e.get('timestamp'), 'what': e.get('type'), 'details': e.get('details')} for e in rows[:max(1, int(limit or 20))]]


# ---- command line ---------------------------------------------------------------------------
def _cli(argv=None):
    import argparse
    import getpass
    ap = argparse.ArgumentParser(prog='familysave.py', description='Talk to The Family Save (the journal app) from this computer.')
    sub = ap.add_subparsers(dest='cmd')
    s = sub.add_parser('setup', help='save the Supabase URL and anon key'); s.add_argument('--url', required=True); s.add_argument('--anon-key', required=True)
    s = sub.add_parser('login', help='sign in (asks for the password)'); s.add_argument('email'); s.add_argument('--password', help='or set FAMILYSAVE_PASSWORD')
    sub.add_parser('logout'); sub.add_parser('status'); sub.add_parser('today', help='the one-call briefing'); sub.add_parser('activity')
    s = sub.add_parser('tasks'); s.add_argument('--all', action='store_true'); s.add_argument('--done', action='store_true'); s.add_argument('--area')
    s = sub.add_parser('add', help='add a task'); s.add_argument('title'); s.add_argument('--date'); s.add_argument('--due'); s.add_argument('--priority', default='Medium'); s.add_argument('--area'); s.add_argument('--notes', default=''); s.add_argument('--next', default='')
    s = sub.add_parser('done', help='complete a task'); s.add_argument('task')
    s = sub.add_parser('move', help='move a task (default: tomorrow)'); s.add_argument('task'); s.add_argument('--date')
    s = sub.add_parser('journal'); s.add_argument('--limit', type=int, default=10)
    s = sub.add_parser('morning', help='save a morning briefing'); s.add_argument('objective'); s.add_argument('--plan', default='')
    s = sub.add_parser('evening', help='save an evening review'); s.add_argument('--wins', default=''); s.add_argument('--lessons', default=''); s.add_argument('--tomorrow', default=''); s.add_argument('--carry', action='store_true', help='move unfinished tasks to tomorrow')
    s = sub.add_parser('money'); s.add_argument('--month')
    s = sub.add_parser('transactions'); s.add_argument('--month'); s.add_argument('--category'); s.add_argument('--limit', type=int, default=30)
    for k in ('spent', 'income'):
        s = sub.add_parser(k); s.add_argument('amount'); s.add_argument('note', nargs='?', default=''); s.add_argument('--category'); s.add_argument('--date'); s.add_argument('--who')
    s = sub.add_parser('bills'); s.add_argument('--month')
    s = sub.add_parser('paid', help='mark a bill paid'); s.add_argument('bill'); s.add_argument('--amount'); s.add_argument('--date'); s.add_argument('--who')
    s = sub.add_parser('grocery'); s.add_argument('--all', action='store_true')
    s = sub.add_parser('buy', help='add grocery items'); s.add_argument('items', nargs='+')
    s = sub.add_parser('bought', help='check off a grocery item'); s.add_argument('item')
    sub.add_parser('goals')
    s = sub.add_parser('save', help='add money to a savings goal (negative withdraws)'); s.add_argument('goal'); s.add_argument('amount'); s.add_argument('--date')
    s = sub.add_parser('health'); s.add_argument('--who'); s.add_argument('--date')
    s = sub.add_parser('log', help='log health: workout|weight|steps|water|sleep|meal'); s.add_argument('kind'); s.add_argument('--who'); s.add_argument('--value', type=float); s.add_argument('--minutes', type=float); s.add_argument('--miles', type=float); s.add_argument('--activity'); s.add_argument('--note'); s.add_argument('--calories', type=float); s.add_argument('--protein', type=float); s.add_argument('--date')
    sub.add_parser('tools', help='print the tool definitions (OpenAI function-calling format)')
    a = ap.parse_args(argv)
    if not a.cmd:
        ap.print_help()
        return 0
    c = Client()
    try:
        if a.cmd == 'setup':
            c.configure(a.url, a.anon_key); out = {'saved': True, 'server': c.url, 'next': 'familysave.py login you@example.com'}
        elif a.cmd == 'login':
            pw = a.password or os.environ.get('FAMILYSAVE_PASSWORD') or getpass.getpass('Family Save password: ')
            out = c.login(a.email, pw)
        elif a.cmd == 'logout':
            c.logout(); out = {'signed_in': False}
        elif a.cmd == 'status': out = c.status()
        elif a.cmd == 'today': out = c.today_overview()
        elif a.cmd == 'activity': out = c.activity()
        elif a.cmd == 'tasks': out = c.tasks('all' if a.all else 'done' if a.done else 'open', a.area)
        elif a.cmd == 'add': out = c.add_task(a.title, a.date, a.due, a.priority, a.area, a.notes, a.next)
        elif a.cmd == 'done': out = c.complete_task(a.task)
        elif a.cmd == 'move': out = c.move_task(a.task, a.date)
        elif a.cmd == 'journal': out = c.journal(a.limit)
        elif a.cmd == 'morning': out = c.add_journal_entry('morning', top_objective=a.objective, plan=a.plan)
        elif a.cmd == 'evening': out = c.add_journal_entry('evening', wins=a.wins, lessons=a.lessons, tomorrow_first_action=a.tomorrow, carry_forward=a.carry)
        elif a.cmd == 'money': out = c.money_summary(a.month)
        elif a.cmd == 'transactions': out = c.transactions(a.month, a.category, a.limit)
        elif a.cmd in ('spent', 'income'): out = c.log_transaction('expense' if a.cmd == 'spent' else 'income', a.amount, a.note, a.category, a.date, a.who)
        elif a.cmd == 'bills': out = c.bills(a.month)
        elif a.cmd == 'paid': out = c.mark_bill_paid(a.bill, a.amount, a.date, a.who)
        elif a.cmd == 'grocery': out = c.grocery(a.all)
        elif a.cmd == 'buy': out = c.add_grocery(a.items)
        elif a.cmd == 'bought': out = c.check_grocery(a.item)
        elif a.cmd == 'goals': out = c.savings_goals()
        elif a.cmd == 'save': out = c.add_to_savings(a.goal, a.amount, a.date)
        elif a.cmd == 'health': out = c.health_today(a.who, a.date)
        elif a.cmd == 'log': out = c.log_health(a.kind, a.who, a.value, a.minutes, a.miles, a.activity, a.note, a.calories, a.protein, on=a.date)
        elif a.cmd == 'tools':
            sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
            from tools import openai_tools
            out = openai_tools()
        else:
            ap.print_help(); return 0
    except FamilySaveError as e:
        print(json.dumps({'error': str(e)}), file=sys.stderr)
        return 1
    print(json.dumps(out, indent=1, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(_cli())
