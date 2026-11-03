-- Delete a transaction you added by hand (Add transaction), cleaning up what
-- hangs off it first, so nothing is left half-linked:
--   * synced or imported rows can't be deleted this way (the sync would bring
--     them back; imports are undone by batch)
--   * a charge whose reimbursements already have payments linked is refused:
--     unlink those payments first, or they'd be left approved but linked to nothing
--   * a payback is unlinked first, so what it paid is owed again
--   * the other side of a transfer goes back to To review, unpaired
--   * unpaid reimbursements and tags on it go with it (foreign keys cascade)
-- Security invoker (row-level security applies), called with rpc(). Safe to re-run.

create or replace function public.delete_manual_transaction(p_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_txn public.transactions;
  v_payers text;
begin
  select * into v_txn from public.transactions where id = p_id;
  if not found then
    raise exception 'Transaction not found';
  end if;
  if v_txn.source <> 'manual' then
    raise exception 'Only transactions you added by hand can be deleted';
  end if;

  select string_agg(distinct r.who, ', ') into v_payers
  from public.reimbursements r
  join public.reimbursement_payments rp on rp.reimbursement_id = r.id
  where r.transaction_id = p_id;
  if v_payers is not null then
    raise exception 'Payments from % are linked to this charge. Unlink them first (Unlink payment in each payment''s details).', v_payers;
  end if;

  perform public.unlink_reimbursement_payment(p_id);

  update public.transactions
  set approved = false, approved_at = null, is_transfer = false, transfer_pair_id = null, updated_at = now()
  where id <> p_id and (transfer_pair_id = p_id or id = v_txn.transfer_pair_id);

  delete from public.transactions where id = p_id;
end;
$$;

revoke execute on function public.delete_manual_transaction(uuid) from public, anon;
grant execute on function public.delete_manual_transaction(uuid) to authenticated;
