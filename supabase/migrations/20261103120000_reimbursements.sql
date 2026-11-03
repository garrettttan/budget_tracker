-- Phase 4: Reimbursements
--
-- Mark part of a charge as owed by someone (Expect reimbursement); when their
-- payment arrives, link it. Category spending counts only your share, a linked
-- payment isn't income, and a written-off item counts as your spending again.
--
-- Security invoker functions (row-level security applies), called with rpc().
-- Safe to re-run: create or replace throughout.

-- ---------------------------------------------------------------------------
-- expect_reimbursement: someone owes you part of a charge
--   * only posted money-out rows that aren't transfers
--   * everything expected on one charge (owed or received) can't exceed it
-- Returns the new reimbursement's id.
-- ---------------------------------------------------------------------------

create or replace function public.expect_reimbursement(p_transaction uuid, p_who text, p_amount numeric, p_note text default null)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_txn public.transactions;
  v_expected numeric;
  v_id uuid;
begin
  select * into v_txn from public.transactions where id = p_transaction;
  if not found then
    raise exception 'Transaction not found';
  end if;
  if v_txn.amount >= 0 or v_txn.is_transfer or v_txn.pending then
    raise exception 'Only posted charges (money out, not transfers) can be reimbursed';
  end if;
  if coalesce(trim(p_who), '') = '' then
    raise exception 'Say who owes it';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'The amount must be more than zero';
  end if;

  select coalesce(sum(amount), 0) into v_expected
  from public.reimbursements
  where transaction_id = p_transaction and status in ('owed', 'received');
  if v_expected + p_amount > -v_txn.amount then
    raise exception 'That''s more than the charge: % is already expected back from %', v_expected, -v_txn.amount;
  end if;

  insert into public.reimbursements (transaction_id, who, amount, note)
  values (p_transaction, trim(p_who), round(p_amount, 2), nullif(trim(p_note), ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- link_reimbursement_payment: money in that pays back what's owed
--   * the payment covers the given items oldest charge first, each up to what's
--     still owed on it, until the payment runs out (partial payments and one
--     payment covering several items both work)
--   * an item paid in full becomes received
--   * the payment is approved with no category: it's not income
--   * a payment can be linked again later if part of it is still unused
-- Returns the amount linked.
-- ---------------------------------------------------------------------------

create or replace function public.link_reimbursement_payment(p_payment uuid, p_reimbursements uuid[])
returns numeric
language plpgsql
set search_path = ''
as $$
declare
  v_pay public.transactions;
  v_left numeric;
  v_total numeric := 0;
  v_item record;
  v_part numeric;
begin
  select * into v_pay from public.transactions where id = p_payment;
  if not found then
    raise exception 'Payment not found';
  end if;
  if v_pay.amount <= 0 or v_pay.is_transfer or v_pay.pending then
    raise exception 'Only posted money in (not transfers) can pay back a reimbursement';
  end if;

  select v_pay.amount - coalesce(sum(amount), 0) into v_left
  from public.reimbursement_payments where payment_transaction_id = p_payment;

  for v_item in
    select r.id, r.amount - coalesce((select sum(rp.amount) from public.reimbursement_payments rp where rp.reimbursement_id = r.id), 0) as still_owed
    from public.reimbursements r
    join public.transactions t on t.id = r.transaction_id
    where r.id = any (p_reimbursements) and r.status = 'owed'
    order by t.posted_date, r.created_at
    for update of r
  loop
    exit when v_left <= 0;
    continue when v_item.still_owed <= 0;
    v_part := least(v_left, v_item.still_owed);
    insert into public.reimbursement_payments (reimbursement_id, payment_transaction_id, amount)
    values (v_item.id, p_payment, v_part);
    if v_part = v_item.still_owed then
      update public.reimbursements set status = 'received', updated_at = now() where id = v_item.id;
    end if;
    v_left := v_left - v_part;
    v_total := v_total + v_part;
  end loop;

  if v_total = 0 then
    raise exception 'Nothing linked: those items are already paid, written off, or the payment is used up';
  end if;

  update public.transactions
  set approved = true, approved_at = now(), category_id = null, is_transfer = false, updated_at = now()
  where id = p_payment;

  return v_total;
end;
$$;

-- ---------------------------------------------------------------------------
-- unlink_reimbursement_payment: undo a link
--   * items it had paid in full are owed again (written-off ones stay written off)
--   * the payment goes back to To review
-- Returns how many items it was linked to.
-- ---------------------------------------------------------------------------

create or replace function public.unlink_reimbursement_payment(p_payment uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  select array_agg(reimbursement_id) into v_ids
  from public.reimbursement_payments where payment_transaction_id = p_payment;
  if v_ids is null then
    return 0;
  end if;

  delete from public.reimbursement_payments where payment_transaction_id = p_payment;
  update public.reimbursements set status = 'owed', updated_at = now()
  where id = any (v_ids) and status = 'received';
  update public.transactions set approved = false, approved_at = null, updated_at = now()
  where id = p_payment;

  return cardinality(v_ids);
end;
$$;

-- ---------------------------------------------------------------------------
-- spending_lines: a written-off item that was partly paid now counts only the
-- unpaid part as your spending again (before, the paid part vanished: it was
-- left out of both spending and income). Same columns as before.
-- ---------------------------------------------------------------------------

create or replace view public.spending_lines
with (security_invoker = true)
as
with paid as (
  select reimbursement_id, sum(amount) as amount
  from public.reimbursement_payments
  group by reimbursement_id
),
reimbursed as (
  select r.transaction_id,
         sum(case when r.status = 'written_off' then coalesce(p.amount, 0) else r.amount end) as amount
  from public.reimbursements r
  left join paid p on p.reimbursement_id = r.id
  group by r.transaction_id
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

-- ---------------------------------------------------------------------------
-- Grants (new functions are executable only by their owner on this project)
-- ---------------------------------------------------------------------------

revoke all on public.spending_lines from anon;
grant select on public.spending_lines to authenticated;

revoke execute on function
  public.expect_reimbursement(uuid, text, numeric, text),
  public.link_reimbursement_payment(uuid, uuid[]),
  public.unlink_reimbursement_payment(uuid)
  from public, anon;
grant execute on function
  public.expect_reimbursement(uuid, text, numeric, text),
  public.link_reimbursement_payment(uuid, uuid[]),
  public.unlink_reimbursement_payment(uuid)
  to authenticated;
