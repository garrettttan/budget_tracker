-- An "Uncategorized" category, for transactions you can't place: pick it and
-- approve to clear them from To review. It's an ordinary category (rename,
-- move or delete it in Settings), so it shows in Trends and filters like any other.
-- Added last for everyone who already has categories, and seeded for new
-- sign-ups. Safe to re-run.

insert into public.categories (user_id, name, group_name, is_income, sort_order)
select c.user_id, 'Uncategorized', 'Other', false, max(c.sort_order) + 10
from public.categories c
group by c.user_id
on conflict (user_id, name) do nothing;

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
    (p_user_id, 'Income',            'Income',    true,  140),
    (p_user_id, 'Uncategorized',     'Other',     false, 150)
  on conflict (user_id, name) do nothing;
$$;

revoke execute on function public.seed_starter_categories(uuid) from public, anon, authenticated;
