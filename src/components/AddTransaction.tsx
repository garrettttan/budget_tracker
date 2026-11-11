import { useRef, useState } from 'react';
import { db } from '../lib/supabase';
import { round } from '../lib/cents';
import { money, parseAmount } from '../lib/format';
import { today } from '../lib/months';
import { type OpenItem, allocate, byPerson, personKey } from '../lib/reimbursements';
import Button from './Button';
import CategorySelect, { type Category, TRANSFER, UNCATEGORIZED } from './CategorySelect';
import Modal from './Modal';
import { strings } from '../lib/strings';

const t = strings.addTransaction;
const common = strings.common;

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
  const [date, setDate] = useState(today);
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
    ? t.noAccount
    : !date
      ? t.pickDate
      : parsed === null || parsed === 0
        ? common.enterAmount
        : !description.trim()
          ? t.describe
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
    let summary = t.summary(description.trim(), money(signed), account);
    if (payback) {
      const linked = await db().rpc('link_reimbursement_payment', {
        p_payment: (data as { id: string }).id,
        p_reimbursements: payback.items.map((i) => i.id),
      });
      if (linked.error) {
        setBusy(false);
        await onAdded(t.notLinkedSummary(summary));
        setAdded(t.addedNotLinked(summary));
        return setError(t.linkFailed(linked.error.message));
      }
      summary += t.payingBack(payback.who);
    }
    setBusy(false);
    await onAdded(summary);
    setAdded(t.added(summary, !payback));
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
            <h2 id="add-transaction-title">{t.title}</h2>
            <Button variant="icon" aria-label={common.close} disabled={busy} onClick={close}>
              {common.closeSymbol}
            </Button>
          </div>
          <p className="muted small">{t.intro}</p>
          {error && <p className="error" role="alert">{error}</p>}
          {added && !error && (
            <p className="notice" role="status">
              {added}
            </p>
          )}
          <div className="fields">
            <label>
              {t.account}
              <select value={accountId} disabled={busy} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t.date}
              <input type="date" value={date} disabled={busy} required onChange={(e) => setDate(e.target.value)} />
            </label>
            <div className="field">
              <span id="add-txn-amount">{t.amount}</span>
              <div className="amount-entry">
                <div className="filter" role="group" aria-label={t.outOrIn}>
                  <Button size="small" aria-pressed={direction === 'out'} disabled={busy} onClick={() => setDirection('out')}>
                    {t.out}
                  </Button>
                  <Button size="small" aria-pressed={direction === 'in'} disabled={busy} onClick={() => setDirection('in')}>
                    {t.in}
                  </Button>
                </div>
                <input
                  type="text"
                  inputMode="decimal"
                  aria-labelledby="add-txn-amount"
                  value={amount}
                  disabled={busy}
                  placeholder={common.amountPlaceholder}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
            </div>
            <label className="span-2">
              {t.description}
              <input
                ref={descriptionInput}
                type="text"
                value={description}
                data-autofocus
                disabled={busy}
                placeholder={t.descriptionPlaceholder}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            {direction === 'in' && owers.length > 0 && (
              <label className="span-2">
                {t.paysBack}
                <select value={payer} disabled={busy} onChange={(e) => setPayer(e.target.value)}>
                  <option value="">{t.nobody}</option>
                  {owers.map((g) => (
                    <option key={personKey(g.who)} value={personKey(g.who)}>
                      {common.owes(g.who, money(g.remaining))}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {payback ? (
              <p className="field payback-plan">
                {plan.length
                  ? t.covers(
                      plan.map((p) => t.coversPart(p.item.label, money(p.part))),
                      parsed && parsed > payback.remaining ? money(round(parsed - payback.remaining)) : null,
                    )
                  : t.enterToSee}
              </p>
            ) : (
              <div className="field">
                {/* the picker labels itself; this is the visible caption */}
                <span aria-hidden="true">{t.category}</span>
                <CategorySelect
                  categories={categories}
                  value={category}
                  disabled={busy}
                  label={t.category}
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
                {common.note} <span className="muted">{common.optional}</span>
              </span>
              <input type="text" value={note} disabled={busy} onChange={(e) => setNote(e.target.value)} />
            </label>
          </div>
          <div className="form-actions">
            <Button type="submit" variant="primary" disabled={busy || Boolean(why)} title={why}>
              {t.title}
            </Button>
            <Button variant="link" disabled={busy} onClick={close}>
              {common.done}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
