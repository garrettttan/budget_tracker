import { money, shortDate } from '../lib/format';
import Button from './Button';
import { strings } from '../lib/strings';

const t = strings.suggestions;

export type Suggestion = {
  out_id: string;
  in_id: string;
  out_account_id: string;
  in_account_id: string;
  amount: string;
  out_date: string;
  in_date: string;
};

/** Possible transfers: an outflow and a matching inflow in two of your accounts. */
export default function TransferSuggestions({
  suggestions,
  accountName,
  onConfirm,
  onDismiss,
  busy,
}: {
  suggestions: Suggestion[];
  accountName: (accountId: string) => string;
  onConfirm: (s: Suggestion) => void;
  onDismiss: (s: Suggestion) => void;
  busy: boolean;
}) {
  return (
    <>
      <h2>{t.transfersTitle}</h2>
      <table className="register transfers">
        <thead>
          <tr>
            <th scope="col">{t.from}</th>
            <th scope="col">{t.to}</th>
            <th scope="col">{t.dates}</th>
            <th scope="col" className="num">{strings.spending.amount}</th>
            <th scope="col">
              <span className="visually-hidden">{t.action}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {suggestions.map((s) => (
            <tr key={`${s.out_id}:${s.in_id}`}>
              <td>{accountName(s.out_account_id)}</td>
              <td>{accountName(s.in_account_id)}</td>
              <td>
                {shortDate(s.out_date)}
                {s.in_date !== s.out_date && <span className="muted">{t.arrow(shortDate(s.in_date))}</span>}
              </td>
              <td className="num">{money(s.amount)}</td>
              <td className="action">
                <Button size="small" disabled={busy} onClick={() => onConfirm(s)}>
                  {t.confirmTransfer}
                </Button>
                <Button
                  variant="icon"
                  aria-label={t.notTransfer}
                  title={t.notTransfer}
                  disabled={busy}
                  onClick={() => onDismiss(s)}
                >
                  {strings.common.closeSymbol}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
