-- spending_lines gains the columns Spending's list filters on (appended, so
-- `create or replace` keeps every other column as it was), so the month's
-- totals can follow the Account, Merchant and Amount filters: account_id, the
-- transaction's own amount (signed, before reimbursements), the bank's
-- description and merchant_id. Nothing else changes. Safe to re-run.

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
  coalesce(tg.tag_ids, '{}') as tag_ids,
  t.account_id,
  t.amount,
  t.description,
  t.merchant_id
from public.transactions t
left join public.categories c on c.id = t.category_id
left join reimbursed r        on r.transaction_id = t.id
left join tagged tg           on tg.transaction_id = t.id
where t.approved
  and not t.is_transfer
  and not t.pending
  and coalesce(c.is_income, false) = false
  -- money in is a refund only in a spending category; uncategorized money in isn't spending
  and (t.amount < 0 or c.id is not null)
  and not exists (
    select 1 from public.reimbursement_payments rp where rp.payment_transaction_id = t.id
  );


-- Grants (replacing keeps them, but state them so this file stands alone) ---

revoke all on public.spending_lines from anon;
grant select on public.spending_lines to authenticated;
