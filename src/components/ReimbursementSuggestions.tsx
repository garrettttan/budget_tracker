import { Fragment, useState } from 'react';
import { money, shortDate } from '../lib/format';
import { type OpenItem, allocate, round } from '../lib/reimbursements';
import Button from './Button';
import { LinkForm } from './RowReimbursements';

export type PaymentRow = {
  id: string;
  posted_date: string;
  amount: string;
  description: string;
  accounts: { name: string } | null;
  merchants: { name: string } | null;
};

export type ReimbursementMatch = { payment: PaymentRow; items: OpenItem[] };

const extra = (amount: number, plan: { part: number }[]) => round(amount - plan.reduce((sum, p) => sum + p.part, 0));

/**
 * Money in that looks like someone paying you back. Link pays back the items
 * shown (oldest first); Choose… opens a picker for other people or items. Not
 * a payback? Give it a category below and it drops off this list.
 */
export default function ReimbursementSuggestions({
  matches,
  open,
  busy,
  onLink,
}: {
  matches: ReimbursementMatch[];
  /** everything still owed, for Choose… */
  open: OpenItem[];
  busy: boolean;
  onLink: (paymentId: string, reimbursementIds: string[]) => void;
}) {
  const [choosing, setChoosing] = useState<string | null>(null); // payment id
  return (
    <>
      <h2>Paid back?</h2>
      <p className="muted small">
        Money in that looks like someone paying you back. Linking approves it; it isn’t counted as income. Not a payback? Give
        it a category below instead.
      </p>
      <table className="register paybacks">
        <thead>
          <tr>
            <th scope="col">Money in</th>
            <th scope="col">Pays back</th>
            <th scope="col" className="num">Amount</th>
            <th scope="col">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {matches.map((m) => {
            const amount = Number(m.payment.amount);
            const plan = allocate(amount, m.items);
            return (
              <Fragment key={m.payment.id}>
              <tr>
                <td>
                  {m.payment.merchants?.name ?? m.payment.description}
                  <div className="muted small">
                    {shortDate(m.payment.posted_date)} · {m.payment.accounts?.name}
                    <span className="phone-only in"> · {money(amount)}</span>
                  </div>
                </td>
                <td>
                  {plan.map(({ item, part }) => (
                    <div key={item.id}>
                      {item.who}: {item.label} {money(part)}
                      {part < item.remaining && <span className="muted"> of {money(item.remaining)}</span>}
                    </div>
                  ))}
                  {extra(amount, plan) > 0 && (
                    <div className="muted small">{money(extra(amount, plan))} more than they owe; not counted as income</div>
                  )}
                </td>
                <td className="num in">{money(amount)}</td>
                <td className="action">
                  <Button size="small" disabled={busy} onClick={() => onLink(m.payment.id, plan.map((p) => p.item.id))}>
                    Link
                  </Button>
                  <Button
                    size="small"
                    variant="link"
                    disabled={busy}
                    aria-expanded={choosing === m.payment.id}
                    onClick={() => setChoosing(choosing === m.payment.id ? null : m.payment.id)}
                  >
                    Choose…
                  </Button>
                </td>
              </tr>
              {choosing === m.payment.id && (
                <tr className="choose-row">
                  <td colSpan={4}>
                    <LinkForm
                      payment={amount}
                      open={open}
                      initial={m.items}
                      busy={busy}
                      onCancel={() => setChoosing(null)}
                      onLink={(ids) => {
                        setChoosing(null);
                        onLink(m.payment.id, ids);
                      }}
                    />
                  </td>
                </tr>
              )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
