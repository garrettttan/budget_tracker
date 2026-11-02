-- Phase 3, part 3: editing transactions after they're approved
--
-- From the Transactions page you can change an approved row's category, mark
-- it as a transfer (mark_transfer already handles approved rows), or send it
-- back to Review. Security invoker like the other review functions, so RLS
-- limits them to your own rows. Safe to re-run.

-- ---------------------------------------------------------------------------
-- learn_merchant_categories: merchant memory, shared by approving and
-- recategorizing. Each merchant of the given approved rows remembers its
-- category (latest posted date wins), and your other unreviewed rows from
-- those merchants that have no category get it pre-filled.
-- ---------------------------------------------------------------------------

create or replace function public.learn_merchant_categories(p_ids uuid[])
returns void
language plpgsql
set search_path = ''
as $$
begin
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
end;
$$;

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

  perform public.learn_merchant_categories(p_ids);
  return v_approved;
end;
$$;

-- ---------------------------------------------------------------------------
-- recategorize_transactions: give approved rows a new category. A transfer
-- that gets a category stops being a transfer; if it was paired, the other
-- side goes back to Review (on its own it would be a stray half-transfer).
-- Returns how many rows changed.
-- ---------------------------------------------------------------------------

create or replace function public.recategorize_transactions(p_ids uuid[], p_category uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_changed integer;
begin
  -- RLS hides other users' categories, so this also checks ownership
  if not exists (select 1 from public.categories where id = p_category) then
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

  perform public.learn_merchant_categories(p_ids);
  return v_changed;
end;
$$;

-- ---------------------------------------------------------------------------
-- send_to_review: un-approve rows. A row keeps its category as a pre-fill;
-- a transfer loses the flag, and its paired side goes back to Review with it.
-- Merchant memory is left alone. Returns how many of the given rows moved.
-- ---------------------------------------------------------------------------

create or replace function public.send_to_review(p_ids uuid[])
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_moved integer;
begin
  select count(*) into v_moved from public.transactions where id = any (p_ids) and approved;

  update public.transactions
  set approved = false, approved_at = null, is_transfer = false, transfer_pair_id = null
  where approved
    and (id = any (p_ids)
         or id in (select transfer_pair_id from public.transactions where id = any (p_ids) and approved));

  return v_moved;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants (new functions are executable only by their owner on this project)
-- ---------------------------------------------------------------------------

revoke execute on function
  public.learn_merchant_categories(uuid[]),
  public.recategorize_transactions(uuid[], uuid),
  public.send_to_review(uuid[])
  from public, anon;
grant execute on function
  public.learn_merchant_categories(uuid[]),
  public.recategorize_transactions(uuid[], uuid),
  public.send_to_review(uuid[])
  to authenticated;
