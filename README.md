# The Family Save — phone-first family command center

(Formerly Command Journal.) Tasks, calendar, home finances, a dashboard, and hands-free voice with the Vector assistant.

A working mobile-friendly, offline-first personal task journal prototype. No external runtime dependencies.

## Features
- Dashboard: safe-to-spend, savings rate, month-end spending pace vs budget, cash flow, spending vs your 3-month average, upcoming bills, weekly task completions and stuck tasks
- Fitness tab (whole family): workouts, weight trend, steps, water, sleep, meals vs calorie/protein targets, and a weekly meal plan (Vector AI can fill it in)
- Strength tab: workout plans typed or spoken naturally ("flat bench 225 for 15, 315 for 10"), log actual sets by voice or on screen, plan-vs-actual, estimated 1RM progress / holding / decline vs last session, PRs, next-session targets, weekly volume and muscle balance
- Savings goals (Money tab): target, deadline, add/withdraw, on-track pacing and $/month needed; set-aside money reduces Safe to spend
- Grocery list (Fitness tab): grouped by store section, check off while shopping, build from the meal plan (full ingredient lists with Vector AI)
- Money tab: income/expenses, bills, category budgets; Calendar with day/week task lists
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
- Local data only. No account sync, cloud database, authentication, server AI, Calendar access, or native Android notification scheduling yet.
- SpeechRecognition availability and data processing depend on browser; it may require a network connection, and voice capture is not guaranteed offline.
- The built-in interpreter understands a fixed set of phrasings (add / complete / move tasks with dates, money in/out, bills) and always asks for confirmation.
- Optional **Vector AI** (Settings): with your own Anthropic API key, requests are sent to Claude (`claude-opus-5-5`) together with your open tasks, bills and this month's money summary, so free-form speech and questions work. The key is stored only in this browser (not in backups). Changes still require confirmation; the built-in rules are used when AI is off, offline, or fails. The official `@anthropic-ai/sdk` is vendored as a browser bundle in `vendor/`.
- The existing 6 AM/10 PM ChatGPT scheduled check-ins operate separately.
- Do not use for confidential company data until authenticated storage, encryption, and work/personal boundaries are implemented.

## Later Vector contract
Tasks should eventually sync via an authenticated versioned API that supports unique IDs, append-only event history, per-user namespaces, explicit conflict handling, encrypted storage, and audited AI actions. Avoid embedding an AI provider in the journal's business logic.
