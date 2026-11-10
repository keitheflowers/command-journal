# The Family Save — phone-first family command center

(Formerly Command Journal.) Tasks, calendar, home finances, a dashboard, and hands-free voice with the Vector assistant.

A working mobile-friendly, offline-first personal task journal prototype. No external runtime dependencies.

## Features
- Dashboard: safe-to-spend, savings rate, month-end spending pace vs budget, cash flow, spending vs your 3-month average, upcoming bills, weekly task completions and stuck tasks
- Navigation: five tabs (Home, Plan, Money, Health, Settings) with sub-tabs
- Health → Meals: eating patterns (3 meals, 3 + snacks, 6 small meals, 16:8, 18:6, one meal a day, custom), calorie/macro targets with a Mifflin-St Jeor calculator, food log by meal (recent foods, saved meals, common foods, USDA FoodData Central search, custom, Vector AI estimates), fasting timer with goals, streak and history, meal plan that follows the pattern, grocery list
- Adaptive targets (Health → Meals): after ~3 weeks of food logs and weigh-ins, estimates your real maintenance from intake vs weight trend and suggests a new calorie target (max ±300/week); one tap applies it
- Weekly recap: on Sunday/Monday Home shows last week's money, tasks, training (PRs), fitness and nutrition plus next week's bills and focus; say "how was my week"
- Debt payoff (Money → Debt): APR and minimums per card/loan, avalanche vs snowball vs minimums with payoff date, total interest and savings from extra payments
- Family accounts and cloud sync (Settings → ☁️ Family sync): email sign-in, start a family or join with an invite code, every item synced as its own record with tombstones for deletes; Vector AI can run through the family server so no phone needs an API key. Setup: see `supabase/README.md`
- First-run setup (names, family, starting balance, eating pattern, lock/backup) and plain-language Privacy and Terms pages (templates to review before commercial use)
- Health → Training: rest timer on set completion and a plate calculator; Health → Overview: today's rings (move, protein, sleep, water), fasting and planned workout
- Fitness (whole family): workouts, weight trend, steps, water, sleep, meals vs calorie/protein targets, and a weekly meal plan (Vector AI can fill it in)
- Strength tab: workout plans typed or spoken naturally ("flat bench 225 for 15, 315 for 10"), log actual sets by voice or on screen, plan-vs-actual, estimated 1RM progress / holding / decline vs last session, PRs, next-session targets, weekly volume and muscle balance
- Savings goals (Money tab): target, deadline, add/withdraw, on-track pacing and $/month needed; set-aside money reduces Safe to spend
- Grocery list (Fitness tab): grouped by store section, check off while shopping, build from the meal plan (full ingredient lists with Vector AI)
- Money tab (YNAB + Monarch style): zero-based budget with Ready to Assign, rollover, overspending, category targets, move money, Age of Money; accounts (checking, savings, cash, credit cards, loans, investments, property) with net worth history, reconcile and transfers; transactions with search, filters, splits, tags, review queue, auto-categorize rules and bank CSV import with duplicate detection; recurring/subscription detection; cash-flow (Sankey), spending trends and top payees. No live bank sync (needs a paid aggregator and a server).
- Calendar with day/week task lists
- Task register with area, priority, schedule, due date, next action, notes, complete/reopen
- Today dashboard and overdue indicators
- Morning notes and evening review with automatic carryover of open scheduled tasks
- Immutable-style activity log entries and rollover counts
- Simple voice-command interpreter with confirmation; native browser speech recognition when supported
- Local browser storage and JSON backup/import
- PWA install metadata and cache-first offline service worker

## Run / deploy
1. Upload the four app files (`index.html`, `manifest.webmanifest`, `sw.js`, `icon.svg`) to any **HTTPS static hosting service** (GitHub Pages, Cloudflare Pages, Netlify, etc.).
2. Open the HTTPS URL on Android Chrome. Use Chrome menu → **Add to Home screen** / **Install app**.
3. Add a task, complete it, perform your evening review, export a backup.

A web server is needed for service workers and reliable installability. Opening `index.html` as `file://` may display the UI but can have storage/security restrictions and no PWA install.

## Limitations
- Data stays on the phone unless Family sync is set up (needs your own Supabase project, see `supabase/README.md`). No Calendar access or native Android notification scheduling in the web version.
- SpeechRecognition availability and data processing depend on browser; it may require a network connection, and voice capture is not guaranteed offline.
- The built-in interpreter understands a fixed set of phrasings (add / complete / move tasks with dates, money in/out, bills) and always asks for confirmation.
- Optional **Vector AI** (Settings): with your own Anthropic API key, requests are sent to Claude (`claude-opus-5-5`) together with your open tasks, bills and this month's money summary, so free-form speech and questions work. The key is stored only in this browser (not in backups). Changes still require confirmation; the built-in rules are used when AI is off, offline, or fails. The official `@anthropic-ai/sdk` is vendored as a browser bundle in `vendor/`.
- The existing 6 AM/10 PM ChatGPT scheduled check-ins operate separately.
- Do not use for confidential company data until authenticated storage, encryption, and work/personal boundaries are implemented.

## Later Vector contract
Tasks should eventually sync via an authenticated versioned API that supports unique IDs, append-only event history, per-user namespaces, explicit conflict handling, encrypted storage, and audited AI actions. Avoid embedding an AI provider in the journal's business logic.

## Tests
Browser tests cover every area: family sync between two phones (against a fake sync server), the AI proxy, adaptive targets, weekly recap, debt payoff, first-run setup, tabs, tasks and dates, calendar, hands-free voice, money (budget, accounts, CSV import, rules, splits, recurring, reports, voice), fitness, grocery, savings, strength (parser, progress, programs), backups, app lock (PIN + fingerprint) and Vector AI (mocked API).

```
npm install
npx playwright install chromium   # first time only
npm test                          # or: node tests/run.js money   (filter by name)
```
GitHub Actions runs `npm run check` and `npm test` on every push (`.github/workflows/test.yml`).
