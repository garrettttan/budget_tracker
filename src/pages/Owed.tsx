import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../lib/supabase';
import { money, shortDate } from '../lib/format';
import { CHARGE, personKey, round } from '../lib/reimbursements';
import Button from '../components/Button';

type Status = 'owed' | 'received' | 'written_off';

type Item = {
  id: string;
  who: string;
  amount: string;
  status: Status;
  note: string | null;
  updated_at: string;
  transactions: { posted_date: string; description: string; merchants: { name: string } | null } | null;
  reimbursement_payments: { amount: string; payment: { posted_date: string } | null }[];
};

const paidOf = (i: Item) => round(i.reimbursement_payments.reduce((sum, p) => sum + Number(p.amount), 0));
const leftOf = (i: Item) => round(Number(i.amount) - paidOf(i));
const label = (i: Item) => i.transactions?.merchants?.name ?? i.transactions?.description ?? '';
const SETTLED_SHOWN = 30;

/**
 * Everything people owe you, by person, with what they've paid so far. Mark an
 * item received (paid in cash, say) or write it off; payments that arrive in
 * your accounts are linked from Transactions.
 */
export default function Owed() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await db()
      .from('reimbursements')
      .select(
        `id, who, amount, status, note, updated_at, ${CHARGE}(posted_date, description, merchants(name)), ` +
          'reimbursement_payments(amount, payment:transactions!reimbursement_payments_payment_transaction_id_fkey(posted_date))',
      )
      .order('updated_at', { ascending: false });
    if (error) setError(error.message);
    setItems((data ?? []) as unknown as Item[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function update(change: () => PromiseLike<{ error: { message: string } | null }>, done: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const { error } = await change();
    if (error) setError(error.message);
    else setNotice(done);
    await load();
    setBusy(false);
  }

  const setStatus = (i: Item, status: Status, done: string) =>
    update(() => db().from('reimbursements').update({ status, updated_at: new Date().toISOString() }).eq('id', i.id), done);

  function remove(i: Item) {
    if (!window.confirm(`Stop expecting ${money(i.amount)} from ${i.who} for ${label(i)}? The whole charge counts as yours again.`)) return;
    return update(() => db().from('reimbursements').delete().eq('id', i.id), `Removed. ${label(i)} counts in full again.`);
  }

  const open = (items ?? []).filter((i) => i.status === 'owed' && leftOf(i) > 0);
  const settled = (items ?? []).filter((i) => !open.includes(i)).slice(0, SETTLED_SHOWN);

  const people = new Map<string, Item[]>();
  for (const i of [...open].sort((a, b) => (a.transactions?.posted_date ?? '').localeCompare(b.transactions?.posted_date ?? ''))) {
    people.set(personKey(i.who), [...(people.get(personKey(i.who)) ?? []), i]);
  }
  const total = round(open.reduce((sum, i) => sum + leftOf(i), 0));

  return (
    <section>
      <header className="page-head">
        <h1>Owed to me</h1>
      </header>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}

      {items && open.length === 0 && (
        <p className="empty">
          Nobody owes you anything. On <Link to="/transactions">Transactions</Link>, open a charge’s details and choose
          Expect reimbursement when someone owes you part of it.
        </p>
      )}

      {open.length > 0 && (
        <>
          <p className="net-worth">
            <span className="muted">Total owed</span> <strong className="num">{money(total)}</strong>
          </p>
          <p className="muted small">
            When someone pays you back, link the payment on Transactions (it’s suggested under Paid back?), or enter a
            Venmo payment with Add transaction. Paid in cash? Mark it received.
          </p>
        </>
      )}

      {[...people.values()].map((group) => {
        const who = group[0].who.trim();
        const owes = round(group.reduce((sum, i) => sum + leftOf(i), 0));
        return (
          <div key={personKey(who)}>
            <h2>
              {who} <span className="muted owes">owes {money(owes)}</span>
            </h2>
            <table className="register owed">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">For</th>
                  <th scope="col" className="num">Owed</th>
                  <th scope="col" className="num">Paid</th>
                  <th scope="col" className="num">Left</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {group.map((i) => (
                  <tr key={i.id}>
                    <td>{shortDate(i.transactions?.posted_date)}</td>
                    <td>
                      {label(i)}
                      {i.note && <div className="muted small">{i.note}</div>}
                    </td>
                    <td className="num">{money(i.amount)}</td>
                    <td className="num">{paidOf(i) ? money(paidOf(i)) : '—'}</td>
                    <td className="num">{money(leftOf(i))}</td>
                    <td className="action">
                      <Button
                        size="small"
                        disabled={busy}
                        title="Paid outside your accounts, like cash"
                        onClick={() => setStatus(i, 'received', `Marked ${label(i)} received from ${who}.`)}
                      >
                        Received
                      </Button>
                      <Button
                        size="small"
                        variant="link"
                        disabled={busy}
                        title={paidOf(i) ? 'The unpaid part counts as your spending again' : 'It counts as your spending again'}
                        onClick={() =>
                          setStatus(i, 'written_off', `Wrote off ${money(leftOf(i))} from ${who}; it counts as your spending again.`)
                        }
                      >
                        Write off
                      </Button>
                      {paidOf(i) === 0 && (
                        <Button variant="icon" aria-label={`Stop expecting ${money(i.amount)} from ${who} for ${label(i)}`} title="Remove" disabled={busy} onClick={() => remove(i)}>
                          ×
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      {settled.length > 0 && (
        <>
          <h2>Settled</h2>
          <table className="register owed settled">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Who</th>
                <th scope="col">For</th>
                <th scope="col" className="num">Amount</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {settled.map((i) => {
                const paid = paidOf(i);
                const lastPaid = i.reimbursement_payments
                  .map((p) => p.payment?.posted_date ?? '')
                  .sort()
                  .at(-1);
                // reopening an item its payments fully cover would leave nothing owed
                const canReopen = paid < Number(i.amount);
                return (
                  <tr key={i.id}>
                    <td>{shortDate(i.transactions?.posted_date)}</td>
                    <td>{i.who}</td>
                    <td>{label(i)}</td>
                    <td className="num">{money(i.amount)}</td>
                    <td>
                      {i.status === 'written_off'
                        ? paid
                          ? `Written off after ${money(paid)} paid`
                          : 'Written off'
                        : lastPaid && paid >= Number(i.amount)
                          ? `Paid back ${shortDate(lastPaid)}`
                          : 'Received'}
                    </td>
                    <td className="action">
                      {canReopen && (
                        <Button
                          size="small"
                          variant="link"
                          disabled={busy}
                          onClick={() => setStatus(i, 'owed', `${i.who} owes ${money(leftOf(i))} for ${label(i)} again.`)}
                        >
                          Reopen
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted small">Fully paid items reopen by unlinking their payment on Transactions.</p>
        </>
      )}
    </section>
  );
}
