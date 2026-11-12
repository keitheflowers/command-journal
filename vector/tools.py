"""The tools Vector can use on the journal, in one place.

Each tool has a name, a short description written for a language model, and a
JSON Schema for its arguments. The same list feeds the MCP server
(mcp_server.py) and OpenAI-style function calling (chat.py, Ollama, LM Studio,
vLLM...). `call()` runs one and returns plain JSON-able data.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from familysave import (ACTIVITIES, AISLES, EXPENSE, FIT_KINDS, INCOME, PRIORITIES, Client,  # noqa: E402
                        FamilySaveError)


def _s(desc, **extra):
    d = {'type': 'string', 'description': desc}
    d.update(extra)
    return d


def _n(desc):
    return {'type': 'number', 'description': desc}


def _obj(props, required=()):
    return {'type': 'object', 'properties': props, 'required': list(required), 'additionalProperties': False}


DATE = 'YYYY-MM-DD'

TOOLS = [
    {'name': 'today_overview',
     'description': "Start here. Today's date, tasks for today, overdue and upcoming tasks, bills due in the next 7 days, money this month, "
                    "savings goals and the latest journal entry, in one call.",
     'parameters': _obj({})},
    {'name': 'list_tasks',
     'description': 'List tasks with their task_id. status: open (default), done or all.',
     'parameters': _obj({'status': _s('open, done or all', enum=['open', 'done', 'all']),
                         'area': _s('only this area (e.g. Home, Work, Money)'),
                         'limit': _n('max results, default 50')})},
    {'name': 'add_task',
     'description': 'Add a task. Use the user\'s words for the title, without dates or priority words.',
     'parameters': _obj({'title': _s('short task title'),
                         'date': _s('day to do it, %s (default today)' % DATE),
                         'due': _s('hard deadline, %s (optional)' % DATE),
                         'priority': _s('High, Medium (default) or Low', enum=PRIORITIES),
                         'area': _s('life area such as Work, Home, Family, Health, Money, Personal'),
                         'notes': _s('extra details (optional)'),
                         'next_action': _s('the first concrete step (optional)')}, ['title'])},
    {'name': 'complete_task',
     'description': 'Mark a task done. Give its task_id or enough of its title to match exactly one open task.',
     'parameters': _obj({'task': _s('task_id or part of the title')}, ['task'])},
    {'name': 'reopen_task',
     'description': 'Undo completing a task.',
     'parameters': _obj({'task': _s('task_id or part of the title')}, ['task'])},
    {'name': 'move_task',
     'description': 'Reschedule an open task to another day (default tomorrow). The due date is unchanged.',
     'parameters': _obj({'task': _s('task_id or part of the title'), 'date': _s('new day, %s (default tomorrow)' % DATE)}, ['task'])},
    {'name': 'update_task',
     'description': 'Change a task\'s title, due date, priority, area, notes or next action. Only the fields given change.',
     'parameters': _obj({'task': _s('task_id or part of the title'), 'title': _s('new title'), 'due': _s('%s, or "" to clear' % DATE),
                         'priority': _s('High, Medium or Low', enum=PRIORITIES), 'area': _s('new area'), 'notes': _s('new notes'),
                         'next_action': _s('new next step')}, ['task'])},
    {'name': 'journal_entries',
     'description': 'Recent journal entries: morning briefings (top objective, plan) and evening reviews (wins, lessons, tomorrow\'s first action).',
     'parameters': _obj({'limit': _n('how many, default 10')})},
    {'name': 'add_journal_entry',
     'description': 'Save a morning briefing (top_objective and/or plan) or an evening review (wins, lessons, tomorrow_first_action). '
                    'carry_forward=true on an evening entry moves every unfinished task scheduled by today to tomorrow, like the app does.',
     'parameters': _obj({'kind': _s('morning or evening', enum=['morning', 'evening']),
                         'top_objective': _s('morning: the one outcome that matters most today'),
                         'plan': _s('morning: approach, time blocks, expected obstacles'),
                         'wins': _s('evening: wins and completed work'),
                         'lessons': _s('evening: blockers and lessons learned'),
                         'tomorrow_first_action': _s('evening: tomorrow\'s first action'),
                         'carry_forward': {'type': 'boolean', 'description': 'evening: also move unfinished tasks to tomorrow (default false)'},
                         'date': _s('%s, default today' % DATE)}, ['kind'])},
    {'name': 'money_summary',
     'description': 'Money for a month (default this month): income, spent, spending by category and by person, category budgets, unpaid bills, recent transactions. Dollars.',
     'parameters': _obj({'month': _s('YYYY-MM, default the current month')})},
    {'name': 'list_transactions',
     'description': 'Recent spending and income, newest first. Dollars.',
     'parameters': _obj({'month': _s('YYYY-MM (optional)'), 'category': _s('only this category (optional)'), 'limit': _n('default 30')})},
    {'name': 'log_transaction',
     'description': 'Record spending or income. Amount in dollars. Category is guessed from the note when not given.',
     'parameters': _obj({'type': _s('expense or income', enum=['expense', 'income']),
                         'amount': _n('dollars, e.g. 42.5'),
                         'note': _s('what or where, e.g. "Kroger" or "paycheck"'),
                         'category': _s('expense: %s. income: %s.' % (', '.join(EXPENSE), ', '.join(INCOME))),
                         'date': _s('%s, default today' % DATE),
                         'who': _s('family member who spent or earned it (optional)')}, ['type', 'amount'])},
    {'name': 'list_bills',
     'description': 'Recurring bills with this month\'s due date and whether each is paid.',
     'parameters': _obj({'month': _s('YYYY-MM, default the current month')})},
    {'name': 'mark_bill_paid',
     'description': 'Mark a bill paid for the month of the date: records the expense and ticks the bill off.',
     'parameters': _obj({'bill': _s('bill name or bill_id'), 'amount': _n('dollars, if different from the usual amount'),
                         'date': _s('%s, default today' % DATE), 'who': _s('who paid it (optional)')}, ['bill'])},
    {'name': 'savings_goals',
     'description': 'Savings goals with target, saved so far, remaining and deadline. Dollars.',
     'parameters': _obj({})},
    {'name': 'add_to_savings',
     'description': 'Add money to a savings goal (negative amount withdraws).',
     'parameters': _obj({'goal': _s('goal name or goal_id'), 'amount': _n('dollars; negative to withdraw'), 'date': _s('%s, default today' % DATE),
                         'note': _s('optional note')}, ['goal', 'amount'])},
    {'name': 'grocery_list',
     'description': 'The shared grocery list, grouped by store aisle. Unchecked items only unless include_checked.',
     'parameters': _obj({'include_checked': {'type': 'boolean', 'description': 'also show items already bought'}})},
    {'name': 'add_grocery_items',
     'description': 'Add items to the grocery list. Duplicates of unchecked items are skipped.',
     'parameters': _obj({'items': {'type': 'array', 'description': 'items to add',
                                   'items': _obj({'name': _s('item'), 'qty': _s('quantity like "2 lb" (optional)'),
                                                  'aisle': _s('store section (optional)', enum=AISLES)}, ['name'])}}, ['items'])},
    {'name': 'check_grocery_item',
     'description': 'Tick a grocery item off as bought (or un-tick it).',
     'parameters': _obj({'item': _s('item name'), 'checked': {'type': 'boolean', 'description': 'default true'}}, ['item'])},
    {'name': 'health_today',
     'description': 'Each family member\'s day: steps, water, sleep, active minutes, calories, protein, meals, latest weight and their goals.',
     'parameters': _obj({'who': _s('one family member (optional)'), 'date': _s('%s, default today' % DATE)})},
    {'name': 'log_health',
     'description': 'Log health for a family member: workout (activity + minutes and/or miles), weight (lb), steps, water (glasses), sleep (hours) or meal (note + calories, protein, carbs, fat if known). Never estimate nutrition the user did not give.',
     'parameters': _obj({'kind': _s('what to log', enum=FIT_KINDS), 'who': _s('family member (default: the first person)'),
                         'value': _n('weight lb / steps / water glasses / sleep hours'),
                         'minutes': _n('workout minutes'), 'miles': _n('workout miles'),
                         'activity': _s('workout type', enum=ACTIVITIES), 'note': _s('workout note or what was eaten'),
                         'calories': _n('meal calories'), 'protein': _n('meal protein g'), 'carbs': _n('meal carbs g'), 'fat': _n('meal fat g'),
                         'date': _s('%s, default today' % DATE)}, ['kind'])},
    {'name': 'recent_activity',
     'description': 'The change log: what was added, completed or spent recently, by whom (phones and Vector).',
     'parameters': _obj({'limit': _n('default 20')})},
]

TOOL_NAMES = [t['name'] for t in TOOLS]


def openai_tools():
    """OpenAI / Ollama / LM Studio / vLLM function-calling format."""
    return [{'type': 'function', 'function': {'name': t['name'], 'description': t['description'], 'parameters': t['parameters']}} for t in TOOLS]


def mcp_tools():
    """Model Context Protocol tools/list format."""
    return [{'name': t['name'], 'description': t['description'], 'inputSchema': t['parameters']} for t in TOOLS]


def call(name, args=None, client=None):
    """Run one tool. Raises FamilySaveError with a plain-language message on problems."""
    if isinstance(args, str):
        try:
            args = json.loads(args or '{}')
        except ValueError:
            raise FamilySaveError('Arguments must be a JSON object.')
    if args is not None and not isinstance(args, dict):
        raise FamilySaveError('Arguments must be a JSON object.')
    a = dict(args or {})
    c = client or Client()
    g = a.get
    if name == 'today_overview':
        return c.today_overview()
    if name == 'list_tasks':
        return c.tasks(g('status') or 'open', g('area'), g('limit') or 50)
    if name == 'add_task':
        return c.add_task(g('title'), g('date'), g('due'), g('priority') or 'Medium', g('area'), g('notes') or '', g('next_action') or '')
    if name == 'complete_task':
        return c.complete_task(g('task'))
    if name == 'reopen_task':
        return c.reopen_task(g('task'))
    if name == 'move_task':
        return c.move_task(g('task'), g('date'))
    if name == 'update_task':
        return c.update_task(g('task'), g('title'), g('due'), g('priority'), g('area'), g('notes'), g('next_action'))
    if name == 'journal_entries':
        return c.journal(g('limit') or 10)
    if name == 'add_journal_entry':
        return c.add_journal_entry(g('kind') or 'morning', g('top_objective') or '', g('plan') or '', g('wins') or '', g('lessons') or '',
                                   g('tomorrow_first_action') or '', bool(g('carry_forward')), g('date'))
    if name == 'money_summary':
        return c.money_summary(g('month'))
    if name == 'list_transactions':
        return c.transactions(g('month'), g('category'), g('limit') or 30)
    if name == 'log_transaction':
        return c.log_transaction(g('type') or 'expense', g('amount'), g('note') or '', g('category'), g('date'), g('who'))
    if name == 'list_bills':
        return c.bills(g('month'))
    if name == 'mark_bill_paid':
        return c.mark_bill_paid(g('bill'), g('amount'), g('date'), g('who'))
    if name == 'savings_goals':
        return c.savings_goals()
    if name == 'add_to_savings':
        return c.add_to_savings(g('goal'), g('amount'), g('date'), g('note') or '')
    if name == 'grocery_list':
        return c.grocery(bool(g('include_checked')))
    if name == 'add_grocery_items':
        return c.add_grocery(g('items') or [])
    if name == 'check_grocery_item':
        return c.check_grocery(g('item'), True if g('checked') is None else bool(g('checked')))
    if name == 'health_today':
        return c.health_today(g('who'), g('date'))
    if name == 'log_health':
        return c.log_health(g('kind'), g('who'), g('value'), g('minutes'), g('miles'), g('activity'), g('note'),
                            g('calories'), g('protein'), g('carbs'), g('fat'), g('date'))
    if name == 'recent_activity':
        return c.activity(g('limit') or 20)
    raise FamilySaveError('Unknown tool "%s". Tools: %s.' % (name, ', '.join(TOOL_NAMES)))


def call_text(name, args=None, client=None):
    """Run a tool and return (text, is_error) for a model to read."""
    try:
        return json.dumps(call(name, args, client), ensure_ascii=False, indent=1), False
    except FamilySaveError as e:
        return json.dumps({'error': str(e)}), True
