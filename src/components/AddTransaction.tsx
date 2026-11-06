import { useRef, useState } from 'react';
import { db } from '../lib/supabase';
import { money, parseAmount, todayIso } from '../lib/format';
import Button from './Button';
import Modal from './Modal';
import CategorySelect, { type Category, TRANSFER, UNCATEGORIZED } from './CategorySelect';
import { type OpenItem, allocate, byPerson, personKey, round } from '../lib/reimbursements';

export type AccountOption = { id: string; name: string; manual: boolean };

/**
 * Enters a transaction by hand (a Venmo payment, cash), in a modal. You typed
 * it, so it's saved already approved, with a category or as a transfer. The
 * modal stays open after each one, with the account and date kept and a line
 * saying what was added, for entering several in a row.
 */
export default function AddTransaction({
  accounts,
  categories,
  open,
  onAdded,
  onClose,
}: {
  accounts: AccountOption[];
  categories: Category[];
  /** what people still owe you: money in can pay it back */
  open: OpenItem[];
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
  const [payer, setPayer] = useState(''); // person key; '' = not a payback
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null); // the last one saved, shown in the modal
  const descriptionInput = useRef<HTMLInputElement>(null);

  const parsed = parseAmount(amount);
  const owers = byPerson(open);
  const payback = direction === 'in' ? owers.find((g) => personKey(g.who) === payer) : undefined;
  const plan = payback && parsed ? allocate(parsed, payback.items) : [];
  const why = !accountId
    ? 'Add an account first'
    : !date
      ? 'Pick a date'
      : parsed === null || parsed === 0
        ? 'Enter an amount'
        : !description.trim()
          ? 'Describe it'
          : undefined;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (why || parsed === null) return;
    setBusy(true);
    setError(null);
    setAdded(null);
    const signed = direction === 'out' ? -parsed : parsed;
    const transfer = !payback && category === TRANSFER;
    const { data, error } = await db()
      .from('transactions')
      .insert({
        account_id: accountId,
        source: 'manual',
        posted_date: date,
        amount: signed,
        description: description.trim(),
        category_id: payback || transfer ? null : category,
        is_transfer: transfer,
        note: note.trim() || null,
        // a payback is approved by linking it, below
        approved: !payback,
        approved_at: payback ? null : new Date().toISOString(),
      })
      .select('id')
      .single();
    if (error) {
      setBusy(false);
      return setError(error.message);
    }
    const account = accounts.find((a) => a.id === accountId)?.name;
    let summary = `${description.trim()} (${money(signed)}) on ${account}`;
    if (payback) {
      const linked = await db().rpc('link_reimbursement_payment', {
        p_payment: (data as { id: string }).id,
        p_reimbursements: payback.items.map((i) => i.id),
      });
      if (linked.error) {
        setBusy(false);
        await onAdded(`${summary}, but not linked`);
        setAdded(`Added ${summary}, but not linked.`);
        return setError(`Saved, but linking it failed (it's in To review): ${linked.error.message}`);
      }
      summary += `, paying back ${payback.who}`;
    }
    setBusy(false);
    await onAdded(summary);
    setAdded(`Added ${summary}${payback ? '' : ', approved'}.`);
    setAmount('');
    setDescription('');
    setCategory(null);
    setNote('');
    setPayer('');
    descriptionInput.current?.focus();
  }

  return (
    <Modal labelledBy="add-transaction-title" busy={busy} onClose={onClose} className="modal-wide">
      {(close) => (
        <form onSubmit={save}>
          <div className="modal-head">
            <h2 id="add-transaction-title">Add transaction</h2>
            <Button variant="icon" aria-label="Close" disabled={busy} onClick={close}>
              ×
            </Button>
          </div>
          <p className="muted small">Saved as approved, since you entered it. Money in can pay back what someone owes you.</p>
          {error && <p className="error" role="alert">{error}</p>}
          {added && !error && (
            <p className="notice" role="status">
              {added}
            </p>
          )}
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
                data-autofocus
                disabled={busy}
                placeholder="Dinner with Sam"
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            {direction === 'in' && owers.length > 0 && (
              <label className="span-2">
                Pays back
                <select value={payer} disabled={busy} onChange={(e) => setPayer(e.target.value)}>
                  <option value="">Nobody: income or a refund</option>
                  {owers.map((g) => (
                    <option key={personKey(g.who)} value={personKey(g.who)}>
                      {g.who} (owes {money(g.remaining)})
                    </option>
                  ))}
                </select>
              </label>
            )}
            {payback ? (
              <p className="field payback-plan">
                {plan.length
                  ? `Covers ${plan.map((p) => `${p.item.label} ${money(p.part)}`).join(', ')}${
                      parsed && parsed > payback.remaining ? `; ${money(round(parsed - payback.remaining))} more than they owe` : ''
                    }. Not counted as income.`
                  : 'Enter the amount to see what it covers.'}
              </p>
            ) : (
            <div className="field">
              {/* the picker labels itself; this is the visible caption */}
              <span aria-hidden="true">Category</span>
              <CategorySelect categories={categories} value={category} disabled={busy} label="Category"
                onChange={(value) => {
                  setCategory(value === UNCATEGORIZED ? null : value);
                  // a paycheck or refund into Income is money in
                  if (categories.find((c) => c.id === value)?.is_income) setDirection('in');
                }}
              />
            </div>
            )}
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
            <Button variant="link" disabled={busy} onClick={close}>
              Done
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
