# Ledger

A personal spending tracker for one person. SimpleFIN Bridge pulls
transactions from your banks once a day; every one lands in a review inbox
until you approve it (with a category, tags, or as a transfer); and the app
shows where the money went: a month's spending by category, trends over time,
net worth, and what people owe you.

It runs on Supabase (Postgres, auth, edge functions) with a static React app
on GitHub Pages. There is no other server.

## How it works

```
GitHub Actions (daily) ──► edge function `sync` ──► SimpleFIN Bridge
                                   │
                                   ▼
browser (GitHub Pages) ◄──► Supabase Postgres (row-level security)
```

- **Sync.** A scheduled workflow calls the `sync` edge function, which reads
  the SimpleFIN Access URL from Supabase Vault, fetches recent transactions,
  and saves accounts, daily balances and new transactions. New transactions
  arrive unapproved, with the category you last approved for that merchant
  filled in.
- **Review.** The web app talks to Postgres directly through supabase-js.
  Simple edits are table writes; anything touching several rows (approving,
  transfers, reimbursements, merging merchants) is a database function called
  with `rpc`, so it happens in one transaction.
- **Reports.** Totals come from database views and functions
  (`spending_lines`, `monthly_category_spend`, `monthly_cashflow`,
  `tag_spend`) that count approved transactions only, your share of each
  (net of what people owe you), and no transfers.

## Repository layout

```
src/                        the web app (Vite + React + TypeScript)
  App.tsx                   shell: sign-in gate, navigation, routes
  pages/                    one file per page: Spending, Trends, Owed, Accounts, Settings
  components/               UI pieces (each file starts with what it's for)
  lib/                      data access and pure helpers
    supabase.ts             the client
    transactions.ts         Spending's list: row shape, filters, queries
    reports.ts              the monthly reports behind Spending and Trends
    reimbursements.ts       what people owe you
    reimbursementMatch.ts   which payment pays back what (unit-tested)
    format.ts, months.ts, cents.ts   formatting, dates, money math
  styles.css                all styles; color tokens at the top

supabase/
  migrations/               the schema, applied in filename order (never edited once applied)
  functions/
    sync/                   the daily sync (called by GitHub Actions with a shared secret)
    sync-now/               Settings → Sync now (called by the signed-in user)
    simplefin-claim/        connects SimpleFIN from a one-time Setup Token
    _shared/                the sync itself (run-sync.ts) and SimpleFIN protocol helpers
  tests/                    schema tests (in-memory Postgres) and unit tests

.github/workflows/
  deploy.yml                builds the app and publishes it to GitHub Pages on every push to main
  sync.yml                  the daily sync
```

## Development

```
cp .env.example .env.local   # fill in the project URL and publishable key
npm install
npm run dev                  # http://localhost:5173
```

Checks:

```
npm run build       # type-check and build
npm run test:db     # applies every migration to in-memory Postgres (PGlite) and checks
                    # row-level security, grants, seeding, reports and Vault helpers
npm run test:sync   # unit tests for the SimpleFIN helpers and payment matching
deno check supabase/functions/*/index.ts
```

## Deploying

Merging to `main` deploys everything:

- the **web app**, by `.github/workflows/deploy.yml` (GitHub Pages);
- **migrations and edge functions**, by Supabase's GitHub integration, which
  applies new files in `supabase/migrations/` and deploys the functions listed
  in `supabase/config.toml`.

Because migrations run automatically, write them to be safe to re-run, and
never edit one that has already been applied: add a new one instead.

## Setting up your own copy

1. **Supabase.** Create a project and connect it to the repository (Project
   Settings → Integrations → GitHub) so merges to `main` apply the
   migrations and deploy the functions.
2. **Edge function secret.** Set `SYNC_SECRET` (any long random string) in
   Supabase → Edge Functions → Secrets.
3. **GitHub Pages.** In the repository: Settings → Pages → Source: *GitHub
   Actions*.
4. **Repository variables and secrets.** Settings → Secrets and variables →
   Actions:
   - variable `SUPABASE_URL`, e.g. `https://abcd1234.supabase.co`
   - variable `SUPABASE_PUBLISHABLE_KEY`, the publishable (anon) key
   - secret `SYNC_SECRET`, the same value as in step 2
5. **Auth redirect.** Supabase → Authentication → URL Configuration: set
   *Site URL* to your Pages URL (e.g. `https://you.github.io/ledger/`).
6. **Create your account** on the site, confirm the email, sign in.
7. **Lock it down.** Supabase → Authentication → Sign In / Providers → turn
   off *Allow new users to sign up*.
8. **Connect your banks.** In SimpleFIN Bridge, create a Setup Token and
   paste it in the app under Settings → Bank connection.

## Security model

- Every table has row-level security scoped to the signed-in user; the
  publishable key can read nothing without signing in.
- The SimpleFIN Access URL is stored encrypted in Supabase Vault and only the
  edge functions can read it. The browser can't even see which Vault secret
  holds it.
- `connections`, `balance_snapshots` and `sync_runs` are read-only from the
  browser; only the sync writes them.
- The sync is capped at 12 SimpleFIN requests a day (SimpleFIN allows about
  24) and pauses for a day after a rate-limit warning, so the Access Token
  can't be disabled by overuse.
- This repository is public, so the sync workflow logs only an HTTP status;
  details are in the app under Settings → Sync log.
