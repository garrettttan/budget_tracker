import { useEffect, useState } from 'react';
import { db } from '../lib/supabase';
import { money, shortDate } from '../lib/format';

type Row = {
  id: string;
  posted_date: string;
  amount: string;
  description: string;
  pending: boolean;
  approved: boolean;
  accounts: { name: string } | null;
  categories: { name: string } | null;
};

export default function Transactions() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    db()
      .from('transactions')
      .select('id, posted_date, amount, description, pending, approved, accounts(name), categories(name)')
      .order('posted_date', { ascending: false })
      .limit(200)
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setRows((data ?? []) as unknown as Row[]);
      });
  }, []);

  return (
    <section>
      <header className="page-head">
        <h1>Transactions</h1>
      </header>
      {error && <p className="error" role="alert">Couldn't load transactions: {error}</p>}
      {rows && rows.length === 0 && (
        <p className="empty">No transactions yet. They'll appear here after your first sync or import.</p>
      )}
      {rows && rows.length > 0 && (
        <table className="register txns">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Description</th>
              <th scope="col">Category</th>
              <th scope="col">Account</th>
              <th scope="col" className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.approved ? undefined : 'unreviewed'}>
                <td>{shortDate(r.posted_date)}</td>
                <td>
                  {r.description}
                  {r.pending && <span className="tag">Pending</span>}
                </td>
                <td>{r.categories?.name ?? <span className="muted">Uncategorized</span>}</td>
                <td>{r.accounts?.name}</td>
                <td className={`num ${Number(r.amount) < 0 ? 'out' : 'in'}`}>{money(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
