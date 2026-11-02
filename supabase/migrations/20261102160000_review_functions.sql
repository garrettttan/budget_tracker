-- Phase 3: Review, transfers, and merchant cleanup
--
-- Each multi-step action is one function, so it fully happens or not at all.
-- All are security invoker (the default): they run as the signed-in user, so
-- row-level security still limits them to your own rows. Called with rpc().

-- ---------------------------------------------------------------------------
-- approve_transactions: approve what's ready, then teach merchant memory
--   * approves rows that have a category or are transfers; pending rows wait
--   * each merchant remembers the category you just approved (latest date wins)
--   * your other unreviewed rows from those merchants that have no category
--     get it pre-filled, still unapproved
-- Returns how many rows were approved.
-- ---------------------------------------------------------------------------

create or replace function public.approve_transactions(p_ids uuid[])
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_approved integer;
begin
  update public.transactions
  set approved = true, approved_at = now()
  where id = any (p_ids)
    and not approved
    and not pending
    and (category_id is not null or is_transfer);
  get diagnostics v_approved = row_count;

  update public.merchants m
  set last_category_id = latest.category_id
  from (
    select distinct on (merchant_id) merchant_id, category_id
    from public.transactions
    where id = any (p_ids) and approved and not is_transfer
      and merchant_id is not null and category_id is not null
    order by merchant_id, posted_date desc
  ) latest
  where m.id = latest.merchant_id;

  update public.transactions t
  set category_id = m.last_category_id
  from public.merchants m
  where m.id = t.merchant_id
    and m.last_category_id is not null
    and m.id in (select merchant_id from public.transactions where id = any (p_ids) and approved)
    and not t.approved
    and not t.is_transfer
    and t.category_id is null;

  return v_approved;
end;
$$;

-- ---------------------------------------------------------------------------
-- Transfers: money moving between your own accounts. Not spending, so no
-- category; approved as soon as you confirm.
-- ---------------------------------------------------------------------------

-- One side only, e.g. money moved into an investment account (which imports
-- no transactions) or a Venmo cash-out before Venmo is entered.
create or replace function public.mark_transfer(p_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.transactions
  set is_transfer = true, category_id = null, approved = true, approved_at = now()
  where id = p_id and not pending;
  if not found then
    raise exception 'Transaction not found, or still pending';
  end if;
end;
$$;

-- Both sides: an outflow from one account and the matching inflow in another.
create or replace function public.confirm_transfer(p_out uuid, p_in uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_out public.transactions;
  v_in  public.transactions;
begin
  select * into v_out from public.transactions where id = p_out and not pending;
  select * into v_in  from public.transactions where id = p_in  and not pending;
  if v_out.id is null or v_in.id is null then
    raise exception 'Transaction not found, or still pending';
  end if;
  if v_out.account_id = v_in.account_id then
    raise exception 'A transfer is between two different accounts';
  end if;
  if v_out.amount <> -v_in.amount then
    raise exception 'A transfer''s two sides must have opposite amounts';
  end if;

  update public.transactions
  set is_transfer = true,
      category_id = null,
      transfer_pair_id = case when id = p_out then p_in else p_out end,
      approved = true,
      approved_at = now()
  where id in (p_out, p_in);
end;
$$;

-- Candidate pairs among unreviewed rows: opposite amounts, different accounts,
-- posted within 5 days. Computed fresh each time (nothing stored): approving
-- either side normally makes a suggestion disappear.
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
  and not o.is_transfer and not i.is_transfer;

-- ---------------------------------------------------------------------------
-- merge_merchants: fold one merchant into another. Its descriptions (aliases)
-- and transactions move over; the kept merchant takes its remembered category
-- if it has none of its own.
-- ---------------------------------------------------------------------------

create or replace function public.merge_merchants(p_from uuid, p_into uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_from_category uuid;
begin
  if p_from = p_into then
    raise exception 'Pick two different merchants';
  end if;
  select last_category_id into v_from_category from public.merchants where id = p_from;
  if not found or not exists (select 1 from public.merchants where id = p_into) then
    raise exception 'Merchant not found';
  end if;

  update public.merchant_aliases set merchant_id = p_into where merchant_id = p_from;
  update public.transactions     set merchant_id = p_into where merchant_id = p_from;
  update public.merchants
  set last_category_id = coalesce(last_category_id, v_from_category)
  where id = p_into;
  delete from public.merchants where id = p_from;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants (this project gives new functions and views to no API role by default)
-- ---------------------------------------------------------------------------

revoke execute on function
  public.approve_transactions(uuid[]), public.mark_transfer(uuid),
  public.confirm_transfer(uuid, uuid), public.merge_merchants(uuid, uuid)
  from public, anon;
grant execute on function
  public.approve_transactions(uuid[]), public.mark_transfer(uuid),
  public.confirm_transfer(uuid, uuid), public.merge_merchants(uuid, uuid)
  to authenticated;

revoke all on public.transfer_suggestions from anon;
grant select on public.transfer_suggestions to authenticated;
