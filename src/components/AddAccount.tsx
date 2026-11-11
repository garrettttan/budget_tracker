import { useState } from 'react';
import { db } from '../lib/supabase';
import { parseAmount } from '../lib/format';
import Button from './Button';
import Modal from './Modal';
import { strings } from '../lib/strings';

const t = strings.accounts;

export type AccountClass = 'cash' | 'investment' | 'liability';

/** The account classes, in the order Accounts lists them. */
export const CLASSES: { value: AccountClass; label: string }[] = [
  { value: 'cash', label: t.classes.cash },
  { value: 'investment', label: t.classes.investment },
  { value: 'liability', label: t.classes.liability },
];

/**
 * Adds an account the sync doesn't know about (Venmo, cash) in a modal: no
 * connection, so the sync never touches it. Its balance is whatever you set
 * here or later. `onCancel` runs however the modal is closed.
 */
export default function AddAccount({ onAdded, onCancel }: { onAdded: (name: string) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [cls, setCls] = useState<AccountClass>('cash');
  const [balance, setBalance] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = balance.trim() === '' ? 0 : parseAmount(balance, { allowNegative: true });
  const why = !name.trim() ? strings.common.typeName : parsed === null ? t.badBalance : undefined;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (why || parsed === null) return;
    setBusy(true);
    setError(null);
    const { error } = await db()
      .from('accounts')
      .insert({ name: name.trim(), class: cls, balance: parsed, balance_date: new Date().toISOString() });
    setBusy(false);
    if (error) return setError(error.message);
    await onAdded(name.trim());
  }

  return (
    <Modal labelledBy="add-account-title" busy={busy} onClose={onCancel}>
      {(close) => (
        <form onSubmit={save}>
          <h2 id="add-account-title">{t.addTitle}</h2>
          <p className="muted small">{t.addIntro}</p>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="fields single">
            <label>
              {strings.common.name}
              <input type="text" value={name} autoFocus disabled={busy} placeholder={t.namePlaceholder} onChange={(e) => setName(e.target.value)} />
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
          </div>
          <div className="form-actions">
            <Button type="submit" variant="primary" disabled={busy || Boolean(why)} title={why}>
              {t.addButton}
            </Button>
            <Button variant="link" disabled={busy} onClick={close}>
              {strings.common.cancel}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
