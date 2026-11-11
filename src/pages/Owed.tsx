import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../lib/supabase';
import { round } from '../lib/cents';
import { money, shortDate } from '../lib/format';
import { CHARGE, personKey } from '../lib/reimbursements';
import Button from '../components/Button';
import { strings } from '../lib/strings';

const t = strings.owed;

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

/** How many settled items to show (the most recently changed). */
const SETTLED_SHOWN = 30;

const paidOf = (i: Item) => round(i.reimbursement_payments.reduce((sum, p) => sum + Number(p.amount), 0));
const leftOf = (i: Item) => round(Number(i.amount) - paidOf(i));
/** The charge it's for: merchant name, else the bank's text. */
const label = (i: Item) => i.transactions?.merchants?.name ?? i.transactions?.description ?? '';

/**
 * Owed to me: everything people owe you, by person, with what they've paid so
 * far, then the last few settled items. Mark an item received (paid in cash,
 * say) or write it off; payments that arrive in your accounts are linked from
 * Spending.
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

  /** Runs one change, says `done` if it worked, and reloads. */
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
    if (!window.confirm(t.confirmRemove(money(i.amount), i.who, label(i)))) return;
    return update(() => db().from('reimbursements').delete().eq('id', i.id), t.removed(label(i)));
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
        <h1>{t.title}</h1>
      </header>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}

      {items && open.length === 0 && (
        <p className="empty">
          {t.emptyBefore} <Link to="/spending">{t.emptyLink}</Link>
          {t.emptyAfter}
        </p>
      )}

      {open.length > 0 && (
        <>
          <p className="net-worth">
            <span className="muted">{t.totalOwed}</span> <strong className="num">{money(total)}</strong>
          </p>
          <p className="muted small">{t.help}</p>
        </>
      )}

      {[...people.values()].map((group) => {
        const who = group[0].who.trim();
        const owes = round(group.reduce((sum, i) => sum + leftOf(i), 0));
        return (
          <div key={personKey(who)}>
            <h2>
              {who} <span className="muted owes">{t.owes(money(owes))}</span>
            </h2>
            <table className="register owed">
              <thead>
                <tr>
                  <th scope="col">{t.date}</th>
                  <th scope="col">{t.for}</th>
                  <th scope="col" className="num">{t.owedCol}</th>
                  <th scope="col" className="num">{t.paid}</th>
                  <th scope="col" className="num">{t.left}</th>
                  <th scope="col">
                    <span className="visually-hidden">{strings.common.actions}</span>
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
                    <td className="num">{paidOf(i) ? money(paidOf(i)) : strings.common.missing}</td>
                    <td className="num">{money(leftOf(i))}</td>
                    <td className="action">
                      <Button
                        size="small"
                        disabled={busy}
                        title={t.receivedTitle}
                        onClick={() => setStatus(i, 'received', t.markedReceived(label(i), who))}
                      >
                        {t.received}
                      </Button>
                      <Button
                        size="small"
                        variant="link"
                        disabled={busy}
                        title={paidOf(i) ? t.writeOffPartTitle : t.writeOffTitle}
                        onClick={() => setStatus(i, 'written_off', t.wroteOff(money(leftOf(i)), who))}
                      >
                        {t.writeOff}
                      </Button>
                      {paidOf(i) === 0 && (
                        <Button
                          variant="icon"
                          aria-label={t.stopExpecting(money(i.amount), who, label(i))}
                          title={t.remove}
                          disabled={busy}
                          onClick={() => remove(i)}
                        >
                          {strings.common.closeSymbol}
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
          <h2>{t.settled}</h2>
          <table className="register owed settled">
            <thead>
              <tr>
                <th scope="col">{t.date}</th>
                <th scope="col">{t.who}</th>
                <th scope="col">{t.for}</th>
                <th scope="col" className="num">{t.amount}</th>
                <th scope="col">{t.status}</th>
                <th scope="col">
                  <span className="visually-hidden">{strings.common.actions}</span>
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
                          ? t.writtenOffAfter(money(paid))
                          : t.writtenOff
                        : lastPaid && paid >= Number(i.amount)
                          ? t.paidBackOn(shortDate(lastPaid))
                          : t.received}
                    </td>
                    <td className="action">
                      {canReopen && (
                        <Button
                          size="small"
                          variant="link"
                          disabled={busy}
                          onClick={() => setStatus(i, 'owed', t.reopened(i.who, money(leftOf(i)), label(i)))}
                        >
                          {t.reopen}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted small">{t.reopenNote}</p>
        </>
      )}
    </section>
  );
}
