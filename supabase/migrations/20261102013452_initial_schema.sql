-- Personal budget app: initial schema (phase 1)
--
-- Conventions
--   * amounts are numeric(12,2); negative = money out, positive = money in
--     (same sign convention SimpleFIN uses)
--   * every table carries user_id and is locked down with row-level security,
--     so the browser (publishable key) can only ever see its own rows
--   * the sync/claim edge functions use the service role and bypass RLS

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- connections: one row per SimpleFIN Access URL (the URL itself lives in Vault)
-- ---------------------------------------------------------------------------

create table public.connections (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  label            text not null default 'SimpleFIN Bridge',
  vault_secret_id  uuid,                       -- id of the encrypted Access URL in vault.secrets
  status           text not null default 'active'
                     check (status in ('active', 'needs_attention', 'rate_limited', 'disabled')),
  status_message   text,
  last_synced_at   timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index connections_user_idx on public.connections (user_id);

-- ---------------------------------------------------------------------------
-- accounts
-- ---------------------------------------------------------------------------

create table public.accounts (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  connection_id  uuid references public.connections (id) on delete set null,  -- null for manual accounts (Venmo)
  external_id    text,                                                        -- SimpleFIN account id
  name           text not null,
  institution    text,
  type           text not null default 'other'
                   check (type in ('checking', 'savings', 'credit', 'manual', 'other')),
  currency       text not null default 'USD',
  balance        numeric(12,2),
  balance_date   timestamptz,
  hidden         boolean not null default false,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (connection_id, external_id)
);

create index accounts_user_idx on public.accounts (user_id);

-- ---------------------------------------------------------------------------
-- categories
--   is_income  keeps paychecks etc. out of spending totals
--   sort_order controls the order in menus
-- ---------------------------------------------------------------------------

create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null,
  group_name  text,
  is_income   boolean not null default false,
  sort_order  integer not null default 0,
  archived    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, name)
);

-- ---------------------------------------------------------------------------
-- merchants: one row per real merchant; remembers the category you last
-- approved for it (pre-fills, never auto-approves)
-- merchant_aliases: maps each normalized bank description to its merchant, so
--   several descriptions ("amzn mktp us", "amazon.com") can share one merchant.
--   Looked up once at import; the result is stored on transactions.merchant_id.
--   Merge = repoint the old merchant's aliases and transactions, then delete it.
-- ---------------------------------------------------------------------------

create table public.merchants (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name              text not null,
  last_category_id  uuid references public.categories (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index merchants_user_idx          on public.merchants (user_id);
create index merchants_last_category_idx on public.merchants (last_category_id);

create table public.merchant_aliases (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  merchant_id  uuid not null references public.merchants (id) on delete cascade,
  match_key    text not null,               -- normalized description used for matching
  created_at   timestamptz not null default now(),
  unique (user_id, match_key)
);

create index merchant_aliases_merchant_idx on public.merchant_aliases (merchant_id);

-- ---------------------------------------------------------------------------
-- import_batches: one row per CSV/OFX upload, so a bad import can be undone
-- ---------------------------------------------------------------------------

create table public.import_batches (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id      uuid not null references public.accounts (id) on delete cascade,
  filename        text not null,               -- label only; the file itself isn't stored
  row_count       integer not null default 0,  -- rows in the file, including skipped duplicates
  created_at      timestamptz not null default now()
);

create index import_batches_user_idx    on public.import_batches (user_id);
create index import_batches_account_idx on public.import_batches (account_id);

-- ---------------------------------------------------------------------------
-- transactions
--   approved = false until you review it in the Review inbox
-- ---------------------------------------------------------------------------

create table public.transactions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id        uuid not null references public.accounts (id) on delete cascade,
  source            text not null check (source in ('simplefin', 'csv', 'ofx', 'manual')),
  external_id       text,               -- SimpleFIN txn id, OFX FITID, or CSV dedupe hash
  import_batch_id   uuid references public.import_batches (id) on delete cascade,
  posted_date       date not null,
  transacted_at     timestamptz,
  amount            numeric(12,2) not null,
  description       text not null default '',
  payee             text,
  memo              text,
  pending           boolean not null default false,
  merchant_id       uuid references public.merchants (id) on delete set null,
  category_id       uuid references public.categories (id) on delete set null,
  approved          boolean not null default false,
  approved_at       timestamptz,
  is_transfer       boolean not null default false,
  transfer_pair_id  uuid references public.transactions (id) on delete set null,
  note              text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- one row per bank transaction per source; manual rows have no external_id
-- (nulls never conflict). Not a partial index, so supabase-js upsert can target it.
create unique index transactions_source_external_uq
  on public.transactions (account_id, source, external_id);

create index transactions_user_date_idx    on public.transactions (user_id, posted_date desc);
create index transactions_account_date_idx on public.transactions (account_id, posted_date desc);
create index transactions_unapproved_idx   on public.transactions (user_id, posted_date) where not approved;
create index transactions_category_idx     on public.transactions (category_id);
create index transactions_merchant_idx     on public.transactions (merchant_id);
create index transactions_batch_idx        on public.transactions (import_batch_id);
create index transactions_pair_idx         on public.transactions (transfer_pair_id);

-- ---------------------------------------------------------------------------
-- reimbursements: part of a transaction someone owes you
-- reimbursement_payments: links incoming payments (e.g. Venmo) to what was owed;
--   supports partial payments and one payment covering several items
-- ---------------------------------------------------------------------------

create table public.reimbursements (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  transaction_id  uuid not null references public.transactions (id) on delete cascade,
  who             text not null,
  amount          numeric(12,2) not null check (amount > 0),
  status          text not null default 'owed' check (status in ('owed', 'received', 'written_off')),
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index reimbursements_txn_idx  on public.reimbursements (transaction_id);
create index reimbursements_user_idx on public.reimbursements (user_id);
create index reimbursements_open_idx on public.reimbursements (user_id) where status = 'owed';

create table public.reimbursement_payments (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null default auth.uid() references auth.users (id) on delete cascade,
  reimbursement_id        uuid not null references public.reimbursements (id) on delete cascade,
  payment_transaction_id  uuid not null references public.transactions (id) on delete cascade,
  amount                  numeric(12,2) not null check (amount > 0),
  created_at              timestamptz not null default now(),
  unique (reimbursement_id, payment_transaction_id)
);

create index reimbursement_payments_payment_idx on public.reimbursement_payments (payment_transaction_id);
create index reimbursement_payments_user_idx    on public.reimbursement_payments (user_id);

-- ---------------------------------------------------------------------------
-- tags: your own labels (e.g. a trip); a transaction can carry several.
-- Tagged transactions are left out of normal spending unless the tag is
-- toggled on (see the reporting functions below)
-- ---------------------------------------------------------------------------

create table public.tags (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, name)
);

create table public.transaction_tags (
  transaction_id  uuid not null references public.transactions (id) on delete cascade,
  tag_id          uuid not null references public.tags (id) on delete cascade,
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (transaction_id, tag_id)
);

create index transaction_tags_tag_idx  on public.transaction_tags (tag_id);
create index transaction_tags_user_idx on public.transaction_tags (user_id);

-- ---------------------------------------------------------------------------
-- balance_snapshots: each account's balance once a day (SimpleFIN only reports
-- today's balance, so this is the only way to chart net worth over time)
-- ---------------------------------------------------------------------------

create table public.balance_snapshots (
  account_id  uuid not null references public.accounts (id) on delete cascade,
  date        date not null,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  balance     numeric(12,2) not null,
  primary key (account_id, date)
);

create index balance_snapshots_user_idx on public.balance_snapshots (user_id);

-- ---------------------------------------------------------------------------
-- sync_runs: audit log + rate-limit tracking for the daily SimpleFIN sync
-- ---------------------------------------------------------------------------

create table public.sync_runs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  connection_id  uuid references public.connections (id) on delete cascade,
  trigger        text not null default 'schedule' check (trigger in ('schedule', 'manual', 'initial')),
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  status         text not null default 'running' check (status in ('running', 'ok', 'warning', 'error')),
  request_count  integer not null default 0,
  new_count      integer not null default 0,
  updated_count  integer not null default 0,
  removed_count  integer not null default 0,
  messages       text[] not null default '{}'
);

create index sync_runs_recent_idx     on public.sync_runs (user_id, started_at desc);
create index sync_runs_connection_idx on public.sync_runs (connection_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

create trigger connections_updated_at    before update on public.connections    for each row execute function public.set_updated_at();
create trigger accounts_updated_at       before update on public.accounts       for each row execute function public.set_updated_at();
create trigger categories_updated_at     before update on public.categories     for each row execute function public.set_updated_at();
create trigger merchants_updated_at      before update on public.merchants      for each row execute function public.set_updated_at();
create trigger transactions_updated_at   before update on public.transactions   for each row execute function public.set_updated_at();
create trigger reimbursements_updated_at before update on public.reimbursements for each row execute function public.set_updated_at();
create trigger tags_updated_at           before update on public.tags           for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security: every table is scoped to the signed-in user
-- ---------------------------------------------------------------------------

alter table public.connections            enable row level security;
alter table public.accounts               enable row level security;
alter table public.categories             enable row level security;
alter table public.merchants              enable row level security;
alter table public.merchant_aliases       enable row level security;
alter table public.import_batches         enable row level security;
alter table public.transactions           enable row level security;
alter table public.reimbursements         enable row level security;
alter table public.reimbursement_payments enable row level security;
alter table public.tags                   enable row level security;
alter table public.transaction_tags       enable row level security;
alter table public.balance_snapshots      enable row level security;
alter table public.sync_runs              enable row level security;

-- Full access to your own rows
create policy "own rows" on public.accounts               for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on public.categories             for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on public.merchants              for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on public.merchant_aliases       for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on public.import_batches         for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on public.transactions           for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on public.reimbursements         for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on public.reimbursement_payments for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on public.tags                   for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on public.transaction_tags       for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Read-only from the browser: only the edge functions write these
create policy "read own rows" on public.connections       for select to authenticated using (user_id = (select auth.uid()));
create policy "read own rows" on public.balance_snapshots for select to authenticated using (user_id = (select auth.uid()));
create policy "read own rows" on public.sync_runs         for select to authenticated using (user_id = (select auth.uid()));

-- Explicit table privileges (don't rely on project-level defaults);
-- RLS above still decides which rows each user can touch
grant select, insert, update, delete on
  public.accounts, public.categories, public.merchants, public.merchant_aliases, public.import_batches,
  public.transactions, public.reimbursements, public.reimbursement_payments,
  public.tags, public.transaction_tags
  to authenticated;
grant select on public.balance_snapshots, public.sync_runs to authenticated;
revoke all on
  public.accounts, public.categories, public.merchants, public.merchant_aliases, public.import_batches,
  public.transactions, public.reimbursements, public.reimbursement_payments,
  public.tags, public.transaction_tags, public.balance_snapshots, public.sync_runs
  from anon;

-- The browser never needs the Vault pointer: client roles may read every
-- column except vault_secret_id (select explicit columns from the app)
revoke all on public.connections from anon, authenticated;
grant select (id, user_id, label, status, status_message, last_synced_at, created_at, updated_at)
  on public.connections to authenticated;

-- ---------------------------------------------------------------------------
-- Starter categories, created automatically when you sign up
-- ---------------------------------------------------------------------------

create or replace function public.seed_starter_categories(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.categories (user_id, name, group_name, is_income, sort_order)
  values
    (p_user_id, 'Groceries',         'Everyday',  false,  10),
    (p_user_id, 'Dining',            'Everyday',  false,  20),
    (p_user_id, 'Transit',           'Getting around', false, 30),
    (p_user_id, 'Rideshare & Taxi',  'Getting around', false, 40),
    (p_user_id, 'Housing',           'Bills',     false,  50),
    (p_user_id, 'Utilities',         'Bills',     false,  60),
    (p_user_id, 'Subscriptions',     'Bills',     false,  70),
    (p_user_id, 'Shopping',          'Lifestyle', false,  80),
    (p_user_id, 'Health',            'Lifestyle', false,  90),
    (p_user_id, 'Travel',            'Lifestyle', false, 100),
    (p_user_id, 'Entertainment',     'Lifestyle', false, 110),
    (p_user_id, 'Gifts',             'Lifestyle', false, 120),
    (p_user_id, 'Fees',              'Other',     false, 130),
    (p_user_id, 'Income',            'Income',    true,  140)
  on conflict (user_id, name) do nothing;
$$;

revoke execute on function public.seed_starter_categories(uuid) from public, anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.seed_starter_categories(new.id);
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Reporting (security_invoker views + invoker functions, so RLS applies to
-- whoever queries them)
--
-- spending_lines: one row per transaction that counts as spending, with your
--   share and its tags
--   * transfers, pending charges and income categories excluded
--   * net of reimbursements that are owed or received (written-off ones count
--     as your spending again)
--   * incoming payments linked to a reimbursement are excluded
--
-- monthly_category_spend(include_tags) / monthly_cashflow(include_tags):
--   untagged spending, plus any transaction carrying at least one of
--   include_tags. Default (no tags) = normal spending without trips etc.
--   Called from the app with rpc().
--
-- tag_spend: total cost of each tag (e.g. a trip), regardless of toggles
-- ---------------------------------------------------------------------------

create view public.spending_lines
with (security_invoker = true)
as
with reimbursed as (
  select transaction_id, sum(amount) as amount
  from public.reimbursements
  where status in ('owed', 'received')
  group by transaction_id
),
tagged as (
  select transaction_id, array_agg(tag_id) as tag_ids
  from public.transaction_tags
  group by transaction_id
)
select
  t.id         as transaction_id,
  t.user_id,
  t.posted_date,
  date_trunc('month', t.posted_date)::date as month,
  t.category_id,
  c.name       as category_name,
  c.group_name as category_group,
  (-t.amount - coalesce(r.amount, 0))::numeric(12,2) as spent,
  coalesce(tg.tag_ids, '{}') as tag_ids
from public.transactions t
left join public.categories c on c.id = t.category_id
left join reimbursed r        on r.transaction_id = t.id
left join tagged tg           on tg.transaction_id = t.id
where not t.is_transfer
  and not t.pending
  and coalesce(c.is_income, false) = false
  and not exists (
    select 1 from public.reimbursement_payments rp where rp.payment_transaction_id = t.id
  );

create function public.monthly_category_spend(include_tags uuid[] default '{}')
returns table (
  user_id           uuid,
  month             date,
  category_id       uuid,
  category_name     text,
  category_group    text,
  spent             numeric(12,2),
  transaction_count bigint
)
language sql
stable
set search_path = ''
as $$
  select s.user_id, s.month, s.category_id, s.category_name, s.category_group,
         sum(s.spent)::numeric(12,2), count(*)
  from public.spending_lines s
  where cardinality(s.tag_ids) = 0 or s.tag_ids && include_tags
  group by s.user_id, s.month, s.category_id, s.category_name, s.category_group;
$$;

create function public.monthly_cashflow(include_tags uuid[] default '{}')
returns table (
  user_id   uuid,
  month     date,
  income    numeric(12,2),
  spending  numeric(12,2),
  net       numeric(12,2)
)
language sql
stable
set search_path = ''
as $$
  with income as (
    select t.user_id, date_trunc('month', t.posted_date)::date as month, sum(t.amount) as income
    from public.transactions t
    join public.categories c on c.id = t.category_id
    where c.is_income and not t.is_transfer and not t.pending
      and not exists (
        select 1 from public.reimbursement_payments rp where rp.payment_transaction_id = t.id
      )
    group by 1, 2
  ),
  spending as (
    select m.user_id, m.month, sum(m.spent) as spending
    from public.monthly_category_spend(include_tags) m
    group by 1, 2
  )
  select
    coalesce(i.user_id, s.user_id),
    coalesce(i.month, s.month),
    coalesce(i.income, 0)::numeric(12,2),
    coalesce(s.spending, 0)::numeric(12,2),
    (coalesce(i.income, 0) - coalesce(s.spending, 0))::numeric(12,2)
  from income i
  full join spending s on s.user_id = i.user_id and s.month = i.month;
$$;

create view public.tag_spend
with (security_invoker = true)
as
select
  tg.id   as tag_id,
  tg.user_id,
  tg.name,
  coalesce(sum(s.spent), 0)::numeric(12,2) as spent,
  count(s.transaction_id) as transaction_count,
  min(s.posted_date) as first_date,
  max(s.posted_date) as last_date
from public.tags tg
left join public.spending_lines s on tg.id = any (s.tag_ids)
group by tg.id, tg.user_id, tg.name;

revoke all on public.spending_lines, public.tag_spend from anon;
grant select on public.spending_lines, public.tag_spend to authenticated;
revoke execute on function public.monthly_category_spend(uuid[]), public.monthly_cashflow(uuid[]) from public, anon;
grant execute on function public.monthly_category_spend(uuid[]), public.monthly_cashflow(uuid[]) to authenticated;
