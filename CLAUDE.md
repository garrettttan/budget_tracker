# Ledger: context for Claude Code

Personal YNAB-style spending tracker for one user (Garrett, NYC). Full build
plan: https://claude.ai/artifact/Vy9euCxBXrLegJXUcK2UBz

## Where things live

- GitHub repo: https://github.com/garrettttan/budget_tracker (web app deploys to GitHub Pages)
- Supabase project: `budget_tracker`, ref `ppfxuyueackbytpbqqva`,
  URL https://ppfxuyueackbytpbqqva.supabase.co, region us-east-2, Free plan.
  The same org also has an unrelated project "Fantasy Survivor"; never touch it.

## Status (Nov 3, 2026)

**Done:** phase 1 (foundation), phase 2 (SimpleFIN connect + daily sync), and phase 3:
review/transfer/merge database functions; one Transactions page (now Spending) that is also the
review inbox (filter To review / Approved / All, searchable category picker on every row,
an Approved checkbox to approve or unapprove, transfer suggestions with
Confirm / × dismiss, merchant name with the bank's text on hover or tap, "load more");
editing approved rows (recategorize, mark transfer, send back to Review); Settings →
Merchants (rename, merge); tags (a Tags column; on phones, in the row's tap-to-expand details: "+ Tag" picks or
creates one, × removes it, clicking it filters Transactions via `?tag=`; Settings → Tags adds,
renames, deletes); renaming accounts on the Accounts page (the sync sets an account's
name only when it first creates it, so your name sticks); a select column on Transactions
whose bar approves, adds a tag to (or creates one), or removes a tag from every selected row;
manual accounts (Accounts → Add manual account: name, class, balance; Edit sets name and
balance, Delete removes it and its transactions); Add transaction on Transactions (account,
date, amount out/in, description, category or Transfer, note), saved with `source = 'manual'`
and already approved, the form staying open for the next one (Delete transaction in its details
removes it). All of these are direct table
writes under RLS, no new database functions.

- A manual account's balance is whatever you last set (no trigger sums its transactions, so
  a later CSV backfill can't skew it), and it gets no `balance_snapshots` rows (the browser
  can't write them). Trends' net worth over time has to handle that.
- Manual transactions get no `merchant_id`, so they don't teach or use merchant memory.

**Phase 4 (Reimbursements): done** (Nov 3). In a charge's tap-to-expand details,
Expect reimbursement (who, how much with Half / The rest, note); the row then shows "Sam owes
$40" and "your share". Money in gets "Link to what someone owes" (pick the person, untick
items), and Transactions suggests likely paybacks under "Paid back?" (someone named in the
text, else one unique exact amount: `src/lib/reimbursementMatch.ts`). Add transaction can
record money in as "Pays back Sam" (a Venmo payment), which links it. A linked payment shows
"Payback, not income" instead of a category; Unlink payment in its details undoes it. Owed to me
(`/owed`) lists open items by person (Received for cash, Write off, × to stop expecting) and
the last 30 settled ones (Reopen).

**Phase 5 (Trends): done** (Nov 4; reorganized Nov 5). The month view lives on **Spending**
(the old Transactions page, `/spending`): at the top, **Spending in [month ▾]** (a
heading dropdown, `?month=YYYY-MM`, default this month; normal spending only, no tag toggles):
Spent / Income / Saved and a category donut with a ranked list (six colored slices, the rest fold
into gray "Other"). Tapping a category sets `?category=&status=all` and narrows the list (tap again
to clear). All (the default) and Approved show the picked month; To review, `?tag=` and explicit `?from=&to=` aren't
limited to it. The list's **Approved**, **Category** and **Tags** column headers filter (`components/HeaderFilter.tsx`):
tap one for a searchable checklist, spreadsheet style (all ticked; untick to hide; Select all ticks or
unticks what the search matches; Only per row). Category and Tags list only what the list's range
and approval filter hold, with a count each (`fetchPresent`, three columns paged 1,000 at a time;
the header filters themselves don't narrow it, and unticked items stay listed so they can come back). Category keys: category ids, `none` (Uncategorized),
`transfer` → `?hidecat=`; tag keys: tag ids, `untagged` ("No tags") → `?hidetag=` (URL only). Hidden
categories leave the list, pie and Spent; hidden tags leave the list (an anti-join:
`hidden_tags:transaction_tags!left(tag_id)` + `.is('hidden_tags', null)`; hiding `untagged` adds an
inner join). Only on a category hides every other key; Only on a tag uses `?tag=` (rows can carry
several tags). The Approved header sets `?status=` (both ticked = All, the default; untick one for
To review or Approved; the last ticked can't be unticked) and replaced the To review / Approved / All
buttons; the table and its headers always render, even for an empty month. An explicit `?category=` (pie tap) overrides hidden categories. On phones the Tags
column shows just a count (tags are edited in the row's details) and Approved's header is ✓, so the
table fits at 390px. **Pending transactions** sit in the list by date (All and To review, not Approved),
following the date range and category filters, **read-only**: when a charge posts, the bank usually
sends it under a new id and the sync deletes the pending row, so a category, tags or a note set on it
would be lost. No select box, picker or Approved box; the pre-filled category shows as text. Tapping a
pie category is the same as Only in the Category header. Filtering is meant to feel calm: the pie keeps every category
(filtered-out ones faded, in place, so it never reshapes) and its slices tween ~250ms when values change;
the list keeps its rows (pending too) until new ones arrive and fades only if that takes over 100ms; the
"Filters are on · Show all" note sits beside the Transactions heading so it doesn't push the list. All
motion is off under prefers-reduced-motion. `/trends`, top to bottom: range buttons (Last 12 months / This year / 6 / 3 months,
`?range=`) and "Include tagged" toggles (`?tags=`), scoping cash flow (income vs spending columns),
Categories (avg / month and total; a row opens a modal with that category by month), net worth (one
point per month: synced accounts' latest `balance_snapshots` on or before month end + manual accounts
at their current balance); then tag totals (`tag_spend`, all time). Clicking a month opens Spending
with `?status=all&month=` (+ `category=` from the modal). Charts
are hand-rolled SVG in `src/components/charts.tsx` (no chart library): hover and keyboard focus show a
tooltip. Garrett removed the explanatory text and "Show as table" views on purpose; don't add them back.

**Next: phase 6, Backfill** (CSV/OFX import from Jan 1 2026, dedupe, undo).

The scheduled sync works: a `schedule` run on Nov 2 logged an `ok` `sync_runs` row.

Keep personal financial details (account names or numbers, balances, transaction counts,
institutions) out of this public repo: code, tests, commits, PRs and this file.

**Setup facts:** live at https://garrettttan.github.io/budget_tracker/ (Pages from GitHub
Actions; repo variables `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`; secret `SYNC_SECRET`).
Supabase Auth Site URL = the Pages URL; new sign-ups are off.

**Testing UI changes:** a test user with made-up data exists in the live project (its
credentials are kept out of the repo). Local Playwright scripts in `.local/e2e/` (excluded
via `.git/info/exclude`, never pushed) drive `npm run dev` on port 5173 as that user, so a
PR branch can be clicked through before merge.

## Workflow

- Never push to `main`. Every change goes on a branch with a PR for Garrett to review;
  merging to `main` deploys to Pages. Exception: a commit that changes only `CLAUDE.md`
  can be pushed straight to `main`.
- **Merging to `main` deploys Supabase too** (GitHub integration, "Deploy to production"):
  new migrations are applied (recorded under the filename's version) and the edge functions
  declared in `config.toml` are deployed. Auth/API settings in `config.toml` are ignored, so
  its localhost `site_url` doesn't touch production. Never apply migrations by hand; keep
  them safe to re-run. Manual function deploy, if ever needed:
  `supabase functions deploy <name> --project-ref ppfxuyueackbytpbqqva --use-api`
  (add `--no-verify-jwt` for `sync`). Automatic branching stays off (paid on Free plan).
- Avoid stacked PRs: the repo doesn't auto-delete merged branches, so a stacked PR merges
  into its base branch instead of `main`.
- To redeploy without a code change: Actions → Deploy to GitHub Pages → Run workflow.

## Decisions already made (don't relitigate)

- **Import provider: SimpleFIN Bridge** ($15/yr, up to 25 institutions). Chosen over
  Plaid (free Trial is capped at 10 Items, and removing Items doesn't free slots) and
  Teller (narrower coverage). No second provider for now.
- **No rule-based auto-categorization.** Every transaction lands unapproved in a Review
  inbox (like YNAB). Only automation: merchant memory pre-fills the category last
  approved for that merchant, still unapproved.
- **Transfer is a flag (`is_transfer`), not a category.** Card payments / moves between
  own accounts are excluded from spending. App suggests pairs (opposite amounts across
  own accounts within 5 days); user confirms.
- **Reimbursements** are first-class: mark part of a transaction as owed by someone;
  link the incoming payment later. Category spending counts only your share; written-off
  reimbursements count fully again; linked payments aren't income.
- **Account classes: Cash** (checking, savings, Venmo), **Investments**, **Liabilities**
  (credit cards), in `accounts.class`. Investments are balance-only: the sync updates the
  balance and daily snapshot but imports no transactions (investment trades aren't
  spending). New accounts are guessed (negative balance or "credit"/"card" in the name →
  liability, else cash); set investments on the Accounts page, which deletes their
  imported transactions after a confirm.
- **Venmo is not on SimpleFIN**, so it's a manual account (no `connection_id`): payments
  entered by hand or via Venmo CSV. Venmo cash-outs to the bank are transfers.
- **Backfill all of 2026** via CSV/OFX import (SimpleFIN only has ~90 days).
- **Budgeting: tracking only for v1.** Monthly per-category targets later
  (`monthly_targets (category_id, month, amount)`, no changes to existing tables).
- **Categories:** Groceries, Dining, Transit, Rideshare & Taxi, Housing, Utilities,
  Subscriptions, Shopping, Health, Travel, Entertainment, Gifts, Fees, Income. No Gas (NYC).
  **Uncategorized is no category** (`category_id` null), not a category row: the picker shows it as
  "Uncategorized", and a row can be approved with it (Nov 5; the short-lived Uncategorized
  category was removed by migration).
- **Totals count only approved transactions** (Spending's pie and Spent, Trends, tag totals), and
  money in counts toward spending only in a spending category (a refund). Uncategorized money in
  is neither spending nor income until you categorize it.
- **Hosting:** new Supabase project + GitHub Pages frontend.

- **Daily sync trigger: GitHub Actions** (`.github/workflows/sync.yml`, 10:17 UTC), chosen to
  keep everything in the repo, over cron-job.org and `pg_cron` (which stops if the Free
  project pauses). Scheduled workflows in public repos auto-disable after 60 days without
  commits, so each run re-enables itself via the API (keepalive); backstops are GitHub's
  warning email and the stale-sync warning on Accounts (> 36 h). Logs are public: the
  workflow prints only the HTTP code and run status.

## SimpleFIN facts that shape the sync (phase 2)

From https://beta-bridge.simplefin.org/info/developers:
- Expect ≤ 24 requests/day; exceeding the warning level disables the Access Token.
  Warnings arrive in the `errors` array of `/accounts` responses (deprecated in v2 in favor
  of `errlist`, so read both).
- Each `/accounts` request's start-date→end-date range is limited to 90 days (the guide
  said 60 earlier), but live responses warn above **45 days** ("may be capped"), so the
  sync uses 45-day windows. Use `version=2`.
- Pending transactions may have `posted = 0`. Amounts/balances are numeric strings; dates
  are epoch seconds.
- History depth varies by bank (~90 days typical).
- Setup Token (base64) decodes to a claim URL; POST to it once to get the permanent
  Access URL (`https://user:pass@host/simplefin`). Token works only once.
- No categories in the data.

Sync design: one run/day; start-date = last posted date − 10 days; include pending;
upsert accounts + daily balance snapshot; upsert transactions on
(account_id, source, external_id); delete pending rows in the window that SimpleFIN no
longer returns; pre-fill category from merchant memory; suggest transfer pairs; log to
`sync_runs`. First sync walks back in 45-day chunks (max 3 requests). On a rate-limit
warning, stop and skip the next run. Transfer-pair suggestions are deferred to phase 3.

Access URL stored in **Supabase Vault** via `save_simplefin_access_url` /
`get_simplefin_access_url` (security definer, service role only).

Code: `supabase/functions/_shared/simplefin.ts` (pure protocol helpers, unit-tested with
Node), `_shared/run-sync.ts` (DB writes, read top-down: plan → fetch → accounts →
transactions), `sync/` (Bearer `SYNC_SECRET`), `simplefin-claim/` (user JWT). Run guard:
≤ 12 SimpleFIN requests per 24 h however often it's called, and skip a day after a
rate-limit warning.

## Schema notes (see the migration for details)

14 tables: connections, accounts, categories, merchants, merchant_aliases, import_batches,
transactions, reimbursements, reimbursement_payments, tags, transaction_tags,
dismissed_transfer_pairs, balance_snapshots, sync_runs.
Views (`security_invoker`): `spending_lines` (per-transaction share + `tag_ids`; approved rows only,
money in only with a non-income category), `tag_spend`
(total per tag, e.g. a trip). Functions (call with `rpc`): `monthly_category_spend(include_tags)`,
`monthly_cashflow(include_tags)`.

- **Tags:** a transaction can have several. Normal spending = untagged only; toggling tags on
  in the view adds transactions carrying any of them. A per-tag "exclude from normal spending"
  switch was considered and deferred (add a column on `tags` later if needed).

- Amounts `numeric(12,2)`; negative = money out (SimpleFIN's convention).
- Every table has `user_id` + RLS `user_id = (select auth.uid())`.
- `connections`, `balance_snapshots`, `sync_runs` are read-only from the browser.
- `accounts.class` (`cash` | `investment` | `liability`) replaced the unused `accounts.type`.
- Review functions (security invoker, call with `rpc`): `approve_transactions(ids)` approves
  any posted rows (no category = Uncategorized; never pending), updates merchant memory, and
  pre-fills other unreviewed rows of those merchants; `mark_transfer(id)`,
  `confirm_transfer(out, in)`; `merge_merchants(from, into)`. Editing approved rows
  (Spending page): `recategorize_transactions(ids, category)` (null = Uncategorized; also teaches
  merchant memory, which ignores rows with no category) and `send_to_review(ids)` (keeps the category as a pre-fill). Either one un-pairs
  a transfer and sends its other side back to Review. Merchant memory lives in
  `learn_merchant_categories(ids)`, shared by approve and recategorize. View `transfer_suggestions`:
  unreviewed opposite amounts in different accounts within 5 days, computed, not stored.
  "Not a transfer" stores the pair in `dismissed_transfer_pairs` (yours only; cascades with
  either transaction), and the view skips it.
- Reimbursement functions (security invoker, `rpc`): `expect_reimbursement(txn, who, amount,
  note)` (posted money out only; all owed + received on a charge ≤ the charge);
  `link_reimbursement_payment(payment, ids)` covers the given owed items oldest charge first,
  each up to what's still owed, marks fully paid ones received, and approves the payment with
  no category (it's excluded from spending and income); `unlink_reimbursement_payment(payment)`
  reverses it (received → owed, payment back to Review). Status changes (received by hand,
  written off, reopen) and removing an unpaid item are direct table writes. `spending_lines`
  counts a written-off item's paid part as reimbursed, so only the unpaid part is your
  spending again. Embeds between `transactions`, `reimbursements` and `reimbursement_payments`
  must name the foreign key (`reimbursements!reimbursements_transaction_id_fkey(...)`): the
  link table gives PostgREST a second path.
- `delete_manual_transaction(id)` (security invoker, `rpc`): Delete transaction in a manual
  row's details. Only `source = 'manual'`; refuses a charge whose reimbursements have payments
  linked (unlink them first); unlinks a payback first (what it paid is owed again); sends the
  other side of a transfer back to Review; unpaid reimbursements and tags cascade.
- Settings → Categories: add, reorder (`sort_order`, the order every picker uses), and an Edit
  modal (name, group, Income) are direct table writes. `delete_category(id, into)` (security
  invoker, `rpc`) moves its transactions and merchant memory to `into` first; null `into` leaves
  them Uncategorized (no category).
- `connections.vault_secret_id` is not readable by client roles (column grants), so the
  app must `select` explicit columns from `connections`, never `*`.
- `merchants` holds one row per real merchant (name + `last_category_id`);
  `merchant_aliases` maps each normalized description (`match_key`, unique per user) to a
  merchant. Sync looks up the alias once and stores `transactions.merchant_id`. Merge =
  repoint aliases and transactions to the kept merchant, then delete the other.
- `reimbursement_payments` is a link table (added beyond the plan's single
  `payment_transaction_id` column) to support partial payments and one payment covering
  several owed items.
- Starter categories are seeded by a trigger on `auth.users` insert
  (`handle_new_user` → `seed_starter_categories`, both security definer, not callable
  by clients).
- **Grant everything explicitly.** On this project, tables created by migrations give
  `anon`/`authenticated`/`service_role` no read/write by default, and new functions are
  executable only by their owner. RLS bypass is not a grant: the service role needs table
  grants too (phase 2 migration). The test stub mirrors these defaults.

## Web app

Vite + React 18 + TypeScript + supabase-js, `HashRouter` and `base: './'` so it works
from any Pages subpath. Pages: Spending (`src/pages/Spending.tsx`; the month summary from
`components/MonthSpending.tsx`, then the list: filter All (default) / To review / Approved from the Approved header via
`?status=`, plus `?month=`, `?tag=`, `?hidecat=`, `?hidetag=`, `?category=` (`none` = Uncategorized), `?from=` and `?to=`;
every row has a category picker and an Approved checkbox; `/transactions` and `/review` redirect
here keeping their query), Trends, Owed to me (phone tab says "Owed"), Accounts, Settings, SignIn.
Email + password auth (single user).

Design: Public Sans (tabular figures), paper `#F4F6F7`, ink `#16232F`, one accent teal
`#0E6E74`, outflow `#9A3B2E`, inflow `#2D7550`; dark mode via prefers-color-scheme.
Chart series: `--viz-income` teal `#00919C` (dark `#1C9AA3`) and `--viz-spending` orange
`#C25A22` (dark `#D2702F`), checked with the dataviz palette validator (color-blind separation,
contrast) on both surfaces. Pie slices use `--viz-cat-1..6` (blue, orange, aqua, yellow,
magenta, green, in that order) + `--viz-cat-other` gray, also validated. Don't chart the
outflow/inflow red and green as two series: they fail the color-blind check.
Left rail on desktop → bottom tabs under 720px. Lists are plain register tables with
rules, no cards. The to-review count shows only on the To review button and the nav badge. Avoid all-caps labels.

Buttons: always `components/Button.tsx` (never a bare `<button>`), with a `variant`:
`primary` (filled accent), `secondary` (outlined, fills accent on hover), `link`, `icon`
(needs `aria-label`); `size="small"` inside table rows. Disabled buttons fade with a
not-allowed cursor; give a disabled action a `title` that says why.

## Build phases

1. Foundation: **done**
2. SimpleFIN connect + daily sync (claim function, Vault, sync function, schedule, sync log): **done**
3. Review + categorization (inbox, approve, merchant memory/cleanup, transfer pairing,
   tags, manual accounts, Add transaction, bulk actions): **done**
4. Reimbursements (Expect reimbursement, Owed to me, link + split payments, Venmo manual entry): **done**
5. Trends (spending by category, category over time, cash flow, net worth, tag toggles and
   per-tag totals): **done**
6. Backfill (CSV/OFX import from Jan 1 2026, dedupe, undo)

## Commands

```
npm install
npm run dev        # needs .env.local (see .env.example)
npm run build
npm run test:db    # applies every migration to in-memory Postgres (PGlite) with stubbed
                   # auth + Vault schemas; checks RLS, grants, seeding, reports, Vault
npm run test:sync  # unit tests for the SimpleFIN helpers (Node's built-in test runner)
deno check supabase/functions/sync/index.ts supabase/functions/simplefin-claim/index.ts
```
