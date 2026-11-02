import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../lib/supabase';
import { money, shortDate } from '../lib/format';
import CategorySelect, { type Category, TRANSFER } from '../components/CategorySelect';
import TransferSuggestions, { type Suggestion } from '../components/TransferSuggestions';

type Row = {
  id: string;
  posted_date: string;
  amount: string;
  description: string;
  pending: boolean;
  category_id: string | null;
  accounts: { name: string } | null;
  merchants: { name: string } | null;
};

export default function Review({ count, onChange }: { count: number | null; onChange: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [t, c, s] = await Promise.all([
      db()
        .from('transactions')
        .select('id, posted_date, amount, description, pending, category_id, accounts(name), merchants(name)')
        .eq('approved', false)
        .order('posted_date')
        .order('id')
        .limit(1000),
      db().from('categories').select('id, name, is_income').eq('archived', false).order('sort_order'),
      db().from('transfer_suggestions').select('out_id, in_id, amount, out_date, in_date').order('out_date'),
    ]);
    const failed = t.error ?? c.error ?? s.error;
    if (failed) setError(failed.message);
    setRows((t.data ?? []) as unknown as Row[]);
    setCategories((c.data ?? []) as Category[]);
    setSuggestions((s.data ?? []) as Suggestion[]);
    setSelected(new Set());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** Runs one action, then reloads the inbox and the Review badge. */
  async function act(action: () => PromiseLike<{ error: { message: string } | null }>, success?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const { error } = await action();
    if (error) setError(error.message);
    else if (success) setNotice(success);
    await load();
    onChange();
    setBusy(false);
  }

  async function setCategory(row: Row, value: string) {
    if (value === TRANSFER) {
      return act(() => db().rpc('mark_transfer', { p_id: row.id }), 'Marked as a transfer and approved.');
    }
    // just a pre-fill: the row stays unapproved until you approve it
    setRows((rs) => rs?.map((r) => (r.id === row.id ? { ...r, category_id: value } : r)) ?? null);
    const { error } = await db().from('transactions').update({ category_id: value }).eq('id', row.id);
    if (error) setError(error.message);
  }

  async function approve(ids: string[]) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const { data, error } = await db().rpc('approve_transactions', { p_ids: ids });
    if (error) setError(error.message);
    else {
      const n = data as number;
      setNotice(`Approved ${n} ${n === 1 ? 'transaction' : 'transactions'}.`);
    }
    await load();
    onChange();
    setBusy(false);
  }

  const toReview = rows?.filter((r) => !r.pending) ?? [];
  const pending = rows?.filter((r) => r.pending) ?? [];
  const ready = toReview.filter((r) => r.category_id);
  const allSelected = ready.length > 0 && ready.every((r) => selected.has(r.id));
  const accountName = (id: string) => rows?.find((r) => r.id === id)?.accounts?.name ?? '';

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section>
      <header className="page-head">
        <h1>Review</h1>
      </header>
      <div className="tally">
        <span className="tally-number">{count ?? '–'}</span>
        <span className="tally-label">{count === 1 ? 'transaction to review' : 'transactions to review'}</span>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}

      {count === 0 && (
        <p className="empty">
          Nothing waiting. New transactions from the daily sync land here until you approve them. Bank connection status
          is on the <Link to="/accounts">Accounts</Link> page.
        </p>
      )}

      {suggestions.length > 0 && (
        <TransferSuggestions
          suggestions={suggestions}
          accountName={accountName}
          busy={busy}
          onConfirm={(s) =>
            act(() => db().rpc('confirm_transfer', { p_out: s.out_id, p_in: s.in_id }), 'Transfer confirmed and approved.')
          }
          onDismiss={(s) =>
            act(
              () => db().from('dismissed_transfer_pairs').insert({ out_id: s.out_id, in_id: s.in_id }),
              'Dismissed. Both transactions are still in To review.',
            )
          }
        />
      )}

      {toReview.length > 0 && (
        <>
          <h2>To review</h2>
          <p className="muted small">
            Pick a category, then approve. Approving teaches the merchant its category and pre-fills your other
            unreviewed charges from it.
          </p>
          <div className="bulk-bar">
            <button
              type="button"
              className="primary"
              disabled={busy || selected.size === 0}
              onClick={() => approve([...selected])}
            >
              Approve selected ({selected.size})
            </button>
          </div>
          <table className="register review">
            <thead>
              <tr>
                <th scope="col">
                  <input
                    type="checkbox"
                    aria-label="Select all with a category"
                    checked={allSelected}
                    disabled={ready.length === 0}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(ready.map((r) => r.id)))}
                  />
                </th>
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
              {toReview.map((r) => (
                <tr key={r.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.merchants?.name ?? r.description}`}
                      checked={selected.has(r.id)}
                      disabled={!r.category_id}
                      onChange={() => toggle(r.id)}
                    />
                  </td>
                  <td>{shortDate(r.posted_date)}</td>
                  <td>
                    {r.merchants?.name ?? r.description}
                    {r.merchants && <div className="muted small raw">{r.description}</div>}
                  </td>
                  <td>{r.accounts?.name}</td>
                  <td>
                    <CategorySelect
                      categories={categories}
                      value={r.category_id}
                      disabled={busy}
                      label={`Category for ${r.merchants?.name ?? r.description}`}
                      onChange={(value) => setCategory(r, value)}
                    />
                  </td>
                  <td className={`num ${Number(r.amount) < 0 ? 'out' : 'in'}`}>{money(r.amount)}</td>
                  <td className="action">
                    <button
                      type="button"
                      disabled={busy || !r.category_id}
                      title={r.category_id ? undefined : 'Choose a category first'}
                      onClick={() => approve([r.id])}
                    >
                      Approve
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {pending.length > 0 && (
        <>
          <h2>Pending</h2>
          <p className="muted small">These can be approved once the bank posts them.</p>
          <table className="register">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Merchant</th>
                <th scope="col">Account</th>
                <th scope="col" className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((r) => (
                <tr key={r.id}>
                  <td>{shortDate(r.posted_date)}</td>
                  <td>
                    {r.merchants?.name ?? r.description}
                    <span className="tag">Pending</span>
                  </td>
                  <td>{r.accounts?.name}</td>
                  <td className={`num ${Number(r.amount) < 0 ? 'out' : 'in'}`}>{money(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
