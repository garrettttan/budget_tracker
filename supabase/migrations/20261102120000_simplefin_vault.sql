-- Phase 2: SimpleFIN sync support
--
-- The Access URL embeds the username and password for your bank feed, so it
-- lives encrypted in vault.secrets. Only the edge functions (service role) can
-- save or read it; the browser never sees it, and connections.vault_secret_id
-- stays hidden from client roles (see the initial schema).

-- The edge functions use the service role. It bypasses RLS but, on this
-- project, gets no table privileges by default, so grant what the sync and
-- claim functions use (and future imports will need) explicitly.
grant select, insert, update, delete on
  public.connections, public.accounts, public.categories, public.merchants, public.merchant_aliases,
  public.import_batches, public.transactions, public.reimbursements, public.reimbursement_payments,
  public.tags, public.transaction_tags, public.balance_snapshots, public.sync_runs
  to service_role;

-- Save (or replace) the Access URL for a user. One connection per user:
-- reconnecting with a new Setup Token updates the same secret and row.
create or replace function public.save_simplefin_access_url(p_user_id uuid, p_access_url text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection_id uuid;
  v_secret_id     uuid;
begin
  select id, vault_secret_id into v_connection_id, v_secret_id
  from public.connections
  where user_id = p_user_id
  order by created_at
  limit 1;

  if v_secret_id is null then
    v_secret_id := vault.create_secret(
      p_access_url,
      'simplefin_access_url_' || p_user_id::text,
      'SimpleFIN Bridge Access URL'
    );
  else
    perform vault.update_secret(v_secret_id, p_access_url);
  end if;

  if v_connection_id is null then
    insert into public.connections (user_id, vault_secret_id)
    values (p_user_id, v_secret_id)
    returning id into v_connection_id;
  else
    update public.connections
    set vault_secret_id = v_secret_id, status = 'active', status_message = null
    where id = v_connection_id;
  end if;

  return v_connection_id;
end;
$$;

create or replace function public.get_simplefin_access_url(p_connection_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select ds.decrypted_secret
  from public.connections c
  join vault.decrypted_secrets ds on ds.id = c.vault_secret_id
  where c.id = p_connection_id;
$$;

revoke execute on function public.save_simplefin_access_url(uuid, text) from public, anon, authenticated;
revoke execute on function public.get_simplefin_access_url(uuid)        from public, anon, authenticated;
grant  execute on function public.save_simplefin_access_url(uuid, text) to service_role;
grant  execute on function public.get_simplefin_access_url(uuid)        to service_role;
