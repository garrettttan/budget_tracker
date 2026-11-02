# Ledger

A personal spending tracker: SimpleFIN Bridge pulls transactions from your banks
daily, you review and categorize every one, and trend charts show where the
money goes. Runs on Supabase (database, auth, edge functions) with the web app
hosted on GitHub Pages.

## Layout

```
src/                     web app (Vite + React + TypeScript)
supabase/migrations/     database schema, applied in filename order
supabase/functions/      edge functions (SimpleFIN claim + daily sync, phase 2)
.github/workflows/       GitHub Pages deploy on every push to main
```

## One-time setup

1. **Database.** Apply `supabase/migrations/*.sql` to the project (Claude does
   this through the Supabase connector, or paste into the SQL editor).
2. **GitHub Pages.** In the repo: Settings → Pages → Source: *GitHub Actions*.
3. **Repository variables.** Settings → Secrets and variables → Actions →
   Variables tab, add:
   - `SUPABASE_URL`: e.g. `https://abcd1234.supabase.co`
   - `SUPABASE_PUBLISHABLE_KEY`: the publishable (anon) key
4. **Auth redirect.** Supabase → Authentication → URL Configuration: set
   *Site URL* to your Pages URL (e.g. `https://you.github.io/ledger/`).
5. **Create your account** on the site, confirm the email, sign in.
6. **Lock it down.** Supabase → Authentication → Sign In / Providers → turn off
   *Allow new users to sign up*.

## Local development

```
cp .env.example .env.local   # fill in the two values
npm install
npm run dev
```

## Security model

- Every table has row-level security scoped to your user id; the publishable
  key can read nothing without signing in.
- The SimpleFIN Access URL is stored encrypted in Supabase Vault and only the
  edge functions can read it. The browser can't even see which Vault secret
  holds it.
- `connections`, `balance_snapshots` and `sync_runs` are read-only from the
  browser; only the sync function writes them.
