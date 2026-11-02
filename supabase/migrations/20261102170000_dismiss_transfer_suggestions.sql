-- "Not a transfer": remember suggested pairs you've dismissed so they stop
-- showing up. Both transactions stay unreviewed, to be categorized normally.
-- A dismissal disappears with either transaction (on delete cascade).

create table if not exists public.dismissed_transfer_pairs (
  out_id      uuid not null references public.transactions (id) on delete cascade,
  in_id       uuid not null references public.transactions (id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, out_id, in_id)
);

create index if not exists dismissed_transfer_pairs_out_idx on public.dismissed_transfer_pairs (out_id);
create index if not exists dismissed_transfer_pairs_in_idx  on public.dismissed_transfer_pairs (in_id);

alter table public.dismissed_transfer_pairs enable row level security;
drop policy if exists "own rows" on public.dismissed_transfer_pairs;
-- Foreign keys ignore RLS, so also require both transactions to be yours
-- (the subqueries run under your RLS and only see your own rows).
create policy "own rows" on public.dismissed_transfer_pairs for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.transactions t where t.id = out_id)
    and exists (select 1 from public.transactions t where t.id = in_id)
  );

grant select, insert, delete on public.dismissed_transfer_pairs to authenticated;
grant select, insert, update, delete on public.dismissed_transfer_pairs to service_role;
revoke all on public.dismissed_transfer_pairs from anon;

-- Same view as before, minus pairs you dismissed. The dismissal must be your
-- own (d.user_id), so nobody else's row can hide your suggestions.
create or replace view public.transfer_suggestions
with (security_invoker = true)
as
select
  o.user_id,
  o.id         as out_id,
  i.id         as in_id,
  o.account_id as out_account_id,
  i.account_id as in_account_id,
  i.amount     as amount,
  o.posted_date as out_date,
  i.posted_date as in_date,
  abs(i.posted_date - o.posted_date) as days_apart
from public.transactions o
join public.transactions i
  on i.user_id = o.user_id
 and i.account_id <> o.account_id
 and i.amount = -o.amount
where o.amount < 0
  and abs(i.posted_date - o.posted_date) <= 5
  and not o.approved and not i.approved
  and not o.pending and not i.pending
  and not o.is_transfer and not i.is_transfer
  and not exists (
    select 1 from public.dismissed_transfer_pairs d
    where d.out_id = o.id and d.in_id = i.id and d.user_id = o.user_id
  );
