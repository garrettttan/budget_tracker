import { useState } from 'react';
import { db } from '../lib/supabase';
import { money, parseAmount } from '../lib/format';
import Button from './Button';
import Modal from './Modal';
import { type AccountClass, CLASSES } from './AddAccount';
import { strings } from '../lib/strings';

const t = strings.accounts;

export type EditableAccount = {
  id: string;
  name: string;
  institution: string | null;
  class: AccountClass;
  balance: string | null;
  connection_id: string | null; // null = a manual account (Venmo, cash)
  hidden: boolean; // a dead account: off Accounts (until shown), net worth and the account picker
};

/** How many transactions an account has (deleting or moving it to Investments deletes them). */
async function countTransactions(accountId: string) {
  return db().from('transactions').select('id', { count: 'exact', head: true }).eq('account_id', accountId);
}

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
  const why = !name.trim() ? strings.common.typeName : manual && parsed === null ? t.badBalance : undefined;

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
        const ok = window.confirm(t.confirmInvestment(account.name, count));
        if (!ok) return setBusy(false);
        const del = await db().from('transactions').delete().eq('account_id', account.id);
        if (del.error) return fail(del.error.message);
      }
    }
    const { error } = await db().from('accounts').update(changes).eq('id', account.id);
    if (error) return fail(error.message);
    await onSaved(strings.common.saved(name.trim()));
  }

  async function remove() {
    setError(null);
    const { count, error: countError } = await countTransactions(account.id);
    if (countError) return setError(countError.message);
    if (!window.confirm(t.confirmDelete(account.name, count ?? 0))) return;
    setBusy(true);
    const { error } = await db().from('accounts').delete().eq('id', account.id);
    if (error) return fail(error.message);
    await onSaved(strings.common.deleted(account.name));
  }

  function fail(message: string) {
    setError(message);
    setBusy(false);
  }

  return (
    <Modal labelledBy="edit-account-title" busy={busy} onClose={onClose}>
      {(close) => (
        <form onSubmit={save}>
          <h2 id="edit-account-title">{t.editTitle}</h2>
          <p className="muted small">{account.institution ?? t.manualAccount}</p>
          {error && <p className="error" role="alert">{strings.common.couldntSave(error)}</p>}
          <div className="fields single">
            <label>
              {strings.common.name}
              <input type="text" value={name} autoFocus data-autofocus disabled={busy} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              {t.class}
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
                {t.currentBalance}
                <input
                  type="text"
                  inputMode="decimal"
                  value={balance}
                  disabled={busy}
                  placeholder={strings.common.amountPlaceholder}
                  onChange={(e) => setBalance(e.target.value)}
                />
              </label>
            ) : (
              <div className="field">
                {t.balance}
                <span className="num static-value">{money(account.balance)}</span>
              </div>
            )}
            <label className="checkbox-field">
              <input type="checkbox" checked={hidden} disabled={busy} onChange={(e) => setHidden(e.target.checked)} />
              {t.hide}
            </label>
          </div>
          <div className="form-actions">
            <Button type="submit" variant="primary" disabled={busy || Boolean(why)} title={why}>
              {strings.common.save}
            </Button>
            <Button variant="link" disabled={busy} onClick={close}>
              {strings.common.cancel}
            </Button>
            {manual && (
              <Button variant="link" className="danger push-right" disabled={busy} onClick={remove}>
                {t.deleteButton}
              </Button>
            )}
          </div>
        </form>
      )}
    </Modal>
  );
}
