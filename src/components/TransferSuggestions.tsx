import { money, shortDate } from '../lib/format';

export type Suggestion = { out_id: string; in_id: string; amount: string; out_date: string; in_date: string };

/** Possible transfers: an outflow and a matching inflow in two of your accounts. */
export default function TransferSuggestions({
  suggestions,
  accountName,
  onConfirm,
  busy,
}: {
  suggestions: Suggestion[];
  accountName: (transactionId: string) => string;
  onConfirm: (s: Suggestion) => void;
  busy: boolean;
}) {
  return (
    <>
      <h2>Possible transfers</h2>
      <p className="muted small">
        Money moving between your own accounts isn't spending. Confirm a pair to mark both sides as a transfer and approve
        them. If a pair isn't a transfer, categorize those transactions below instead.
      </p>
      <table className="register">
        <thead>
          <tr>
            <th scope="col">From</th>
            <th scope="col">To</th>
            <th scope="col">Dates</th>
            <th scope="col" className="num">Amount</th>
            <th scope="col">
              <span className="visually-hidden">Action</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {suggestions.map((s) => (
            <tr key={`${s.out_id}:${s.in_id}`}>
              <td>{accountName(s.out_id)}</td>
              <td>{accountName(s.in_id)}</td>
              <td>
                {shortDate(s.out_date)}
                {s.in_date !== s.out_date && <span className="muted"> → {shortDate(s.in_date)}</span>}
              </td>
              <td className="num">{money(s.amount)}</td>
              <td className="action">
                <button type="button" disabled={busy} onClick={() => onConfirm(s)}>
                  Confirm transfer
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
