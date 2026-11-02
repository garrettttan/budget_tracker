import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { db } from '../lib/supabase';
import { money, shortDate } from '../lib/format';
import Button from '../components/Button';
import CategorySelect, { type Category, TRANSFER } from '../components/CategorySelect';
import MerchantCell from '../components/MerchantCell';
import TagCell, { type Tag } from '../components/TagCell';
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
  transaction_tags: { tag_id: string }[];
};

const COLUMNS =
  'id, posted_date, amount, description, pending, approved, is_transfer, transfer_pair_id, category_id, accounts(name), merchants(name), transaction_tags(tag_id)';

/**
 * Posted rows only: pending ones have their own section. With a tag, a second,
 * inner join on the tags keeps only rows carrying it, while transaction_tags
 * still lists all of each row's tags.
 */
function fetchRows(status: Status, tag: string | null, from: number, to: number) {
  let q = db()
    .from('transactions')
    .select(tag ? `${COLUMNS}, tag_filter:transaction_tags!inner(tag_id)` : COLUMNS)
    .eq('pending', false);
  if (tag) q = q.eq('tag_filter.tag_id', tag);
  if (status !== 'all') q = q.eq('approved', status === 'approved');
  return q.order('posted_date', { ascending: false }).order('id', { ascending: false }).range(from, to);
}

/** Pending rows are never approved, and there are only ever a few, so all of them at once. */
function fetchPending() {
  return db()
    .from('transactions')
    .select(COLUMNS)
    .eq('pending', true)
    .order('posted_date', { ascending: false })
    .order('id', { ascending: false });
}

const PENDING_OPEN_KEY = 'transactions.pendingOpen';

function readPendingOpen() {
  try {
    return localStorage.getItem(PENDING_OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

function savePendingOpen(open: boolean) {
  try {
    localStorage.setItem(PENDING_OPEN_KEY, open ? '1' : '0');
  } catch {
    // storage unavailable: the section just starts closed next time
  }
}

/**
 * Every transaction, filtered by review status (and optionally by tag). Each
 * posted row can get or change its category and tags, and is approved or
 * unapproved from here.
 */
export default function Transactions({ count, onChange }: { count: number | null; onChange: () => Promise<void> }) {
  const [params, setParams] = useSearchParams();
  const status: Status = STATUSES.find((s) => s === params.get('status')) ?? 'review';
  const tagFilter = params.get('tag');

  const [rows, setRows] = useState<Row[] | null>(null);
  const [pending, setPending] = useState<Row[]>([]);
  const [pendingOpen, setPendingOpen] = useState(readPendingOpen);
  const [hasMore, setHasMore] = useState(false);
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [accounts, setAccounts] = useState<Map<string, string>>(new Map());
  const [tags, setTags] = useState<Tag[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      db().from('categories').select('id, name, is_income').eq('archived', false).order('sort_order'),
      db().from('accounts').select('id, name'),
      db().from('tags').select('id, name').order('name'),
    ]).then(([c, a, t]) => {
      const failed = c.error ?? a.error ?? t.error;
      if (failed) setError(failed.message);
      setCategories((c.data ?? []) as Category[]);
      setAccounts(new Map((a.data ?? []).map((x) => [x.id as string, x.name as string])));
      setTags((t.data ?? []) as Tag[]);
    });
  }, []);

  /** Loads the first `size` rows of the current filter, plus transfer suggestions. */
  const reload = useCallback(
    async (size: number) => {
      const none = Promise.resolve({ data: [], error: null });
      const [t, p, s] = await Promise.all([
        fetchRows(status, tagFilter, 0, size - 1),
        // pending rows can't carry tags, so a tag filter leaves them out
        status === 'approved' || tagFilter ? none : fetchPending(),
        status === 'approved' || tagFilter
          ? none
          : db()
              .from('transfer_suggestions')
              .select('out_id, in_id, out_account_id, in_account_id, amount, out_date, in_date')
              .order('out_date'),
      ]);
      const failed = t.error ?? p.error ?? s.error;
      if (failed) setError(failed.message);
      setRows((t.data ?? []) as unknown as Row[]);
      setHasMore((t.data ?? []).length === size);
      setPending((p.data ?? []) as unknown as Row[]);
      setSuggestions((s.data ?? []) as Suggestion[]);
    },
    [status, tagFilter],
  );

  // categories first, so rows never flash an empty picker
  useEffect(() => {
    if (!categories) return;
    setRows(null);
    setPending([]);
    reload(PAGE);
  }, [categories, reload]);

  async function loadMore() {
    const from = rows?.length ?? 0;
    setBusy(true);
    const { data, error } = await fetchRows(status, tagFilter, from, from + PAGE - 1);
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

  /** Changes the filters in the URL; `undefined` keeps a filter as it is. */
  function setFilters(next: { status?: Status; tag?: string | null }) {
    setNotice(null);
    setError(null);
    const s = next.status ?? status;
    const t = next.tag === undefined ? tagFilter : next.tag;
    setParams({ ...(s === 'review' ? {} : { status: s }), ...(t ? { tag: t } : {}) });
  }

  const tagName = (id: string) => tags.find((t) => t.id === id)?.name ?? 'a deleted tag';
  const rowTags = (r: Row) =>
    r.transaction_tags
      .map((x) => tags.find((t) => t.id === x.tag_id))
      .filter((t): t is Tag => Boolean(t))
      .sort((a, b) => a.name.localeCompare(b.name));

  /** Shows a tag change right away; reloads the rows if saving it failed. */
  async function saveTags(r: Row, tagIds: string[], save: () => PromiseLike<{ error: { message: string } | null }>) {
    setError(null);
    setNotice(null);
    setRows((rs) => rs?.map((x) => (x.id === r.id ? { ...x, transaction_tags: tagIds.map((tag_id) => ({ tag_id })) } : x)) ?? null);
    const { error } = await save();
    if (error) {
      setError(error.message);
      await reload(Math.max(rows?.length ?? 0, PAGE));
    }
  }

  const ids = (r: Row) => r.transaction_tags.map((x) => x.tag_id);

  function addTag(r: Row, tagId: string) {
    if (ids(r).includes(tagId)) return;
    return saveTags(r, [...ids(r), tagId], () =>
      db().from('transaction_tags').insert({ transaction_id: r.id, tag_id: tagId }),
    );
  }

  function removeTag(r: Row, tagId: string) {
    return saveTags(
      r,
      ids(r).filter((x) => x !== tagId),
      () => db().from('transaction_tags').delete().eq('transaction_id', r.id).eq('tag_id', tagId),
    );
  }

  async function createTag(r: Row, typed: string) {
    const existing = tags.find((t) => t.name.toLowerCase() === typed.toLowerCase());
    if (existing) return addTag(r, existing.id);
    const { data, error } = await db().from('tags').insert({ name: typed }).select('id, name').single();
    if (error) return setError(error.message);
    const tag = data as Tag;
    setTags((ts) => [...ts, tag].sort((a, b) => a.name.localeCompare(b.name)));
    return addTag(r, tag.id);
  }

  function toggleApproved(r: Row) {
    // flip the box right away; the reload that follows confirms it
    setRows((rs) => rs?.map((x) => (x.id === r.id ? { ...x, approved: !x.approved } : x)) ?? null);
    return r.approved ? unapprove(r) : approve([r.id]);
  }

  const approvedTitle = (r: Row) =>
    r.approved ? 'Untick to move it back to To review' : r.category_id ? 'Tick to approve' : 'Choose a category first';

  function togglePending(open: boolean) {
    setPendingOpen(open);
    savePendingOpen(open);
  }

  const pendingTotal = pending.reduce((sum, r) => sum + Number(r.amount), 0);

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
          <Button key={s} size="small" aria-pressed={status === s} onClick={() => setFilters({ status: s })}>
            {s === 'review' ? `To review${count ? ` (${count})` : ''}` : s === 'approved' ? 'Approved' : 'All'}
          </Button>
        ))}
      </div>

      {tagFilter && (
        <p className="tag-filter">
          Tagged <strong>{tagName(tagFilter)}</strong>
          <Button variant="link" onClick={() => setFilters({ tag: null })}>
            Show every tag
          </Button>
        </p>
      )}

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

      {pending.length > 0 && (
        <details
          className="pending-section"
          open={pendingOpen}
          onToggle={(e) => togglePending((e.currentTarget as HTMLDetailsElement).open)}
        >
          <summary>
            <span className="pending-title">Pending</span>
            <span className="muted">
              {' '}
              {pending.length} {pending.length === 1 ? 'transaction' : 'transactions'},{' '}
              <span className={pendingTotal < 0 ? 'out' : 'in'}>{money(pendingTotal)}</span>
            </span>
          </summary>
          <p className="muted small">
            Not posted by the bank yet, so the amount can still change. Each one moves into the list below, ready to
            review, once it posts.
          </p>
          <table className="register txns pending-txns">
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
                    <MerchantCell
                      name={r.merchants?.name}
                      description={r.description}
                      postedDate={r.posted_date}
                      account={r.accounts?.name}
                    />
                  </td>
                  <td>{r.accounts?.name}</td>
                  <td className={`num ${Number(r.amount) < 0 ? 'out' : 'in'}`}>{money(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {rows && rows.length === 0 && (
        <p className="empty">
          {tagFilter
            ? `No ${status === 'review' ? 'transactions to review' : status === 'approved' ? 'approved transactions' : 'transactions'} carry this tag.`
            : status === 'review'
            ? 'Nothing waiting. New transactions from the daily sync land here until you approve them.'
            : status === 'approved'
              ? 'No approved transactions yet.'
              : "No transactions yet. They'll appear here after your first sync or import."}
        </p>
      )}

      {rows && rows.length > 0 && (
        <>
          {(suggestions.length > 0 || pending.length > 0) && <h2>Transactions</h2>}
          <p className="muted small">
            Pick a category, then tick Approved. Approving teaches the merchant its category and pre-fills your other
            unreviewed charges from it. Approved by mistake? Untick it. Tags group transactions across categories (like a
            trip); tagged spending is kept apart from your normal spending.
          </p>
          <table className="register txns">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Merchant</th>
                <th scope="col">Account</th>
                <th scope="col">Category</th>
                <th scope="col" className="num">Amount</th>
                <th scope="col" className="approved-col">
                  Approved
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
                    />
                    <TagCell
                      tags={rowTags(r)}
                      allTags={tags}
                      rowName={name(r)}
                      onAdd={(id) => addTag(r, id)}
                      onCreate={(typed) => createTag(r, typed)}
                      onRemove={(id) => removeTag(r, id)}
                      onFilter={(id) => setFilters({ tag: id })}
                    />
                  </td>
                  <td>{r.accounts?.name}</td>
                  <td>
                    <CategorySelect
                      categories={categories ?? []}
                      value={r.is_transfer ? TRANSFER : r.category_id}
                      disabled={busy}
                      label={`Category for ${name(r)}`}
                      onChange={(value) => setCategory(r, value)}
                    />
                  </td>
                  <td className={`num ${Number(r.amount) < 0 ? 'out' : 'in'}`}>{money(r.amount)}</td>
                  <td className="approved-col">
                    <input
                      type="checkbox"
                      aria-label={`Approved: ${name(r)}`}
                      title={approvedTitle(r)}
                      checked={r.approved}
                      disabled={busy || (!r.approved && !r.category_id)}
                      onChange={() => toggleApproved(r)}
                    />
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
