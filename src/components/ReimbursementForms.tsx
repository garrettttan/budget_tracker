// The two reimbursement forms: Expect reimbursement (on a charge) and Link to
// what someone owes (on money in), opened from a row's ⋯ menu. Paid back? uses
// LinkForm too.
import { useId, useState } from 'react';
import { money, parseAmount } from '../lib/format';
import { round } from '../lib/cents';
import { type OpenItem, allocate, byPerson, personKey } from '../lib/reimbursements';
import Button from './Button';
import { strings } from '../lib/strings';

const t = strings.reimbursements;
const common = strings.common;

/**
 * Expect reimbursement: someone owes you part of a charge. Who (with the
 * people you've entered before as suggestions), how much, and a note.
 */
export function ExpectForm({
  charge,
  expected,
  people,
  busy,
  onSave,
  onCancel,
}: {
  /** the charge as a positive number */
  charge: number;
  /** already expected back on it (owed or received) */
  expected: number;
  people: string[];
  busy: boolean;
  onSave: (who: string, amount: number, note: string) => void;
  onCancel: () => void;
}) {
  const listId = useId();
  const [who, setWho] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const max = round(charge - expected);
  const parsed = parseAmount(amount);
  const why = !who.trim()
    ? t.sayWho
    : parsed === null || parsed === 0
      ? common.enterAmount
      : parsed > max
        ? t.atMost(money(max))
        : undefined;

  return (
    <form
      className="inline-form"
      aria-label={t.expectForm}
      onSubmit={(e) => {
        e.preventDefault();
        if (!why && parsed !== null) onSave(who.trim(), parsed, note.trim());
      }}
    >
      <label>
        {t.whoOwes}
        <input type="text" list={listId} value={who} autoFocus disabled={busy} onChange={(e) => setWho(e.target.value)} />
        <datalist id={listId}>
          {people.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </label>
      <label>
        {t.howMuch}
        <span className="amount-quick">
          <input
            type="text"
            inputMode="decimal"
            placeholder={common.amountPlaceholder}
            value={amount}
            disabled={busy}
            onChange={(e) => setAmount(e.target.value)}
          />
          <Button variant="link" size="small" disabled={busy} onClick={() => setAmount(round(charge / 2).toFixed(2))}>
            {t.half}
          </Button>
          {expected > 0 && (
            <Button variant="link" size="small" disabled={busy} onClick={() => setAmount(max.toFixed(2))}>
              {t.theRest}
            </Button>
          )}
        </span>
      </label>
      <label>
        <span>
          {common.note} <span className="muted">{common.optional}</span>
        </span>
        <input type="text" value={note} disabled={busy} onChange={(e) => setNote(e.target.value)} />
      </label>
      <span className="inline-form-actions">
        <Button type="submit" size="small" variant="primary" disabled={busy || Boolean(why)} title={why}>
          {common.save}
        </Button>
        <Button variant="link" size="small" disabled={busy} onClick={onCancel}>
          {common.cancel}
        </Button>
      </span>
    </form>
  );
}

/**
 * Link money in to what someone owes: pick the person, untick any items it
 * doesn't cover. The payment covers the ticked items oldest first.
 */
export function LinkForm({
  payment,
  open,
  initial,
  busy,
  onLink,
  onCancel,
}: {
  payment: number;
  open: OpenItem[];
  /** items to start with ticked, e.g. a suggestion's */
  initial?: OpenItem[];
  busy: boolean;
  onLink: (ids: string[]) => void;
  onCancel: () => void;
}) {
  const people = byPerson(open);
  const [person, setPerson] = useState(() => personKey(initial?.[0]?.who ?? people[0]?.who ?? ''));
  const items = people.find((g) => personKey(g.who) === person)?.items ?? [];
  const [ticked, setTicked] = useState<Set<string>>(() => new Set((initial ?? items).map((i) => i.id)));
  const chosen = items.filter((i) => ticked.has(i.id));
  const plan = allocate(payment, chosen);
  const covered = round(plan.reduce((sum, p) => sum + p.part, 0));
  const extra = round(payment - covered);

  function pickPerson(key: string) {
    setPerson(key);
    setTicked(new Set((people.find((g) => personKey(g.who) === key)?.items ?? []).map((i) => i.id)));
  }

  if (people.length === 0) {
    return (
      <p className="inline-form muted">
        {t.nobodyOwes}{' '}
        <Button variant="link" size="small" onClick={onCancel}>
          {common.close}
        </Button>
      </p>
    );
  }

  return (
    <form
      className="inline-form"
      aria-label={t.linkForm}
      onSubmit={(e) => {
        e.preventDefault();
        if (plan.length) onLink(plan.map((p) => p.item.id));
      }}
    >
      <label>
        {t.paidBackBy}
        <select value={person} disabled={busy} onChange={(e) => pickPerson(e.target.value)}>
          {people.map((g) => (
            <option key={personKey(g.who)} value={personKey(g.who)}>
              {common.owes(g.who, money(g.remaining))}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="link-items">
        <legend>{t.covers}</legend>
        {items.map((i) => {
          const part = plan.find((p) => p.item.id === i.id)?.part;
          return (
            <label key={i.id} className="check">
              <input
                type="checkbox"
                checked={ticked.has(i.id)}
                disabled={busy}
                onChange={() =>
                  setTicked((t) => {
                    const next = new Set(t);
                    if (!next.delete(i.id)) next.add(i.id);
                    return next;
                  })
                }
              />
              {t.item(i.label, money(i.remaining))}
              {part !== undefined && part < i.remaining && <span className="muted">{t.partOf(money(part))}</span>}
              {ticked.has(i.id) && part === undefined && <span className="muted">{t.usedUp}</span>}
            </label>
          );
        })}
      </fieldset>
      {extra > 0 && plan.length > 0 && (
        <p className="muted small">{t.extra(money(extra))}</p>
      )}
      <span className="inline-form-actions">
        <Button
          type="submit"
          size="small"
          variant="primary"
          disabled={busy || plan.length === 0}
          title={plan.length === 0 ? t.tickOne : undefined}
        >
          {t.link(money(covered))}
        </Button>
        <Button variant="link" size="small" disabled={busy} onClick={onCancel}>
          {common.cancel}
        </Button>
      </span>
    </form>
  );
}
