import { useState } from 'react';
import { db } from '../lib/supabase';
import { parseAmount } from '../lib/format';
import Button from './Button';

export type AccountClass = 'cash' | 'investment' | 'liability';

export const CLASSES: { value: AccountClass; label: string; note?: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'investment', label: 'Investments', note: 'Balance only; transactions aren’t imported.' },
  { value: 'liability', label: 'Liabilities' },
];

/**
 * Adds an account the sync doesn't know about (Venmo, cash): no connection, so
 * the sync never touches it. Its balance is whatever you set here or later.
 */
export default function AddAccount({ onAdded, onCancel }: { onAdded: (name: string) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [cls, setCls] = useState<AccountClass>('cash');
  const [balance, setBalance] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = balance.trim() === '' ? 0 : parseAmount(balance, { allowNegative: true });
  const why = !name.trim() ? 'Type a name first' : parsed === null ? 'The balance isn’t a number' : undefined;

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
    <form className="panel-form" onSubmit={save} aria-label="Add manual account">
      <h2>Add manual account</h2>
      <p className="muted small">
        For accounts SimpleFIN can’t see, like Venmo. Enter their transactions with Add transaction on the Transactions page.
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="fields">
        <label>
          Name
          <input type="text" value={name} autoFocus disabled={busy} placeholder="Venmo" onChange={(e) => setName(e.target.value)} />
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
      </div>
      <div className="form-actions">
        <Button type="submit" variant="primary" disabled={busy || Boolean(why)} title={why}>
          Add account
        </Button>
        <Button variant="link" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
