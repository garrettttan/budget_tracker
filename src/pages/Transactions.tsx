import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../lib/supabase';
import { money, shortDate } from '../lib/format';
import Button from '../components/Button';
import CategorySelect, { type Category, TRANSFER } from '../components/CategorySelect';
import MerchantCell from '../components/MerchantCell';

const PAGE = 100;

type Row = {
  id: string;
  posted_date: string;
  amount: string;
  description: string;
  pending: boolean;
  approved: boolean;
  is_transfer: boolean;
  transfer_pair_id: string | null;
  category_id: string | null;
  accounts: { name: string } | null;
  merchants: { name: string } | null;
};

const fetchRows = (from: number, to: number) =>
  db()
    .from('transactions')
    .select(
      'id, posted_date, amount, description, pending, approved, is_transfer, transfer_pair_id, category_id, accounts(name), merchants(name)',
    )
    .order('posted_date', { ascending: false })
    .order('id', { ascending: false })
    .range(from, to);

export default function Transactions({ onChange }: { onChange: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** Loads the first `count` rows again (everything already on screen). */
  const reload = useCallback(async (count: number) => {
    const { data, error } = await fetchRows(0, count - 1);
    if (error) return setError(error.message);
    setRows((data ?? []) as unknown as Row[]);
    setHasMore((data ?? []).length === count);
  }, []);

  useEffect(() => {
    // categories first, so approved rows never flash an empty picker
    db()
      .from('categories')
      .select('id, name, is_income')
      .eq('archived', false)
      .order('sort_order')
      .then(({ data, error }) => {
        if (error) setError(error.message);
        setCategories((data ?? []) as Category[]);
        reload(PAGE);
      });
  }, [reload]);

  async function loadMore() {
    const from = rows?.length ?? 0;
    setBusy(true);
    const { data, error } = await fetchRows(from, from + PAGE - 1);
    if (error) setError(error.message);
    else {
      setRows((rs) => [...(rs ?? []), ...((data ?? []) as unknown as Row[])]);
      setHasMore((data ?? []).length === PAGE);
    }
    setBusy(false);
  }

  /** Runs one action, then reloads the rows on screen and the Review badge. */
  async function act(action: () => PromiseLike<{ error: { message: string } | null }>, success: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const { error } = await action();
    if (error) setError(error.message);
    else setNotice(success);
    await reload(Math.max(rows?.length ?? 0, PAGE));
    onChange();
    setBusy(false);
  }

  const name = (r: Row) => r.merchants?.name ?? r.description;
  const pairNote = (r: Row) => (r.transfer_pair_id ? ' The other side of the transfer went back to Review.' : '');

  function setCategory(r: Row, value: string) {
    if (value === TRANSFER) {
      return act(() => db().rpc('mark_transfer', { p_id: r.id }), `${name(r)} is now a transfer.`);
    }
    const category = categories.find((c) => c.id === value)?.name;
    return act(
      () => db().rpc('recategorize_transactions', { p_ids: [r.id], p_category: value }),
      `${name(r)} is now ${category}.${pairNote(r)}`,
    );
  }

  function sendToReview(r: Row) {
    const both = r.transfer_pair_id ? ', with the other side of the transfer' : '';
    return act(() => db().rpc('send_to_review', { p_ids: [r.id] }), `${name(r)} went back to Review${both}.`);
  }

  const sendButton = (r: Row) => (
    <Button size="small" disabled={busy} title="Un-approve it and move it back to the Review inbox" onClick={() => sendToReview(r)}>
      Send to Review
    </Button>
  );

  return (
    <section>
      <header className="page-head">
        <h1>Transactions</h1>
      </header>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      {rows && rows.length === 0 && (
        <p className="empty">No transactions yet. They'll appear here after your first sync or import.</p>
      )}
      {rows && rows.length > 0 && (
        <>
          <p className="muted small">
            Change an approved transaction's category here, or send it back to Review. Unreviewed ones are edited in{' '}
            <Link to="/review">Review</Link>.
          </p>
          <table className="register txns">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Merchant</th>
                <th scope="col">Account</th>
                <th scope="col">Category</th>
                <th scope="col" className="num">Amount</th>
                <th scope="col">
                  <span className="visually-hidden">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.approved ? undefined : 'unreviewed'}>
                  <td>{shortDate(r.posted_date)}</td>
                  <td>
                    <MerchantCell
                      name={r.merchants?.name}
                      description={r.description}
                      postedDate={r.posted_date}
                      account={r.accounts?.name}
                    >
                      {r.approved && <div className="phone-only row-action">{sendButton(r)}</div>}
                    </MerchantCell>
                    {r.pending && <span className="tag">Pending</span>}
                  </td>
                  <td>{r.accounts?.name}</td>
                  <td>
                    {r.approved ? (
                      <CategorySelect
                        categories={categories}
                        value={r.is_transfer ? TRANSFER : r.category_id}
                        disabled={busy}
                        label={`Category for ${name(r)}`}
                        onChange={(value) => setCategory(r, value)}
                      />
                    ) : (
                      <Link to="/review" className="muted">
                        In Review
                      </Link>
                    )}
                  </td>
                  <td className={`num ${Number(r.amount) < 0 ? 'out' : 'in'}`}>{money(r.amount)}</td>
                  <td className="action">{r.approved && sendButton(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {hasMore && (
            <div className="load-more">
              <Button disabled={busy} onClick={loadMore}>
                Load {PAGE} more
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
