import { useRef, useState } from 'react';
import { db } from '../lib/supabase';
import { money, parseAmount, todayIso } from '../lib/format';
import Button from './Button';
import CategorySelect, { type Category, TRANSFER } from './CategorySelect';

export type AccountOption = { id: string; name: string; manual: boolean };

/**
 * Enters a transaction by hand (a Venmo payment, cash). You typed it, so it's
 * saved already approved, with a category or as a transfer. The form stays
 * open with the account and date kept, for entering several in a row.
 */
export default function AddTransaction({
  accounts,
  categories,
  onAdded,
  onClose,
}: {
  accounts: AccountOption[];
  categories: Category[];
  onAdded: (summary: string) => Promise<void>;
  onClose: () => void;
}) {
  const [accountId, setAccountId] = useState(() => (accounts.find((a) => a.manual) ?? accounts[0])?.id ?? '');
  const [date, setDate] = useState(todayIso);
  const [direction, setDirection] = useState<'out' | 'in'>('out');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const descriptionInput = useRef<HTMLInputElement>(null);

  const parsed = parseAmount(amount);
  const why = !accountId
    ? 'Add an account first'
    : !date
      ? 'Pick a date'
      : parsed === null || parsed === 0
        ? 'Enter an amount'
        : !description.trim()
          ? 'Describe it'
          : !category
            ? 'Choose a category'
            : undefined;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (why || parsed === null || !category) return;
    setBusy(true);
    setError(null);
    const signed = direction === 'out' ? -parsed : parsed;
    const transfer = category === TRANSFER;
    const { error } = await db()
      .from('transactions')
      .insert({
        account_id: accountId,
        source: 'manual',
        posted_date: date,
        amount: signed,
        description: description.trim(),
        category_id: transfer ? null : category,
        is_transfer: transfer,
        note: note.trim() || null,
        approved: true,
        approved_at: new Date().toISOString(),
      });
    setBusy(false);
    if (error) return setError(error.message);
    const account = accounts.find((a) => a.id === accountId)?.name;
    await onAdded(`${description.trim()} (${money(signed)}) on ${account}`);
    setAmount('');
    setDescription('');
    setCategory(null);
    setNote('');
    descriptionInput.current?.focus();
  }

  return (
    <form className="panel-form" onSubmit={save} aria-label="Add transaction">
      <h2>Add transaction</h2>
      <p className="muted small">Saved as approved, since you entered it.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="fields">
        <label>
          Account
          <select value={accountId} disabled={busy} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date
          <input type="date" value={date} disabled={busy} required onChange={(e) => setDate(e.target.value)} />
        </label>
        <div className="field">
          <span id="add-txn-amount">Amount</span>
          <div className="amount-entry">
            <div className="filter" role="group" aria-label="Money out or in">
              <Button size="small" aria-pressed={direction === 'out'} disabled={busy} onClick={() => setDirection('out')}>
                Out
              </Button>
              <Button size="small" aria-pressed={direction === 'in'} disabled={busy} onClick={() => setDirection('in')}>
                In
              </Button>
            </div>
            <input
              type="text"
              inputMode="decimal"
              aria-labelledby="add-txn-amount"
              value={amount}
              disabled={busy}
              placeholder="0.00"
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
        </div>
        <label className="span-2">
          Description
          <input
            ref={descriptionInput}
            type="text"
            value={description}
            autoFocus
            disabled={busy}
            placeholder="Dinner with Sam"
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <div className="field">
          {/* the picker labels itself; this is the visible caption */}
          <span aria-hidden="true">Category</span>
          <CategorySelect categories={categories} value={category} disabled={busy} label="Category"
            onChange={(value) => {
              setCategory(value);
              // a paycheck or refund into Income is money in
              if (categories.find((c) => c.id === value)?.is_income) setDirection('in');
            }}
          />
        </div>
        <label className="wide">
          <span>
            Note <span className="muted">(optional)</span>
          </span>
          <input type="text" value={note} disabled={busy} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <div className="form-actions">
        <Button type="submit" variant="primary" disabled={busy || Boolean(why)} title={why}>
          Add transaction
        </Button>
        <Button variant="link" disabled={busy} onClick={onClose}>
          Done
        </Button>
      </div>
    </form>
  );
}
