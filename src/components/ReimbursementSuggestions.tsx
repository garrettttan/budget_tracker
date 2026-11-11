import { Fragment, useState } from 'react';
import { round } from '../lib/cents';
import { money, shortDate } from '../lib/format';
import { type OpenItem, allocate } from '../lib/reimbursements';
import Button from './Button';
import { LinkForm } from './ReimbursementForms';
import { strings } from '../lib/strings';

const t = strings.suggestions;

/** Unreviewed money in (lib/transactions fetchUnreviewedIncome). */
export type PaymentRow = {
  id: string;
  posted_date: string;
  amount: string;
  description: string;
  accounts: { name: string } | null;
  merchants: { name: string } | null;
};

/** A payment and the open items it probably pays back (lib/reimbursementMatch suggestFor). */
export type ReimbursementMatch = { payment: PaymentRow; items: OpenItem[] };

/** How much of a payment is left over once `plan` has covered what's owed. */
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
      <h2>{t.paybacksTitle}</h2>
      <table className="register paybacks">
        <thead>
          <tr>
            <th scope="col">{t.moneyIn}</th>
            <th scope="col">{t.paysBack}</th>
            <th scope="col" className="num">{strings.spending.amount}</th>
            <th scope="col">
              <span className="visually-hidden">{strings.common.actions}</span>
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
                        {t.item(item.who, item.label, money(part))}
                        {part < item.remaining && <span className="muted">{t.ofTotal(money(item.remaining))}</span>}
                      </div>
                    ))}
                    {extra(amount, plan) > 0 && (
                      <div className="muted small">{t.moreThanOwed(money(extra(amount, plan)))}</div>
                    )}
                  </td>
                  <td className="num in">{money(amount)}</td>
                  <td className="action">
                    <Button size="small" disabled={busy} onClick={() => onLink(m.payment.id, plan.map((p) => p.item.id))}>
                      {t.link}
                    </Button>
                    <Button
                      size="small"
                      variant="link"
                      disabled={busy}
                      aria-expanded={choosing === m.payment.id}
                      onClick={() => setChoosing(choosing === m.payment.id ? null : m.payment.id)}
                    >
                      {t.choose}
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
