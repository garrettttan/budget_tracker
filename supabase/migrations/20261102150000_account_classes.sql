-- Account classes: Cash (checking, savings, Venmo), Investments, Liabilities
-- (credit cards). Replaces accounts.type, which nothing used yet.
--
-- Investments are balance-only: the sync keeps their balance and daily
-- snapshot (net worth) current but imports no transactions, since trades
-- and dividends aren't spending.
--
-- Manual accounts (Venmo) were type 'manual'; that's already implied by
-- connection_id being null, so they're simply Cash.

alter table public.accounts add column if not exists class text;

-- Backfill from the old type column, if it's still there (safe to re-run)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'accounts' and column_name = 'type'
  ) then
    update public.accounts
    set class = case when type = 'credit' then 'liability' else 'cash' end
    where class is null;
    alter table public.accounts drop column type;
  end if;
end;
$$;

update public.accounts set class = 'cash' where class is null;

alter table public.accounts
  alter column class set default 'cash',
  alter column class set not null;

alter table public.accounts drop constraint if exists accounts_class_check;
alter table public.accounts
  add constraint accounts_class_check check (class in ('cash', 'investment', 'liability'));
