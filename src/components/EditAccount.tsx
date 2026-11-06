import { useState } from 'react';
import { db } from '../lib/supabase';
import { money, parseAmount } from '../lib/format';
import Button from './Button';
import Modal from './Modal';
import { type AccountClass, CLASSES } from './AddAccount';

export type EditableAccount = {
  id: string;
  name: string;
  institution: string | null;
  class: AccountClass;
  balance: string | null;
  connection_id: string | null; // null = a manual account (Venmo, cash)
  hidden: boolean; // a dead account: off Accounts (until shown), net worth and the account picker
};

async function countTransactions(accountId: string) {
  return db().from('transactions').select('id', { count: 'exact', head: true }).eq('account_id', accountId);
}

const plural = (n: number) => `${n} ${n === 1 ? 'transaction' : 'transactions'}`;

/**
 * Edit one account in a modal: your name for it (the sync sets the bank's name
 * only once, so it sticks), its class, and for a manual account its balance.
 * Manual accounts can be deleted here; synced ones would come back with the
 * next sync.
 */
export default function EditAccount({
  account,
  onClose,
  onSaved,
}: {
  account: EditableAccount;
  onClose: () => void;
  onSaved: (notice: string) => Promise<void>;
}) {
  const manual = account.connection_id === null;
  const [name, setName] = useState(account.name);
  const [cls, setCls] = useState<AccountClass>(account.class);
  const [hidden, setHidden] = useState(account.hidden);
  const [balance, setBalance] = useState(account.balance === null ? '' : Number(account.balance).toFixed(2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = balance.trim() === '' ? 0 : parseAmount(balance, { allowNegative: true });
  const why = !name.trim() ? 'Type a name first' : manual && parsed === null ? 'The balance isn’t a number' : undefined;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (why) return;
    const changes: Record<string, unknown> = {};
    if (name.trim() !== account.name) changes.name = name.trim();
    if (cls !== account.class) changes.class = cls;
    if (hidden !== account.hidden) changes.hidden = hidden;
    if (manual && parsed !== Number(account.balance ?? 0)) {
      changes.balance = parsed;
      changes.balance_date = new Date().toISOString();
    }
    if (Object.keys(changes).length === 0) return onClose();

    setBusy(true);
    setError(null);
    if (changes.class === 'investment') {
      // investments are balance-only, so their imported transactions go
      const { count, error: countError } = await countTransactions(account.id);
      if (countError) return fail(countError.message);
      if (count) {
        const ok = window.confirm(
          `Move ${account.name} to Investments? Only its balance is kept: its ${plural(count)} ` +
            `(and any notes, reimbursements or tags on them) will be deleted.`,
        );
        if (!ok) return setBusy(false);
        const del = await db().from('transactions').delete().eq('account_id', account.id);
        if (del.error) return fail(del.error.message);
      }
    }
    const { error } = await db().from('accounts').update(changes).eq('id', account.id);
    if (error) return fail(error.message);
    await onSaved(`Saved ${name.trim()}.`);
  }

  async function remove() {
    setError(null);
    const { count, error: countError } = await countTransactions(account.id);
    if (countError) return setError(countError.message);
    const what = count
      ? `its ${plural(count)} (and any tags or reimbursements on them) will be deleted too.`
      : 'it has no transactions.';
    if (!window.confirm(`Delete ${account.name}? This can’t be undone; ${what}`)) return;
    setBusy(true);
    const { error } = await db().from('accounts').delete().eq('id', account.id);
    if (error) return fail(error.message);
    await onSaved(`Deleted ${account.name}.`);
  }

  function fail(message: string) {
    setError(message);
    setBusy(false);
  }

  return (
    <Modal labelledBy="edit-account-title" busy={busy} onClose={onClose}>
      {(close) => (
        <form onSubmit={save}>
          <h2 id="edit-account-title">Edit account</h2>
          <p className="muted small">{account.institution ?? 'Manual account'}</p>
          {error && <p className="error" role="alert">Couldn’t save: {error}</p>}
          <div className="fields single">
            <label>
              Name
              <input type="text" value={name} autoFocus data-autofocus disabled={busy} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              Class
              <select value={cls} disabled={busy} onChange={(e) => setCls(e.target.value as AccountClass)}>
                {CLASSES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            {manual ? (
              <label>
                Current balance
                <input
                  type="text"
                  inputMode="decimal"
                  value={balance}
                  disabled={busy}
                  placeholder="0.00"
                  onChange={(e) => setBalance(e.target.value)}
                />
              </label>
            ) : (
              <div className="field">
                Balance
                <span className="num static-value">{money(account.balance)}</span>
              </div>
            )}
            <label className="checkbox-field">
              <input type="checkbox" checked={hidden} disabled={busy} onChange={(e) => setHidden(e.target.checked)} />
              Hide this account
            </label>
          </div>
          <div className="form-actions">
            <Button type="submit" variant="primary" disabled={busy || Boolean(why)} title={why}>
              Save
            </Button>
            <Button variant="link" disabled={busy} onClick={close}>
              Cancel
            </Button>
            {manual && (
              <Button variant="link" className="danger push-right" disabled={busy} onClick={remove}>
                Delete account
              </Button>
            )}
          </div>
        </form>
      )}
    </Modal>
  );
}
