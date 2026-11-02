import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { db } from '../lib/supabase';
import { money, shortDate } from '../lib/format';
import Button from '../components/Button';
import CategorySelect, { type Category, TRANSFER } from '../components/CategorySelect';
import MerchantCell from '../components/MerchantCell';
import TransferSuggestions, { type Suggestion } from '../components/TransferSuggestions';

const PAGE = 100;

type Status = 'review' | 'approved' | 'all';
const STATUSES: Status[] = ['review', 'approved', 'all'];

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

function fetchRows(status: Status, from: number, to: number) {
  let q = db()
    .from('transactions')
    .select(
      'id, posted_date, amount, description, pending, approved, is_transfer, transfer_pair_id, category_id, accounts(name), merchants(name)',
    );
  if (status !== 'all') q = q.eq('approved', status === 'approved');
  return q.order('posted_date', { ascending: false }).order('id', { ascending: false }).range(from, to);
}

/**
 * Every transaction, filtered by review status. Each row can get or change
 * its category, and is approved or unapproved from here.
 */
export default function Transactions({ count, onChange }: { count: number | null; onChange: () => Promise<void> }) {
  const [params, setParams] = useSearchParams();
  const status: Status = STATUSES.find((s) => s === params.get('status')) ?? 'review';

  const [rows, setRows] = useState<Row[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [accounts, setAccounts] = useState<Map<string, string>>(new Map());
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      db().from('categories').select('id, name, is_income').eq('archived', false).order('sort_order'),
      db().from('accounts').select('id, name'),
    ]).then(([c, a]) => {
      if (c.error ?? a.error) setError((c.error ?? a.error)!.message);
      setCategories((c.data ?? []) as Category[]);
      setAccounts(new Map((a.data ?? []).map((x) => [x.id as string, x.name as string])));
    });
  }, []);

  /** Loads the first `size` rows of the current filter, plus transfer suggestions. */
  const reload = useCallback(
    async (size: number) => {
      const [t, s] = await Promise.all([
        fetchRows(status, 0, size - 1),
        status === 'approved'
          ? Promise.resolve({ data: [], error: null })
          : db()
              .from('transfer_suggestions')
              .select('out_id, in_id, out_account_id, in_account_id, amount, out_date, in_date')
              .order('out_date'),
      ]);
      const failed = t.error ?? s.error;
      if (failed) setError(failed.message);
      setRows((t.data ?? []) as unknown as Row[]);
      setHasMore((t.data ?? []).length === size);
      setSuggestions((s.data ?? []) as Suggestion[]);
      setSelected(new Set());
    },
    [status],
  );

  // categories first, so rows never flash an empty picker
  useEffect(() => {
    if (!categories) return;
    setRows(null);
    reload(PAGE);
  }, [categories, reload]);

  async function loadMore() {
    const from = rows?.length ?? 0;
    setBusy(true);
    const { data, error } = await fetchRows(status, from, from + PAGE - 1);
    if (error) setError(error.message);
    else {
      setRows((rs) => [...(rs ?? []), ...((data ?? []) as unknown as Row[])]);
      setHasMore((data ?? []).length === PAGE);
    }
    setBusy(false);
  }

  /** Runs one action, then reloads the rows on screen and the unreviewed badge. */
  async function act(action: () => PromiseLike<{ data?: unknown; error: { message: string } | null }>, success: (data: unknown) => string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const { data, error } = await action();
    if (error) setError(error.message);
    await reload(Math.max(rows?.length ?? 0, PAGE));
    await onChange();
    if (!error) setNotice(success(data)); // after the reload, so the list already shows it
    setBusy(false);
  }

  const name = (r: Row) => r.merchants?.name ?? r.description;
  const pairNote = (r: Row) => (r.transfer_pair_id ? ' The other side of the transfer is back in To review.' : '');

  async function setCategory(r: Row, value: string) {
    if (value === TRANSFER) {
      return act(() => db().rpc('mark_transfer', { p_id: r.id }), () => `${name(r)} is now a transfer and approved.`);
    }
    if (r.approved) {
      const category = categories?.find((c) => c.id === value)?.name;
      return act(
        () => db().rpc('recategorize_transactions', { p_ids: [r.id], p_category: value }),
        () => `${name(r)} is now ${category}.${pairNote(r)}`,
      );
    }
    // just a pre-fill: the row stays unapproved until you approve it
    setRows((rs) => rs?.map((x) => (x.id === r.id ? { ...x, category_id: value } : x)) ?? null);
    const { error } = await db().from('transactions').update({ category_id: value }).eq('id', r.id);
    if (error) setError(error.message);
  }

  const approve = (ids: string[]) =>
    act(
      () => db().rpc('approve_transactions', { p_ids: ids }),
      (n) => `Approved ${n} ${n === 1 ? 'transaction' : 'transactions'}.`,
    );

  const unapprove = (r: Row) =>
    act(() => db().rpc('send_to_review', { p_ids: [r.id] }), () => `${name(r)} is back in To review.${pairNote(r)}`);

  const ready = rows?.filter((r) => !r.approved && !r.pending && r.category_id) ?? [];
  const allSelected = ready.length > 0 && ready.every((r) => selected.has(r.id));

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setStatus(s: Status) {
    setNotice(null);
    setError(null);
    setParams(s === 'review' ? {} : { status: s });
  }

  const unapproveButton = (r: Row) => (
    <Button size="small" className="unapprove" disabled={busy} title="Move it back to To review" onClick={() => unapprove(r)}>
      Unapprove
    </Button>
  );

  const approveTitle = (r: Row) =>
    r.pending ? 'Pending: it can be approved once the bank posts it' : r.category_id ? undefined : 'Choose a category first';

  return (
    <section>
      <header className="page-head">
        <h1>Transactions</h1>
      </header>
      <div className="tally">
        <span className="tally-number">{count ?? '–'}</span>
        <span className="tally-label">{count === 1 ? 'transaction to review' : 'transactions to review'}</span>
      </div>

      <div className="filter" role="group" aria-label="Show">
        {STATUSES.map((s) => (
          <Button key={s} size="small" aria-pressed={status === s} onClick={() => setStatus(s)}>
            {s === 'review' ? `To review${count ? ` (${count})` : ''}` : s === 'approved' ? 'Approved' : 'All'}
          </Button>
        ))}
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}

      {suggestions.length > 0 && (
        <TransferSuggestions
          suggestions={suggestions}
          accountName={(id) => accounts.get(id) ?? ''}
          busy={busy}
          onConfirm={(s) =>
            act(() => db().rpc('confirm_transfer', { p_out: s.out_id, p_in: s.in_id }), () => 'Transfer confirmed and approved.')
          }
          onDismiss={(s) =>
            act(
              () => db().from('dismissed_transfer_pairs').insert({ out_id: s.out_id, in_id: s.in_id }),
              () => 'Dismissed. Both transactions are still in To review.',
            )
          }
        />
      )}

      {rows && rows.length === 0 && (
        <p className="empty">
          {status === 'review'
            ? 'Nothing waiting. New transactions from the daily sync land here until you approve them.'
            : status === 'approved'
              ? 'No approved transactions yet.'
              : "No transactions yet. They'll appear here after your first sync or import."}
        </p>
      )}

      {rows && rows.length > 0 && (
        <>
          {suggestions.length > 0 && <h2>Transactions</h2>}
          <p className="muted small">
            Pick a category, then approve. Approving teaches the merchant its category and pre-fills your other
            unreviewed charges from it. Approved by mistake? Unapprove it.
          </p>
          {status !== 'approved' && (
            <div className="bulk-bar">
              <Button variant="primary" disabled={busy || selected.size === 0} onClick={() => approve([...selected])}>
                Approve selected ({selected.size})
              </Button>
            </div>
          )}
          <table className="register txns">
            <thead>
              <tr>
                <th scope="col">
                  <input
                    type="checkbox"
                    aria-label="Select all ready to approve"
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
              {rows.map((r) => (
                <tr key={r.id} className={r.approved ? undefined : 'unreviewed'}>
                  <td>
                    {!r.approved && (
                      <input
                        type="checkbox"
                        aria-label={`Select ${name(r)}`}
                        checked={selected.has(r.id)}
                        disabled={r.pending || !r.category_id}
                        onChange={() => toggle(r.id)}
                      />
                    )}
                  </td>
                  <td>{shortDate(r.posted_date)}</td>
                  <td>
                    <MerchantCell
                      name={r.merchants?.name}
                      description={r.description}
                      postedDate={r.posted_date}
                      account={r.accounts?.name}
                    >
                      {/* phones: Unapprove lives here, so approved rows stay narrow */}
                      {r.approved && <div className="phone-only row-action">{unapproveButton(r)}</div>}
                    </MerchantCell>
                    {r.pending && <span className="tag">Pending</span>}
                  </td>
                  <td>{r.accounts?.name}</td>
                  <td>
                    <CategorySelect
                      categories={categories ?? []}
                      value={r.is_transfer ? TRANSFER : r.category_id}
                      disabled={busy || r.pending}
                      label={`Category for ${name(r)}`}
                      onChange={(value) => setCategory(r, value)}
                    />
                  </td>
                  <td className={`num ${Number(r.amount) < 0 ? 'out' : 'in'}`}>{money(r.amount)}</td>
                  <td className="action">
                    {r.approved ? (
                      unapproveButton(r)
                    ) : (
                      <Button
                        size="small"
                        disabled={busy || r.pending || !r.category_id}
                        title={approveTitle(r)}
                        onClick={() => approve([r.id])}
                      >
                        Approve
                      </Button>
                    )}
                  </td>
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
