-- Delete a category (Settings → Categories). Its transactions and the merchants
-- that remember it move to another category first, in one go, so nothing is
-- left approved with no category. A category nothing uses can go without one.
-- Security invoker (row-level security applies), called with rpc(). Safe to re-run.

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

  if p_into is null then
    if exists (select 1 from public.transactions where category_id = p_id) then
      raise exception 'Pick a category to move its transactions to';
    end if;
  else
    if p_into = p_id then
      raise exception 'Pick a different category';
    end if;
    if not exists (select 1 from public.categories where id = p_into) then
      raise exception 'Category not found';
    end if;
    update public.transactions set category_id = p_into where category_id = p_id;
    update public.merchants set last_category_id = p_into where last_category_id = p_id;
  end if;

  delete from public.categories where id = p_id;
end;
$$;

revoke execute on function public.delete_category(uuid, uuid) from public, anon;
grant execute on function public.delete_category(uuid, uuid) to authenticated;
