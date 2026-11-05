-- "Uncategorized" is no category at all, and totals count only approved spending.
--
-- 1. The Uncategorized category goes: its transactions go back to no category
--    (approved or not, as they were), merchants that remembered it forget it.
--    The app shows a transaction with no category as "Uncategorized".
-- 2. Approving no longer needs a category (still never a pending row).
--    Merchant memory already ignores rows with no category.
-- 3. recategorize_transactions takes a null category (back to Uncategorized).
-- 4. delete_category without a target moves its transactions to no category.
-- 5. spending_lines counts only approved rows, and money in only when it's in a
--    spending category (a refund), so an uncategorized deposit is never
--    negative spending. Income in monthly_cashflow counts only approved rows.
--
-- Security invoker functions like before; safe to re-run.

-- 1 -------------------------------------------------------------------------

update public.transactions t
set category_id = null
from public.categories c
where c.id = t.category_id and c.name = 'Uncategorized' and not c.is_income;

update public.merchants m
set last_category_id = null
from public.categories c
where c.id = m.last_category_id and c.name = 'Uncategorized' and not c.is_income;

delete from public.categories where name = 'Uncategorized' and not is_income;

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

-- 2 -------------------------------------------------------------------------

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
    and not pending;
  get diagnostics v_approved = row_count;

  perform public.learn_merchant_categories(p_ids);
  return v_approved;
end;
$$;

-- 3 -------------------------------------------------------------------------

create or replace function public.recategorize_transactions(p_ids uuid[], p_category uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_changed integer;
begin
  -- null = Uncategorized; otherwise RLS hides other users' categories, so this also checks ownership
  if p_category is not null and not exists (select 1 from public.categories where id = p_category) then
    raise exception 'Category not found';
  end if;

  update public.transactions
  set approved = false, approved_at = null, is_transfer = false, transfer_pair_id = null
  where id in (
    select transfer_pair_id from public.transactions
    where id = any (p_ids) and approved and transfer_pair_id is not null
  )
  and not (id = any (p_ids));

  update public.transactions
  set category_id = p_category, is_transfer = false, transfer_pair_id = null
  where id = any (p_ids) and approved;
  get diagnostics v_changed = row_count;

  -- rows moved to Uncategorized teach nothing (memory skips no-category rows)
  perform public.learn_merchant_categories(p_ids);
  return v_changed;
end;
$$;

-- 4 -------------------------------------------------------------------------

create or replace function public.delete_category(p_id uuid, p_into uuid default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  -- RLS hides other users' categories, so these also check ownership
  if not exists (select 1 from public.categories where id = p_id) then
    raise exception 'Category not found';
  end if;
  if p_into = p_id then
    raise exception 'Pick a different category';
  end if;
  if p_into is not null and not exists (select 1 from public.categories where id = p_into) then
    raise exception 'Category not found';
  end if;

  -- no target: its transactions become Uncategorized (no category)
  update public.transactions set category_id = p_into where category_id = p_id;
  update public.merchants set last_category_id = p_into where last_category_id = p_id;
  delete from public.categories where id = p_id;
end;
$$;

-- 5 -------------------------------------------------------------------------

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
where t.approved
  and not t.is_transfer
  and not t.pending
  and coalesce(c.is_income, false) = false
  -- money in is a refund only in a spending category; uncategorized money in isn't spending
  and (t.amount < 0 or c.id is not null)
  and not exists (
    select 1 from public.reimbursement_payments rp where rp.payment_transaction_id = t.id
  );

create or replace function public.monthly_cashflow(include_tags uuid[] default '{}')
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
    where c.is_income and t.approved and not t.is_transfer and not t.pending
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

-- Grants (replacing keeps them, but state them so this file stands alone) ---

revoke all on public.spending_lines from anon;
grant select on public.spending_lines to authenticated;
revoke execute on function
  public.approve_transactions(uuid[]),
  public.recategorize_transactions(uuid[], uuid),
  public.delete_category(uuid, uuid),
  public.monthly_cashflow(uuid[])
  from public, anon;
grant execute on function
  public.approve_transactions(uuid[]),
  public.recategorize_transactions(uuid[], uuid),
  public.delete_category(uuid, uuid),
  public.monthly_cashflow(uuid[])
  to authenticated;
