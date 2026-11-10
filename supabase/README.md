# Family accounts, sync and server AI (Supabase)

This folder turns on three things in The Family Save:

- **Accounts:** sign in with an email and password.
- **Family sync:** everyone in a family shares the same tasks, money, grocery list, meals and training, on every phone.
- **Vector AI without a personal key:** phones send requests to your server (`claude-proxy`), and the server adds your Anthropic key.

You need a free Supabase project and about 15 minutes. Nothing here costs money until you outgrow Supabase's free tier. AI requests are billed to your Anthropic account.

## 1. Create the project
1. Go to supabase.com and create a project. Save the database password somewhere safe.
2. In **SQL Editor → New query**, paste all of `schema.sql` and click **Run**. This creates the tables, the security rules (row-level security) and the family functions.
3. In **Authentication → Sign In / Providers → Email**, keep Email turned on. Choose one:
   - Turn **Confirm email** off while you test (sign-up works straight away).
   - Leave it on for real users. The app will say "check your email" after sign-up.
4. In **Authentication → URL Configuration**, set the Site URL to your app's address (for example `https://keitheflowers.github.io/command-journal/`).

## 2. Point the app at it
In **Project Settings → API**, copy the **Project URL** and the **anon public** key into `config.js`:

```js
window.FS_CONFIG = {
  supabaseUrl: 'https://abcd1234.supabase.co',
  supabaseAnonKey: 'eyJhbGciOi...'
};
```

The anon key is meant to be public. The security rules in `schema.sql` protect the data: a user can only read and write their own family's records.

Commit and push. Everyone then sees **Settings → ☁️ Family sync**. If you leave `config.js` blank, a person can still enter a server URL and key in that panel.

## 3. Deploy the AI proxy
Install the Supabase CLI (`npm i -g supabase`), then from the repo folder run:

```
supabase login
supabase link --project-ref abcd1234
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...      # your key: stays on the server
supabase secrets set AI_DAILY_LIMIT=200                # optional, per person per day
supabase secrets set ALLOWED_ORIGIN=https://keitheflowers.github.io   # optional
supabase functions deploy claude-proxy
```

On a phone, sign in, then turn on **Settings → Family sync → "Vector AI through Family Save"**. Vector now works without a key on the phone.

## How sync works
- Each item (task, transaction, bill, food log, workout...) is one row in `records`, so two phones can change different things at the same time without overwriting each other.
- A deleted item is kept as a tombstone (`deleted = true`) so other phones learn about the delete.
- The server stamps every change with its own clock. Phones pull changes about every minute, when the app comes back into view, and right after a change is made.
- If two phones change the *same* item before syncing, the phone that hasn't sent its change yet keeps it and sends it next.
- What isn't synced: the app lock PIN, fingerprint, personal API key, hands-free settings and anything else kept per phone.

## Before going commercial
- Turn on **Confirm email**, and set up a custom SMTP sender (Authentication → Emails).
- Add a way to delete an account. For now, delete the user in Authentication → Users: their membership goes with them, and an empty family can be deleted from the `households` table.
- Have the Privacy and Terms pages reviewed, and fill in your contact details.
- Consider a paid Supabase plan for daily backups and point-in-time recovery.
