import { useCallback, useEffect, useState } from 'react';
import { db } from '../lib/supabase';
import { plural } from '../lib/format';
import Button from './Button';
import Combobox from './Combobox';

type Merchant = {
  id: string;
  name: string;
  categories: { name: string } | null; // the remembered category
  transactions: { count: number }[];
  merchant_aliases: { count: number }[];
};

/** The row being renamed or merged. */
type Editing = { id: string; mode: 'rename' | 'merge' };
type Sort = { by: 'name' | 'count'; desc: boolean };

/**
 * Settings → Merchants: rename a merchant, or merge duplicates into one. A
 * merchant groups every bank description the sync has matched to it.
 */
export default function MerchantList() {
  const [merchants, setMerchants] = useState<Merchant[] | null>(null);
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [draft, setDraft] = useState(''); // new name, or the merchant to merge into
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>({ by: 'name', desc: false });

  const load = useCallback(async () => {
    const { data, error } = await db()
      .from('merchants')
      .select('id, name, categories(name), transactions(count), merchant_aliases(count)')
      .order('name');
    if (error) setError(error.message);
    else setMerchants((data ?? []) as unknown as Merchant[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function start(m: Merchant, mode: Editing['mode']) {
    setEditing({ id: m.id, mode });
    setDraft(mode === 'rename' ? m.name : '');
    setError(null);
    setNotice(null);
  }

  /** Runs one change and reloads. */
  async function act(action: () => PromiseLike<{ error: { message: string } | null }>, success: string) {
    setBusy(true);
    setError(null);
    const { error } = await action();
    if (error) setError(error.message);
    else {
      setNotice(success);
      setEditing(null);
    }
    await load();
    setBusy(false);
  }

  const rename = (m: Merchant) =>
    act(() => db().from('merchants').update({ name: draft.trim() }).eq('id', m.id), `Renamed to ${draft.trim()}.`);

  function merge(m: Merchant) {
    const into = merchants?.find((x) => x.id === draft);
    return act(() => db().rpc('merge_merchants', { p_from: m.id, p_into: draft }), `Merged ${m.name} into ${into?.name}.`);
  }

  if (!merchants) return null;
  if (merchants.length === 0) return <p className="muted">Merchants appear here after your first sync.</p>;

  const count = (m: Merchant) => m.transactions[0]?.count ?? 0;
  const byName = (a: Merchant, b: Merchant) => a.name.localeCompare(b.name);
  const shown = (filter ? merchants.filter((m) => m.name.toLowerCase().includes(filter.toLowerCase())) : merchants)
    .slice()
    .sort((a, b) => {
      const order = sort.by === 'count' ? count(a) - count(b) : byName(a, b);
      return (sort.desc ? -order : order) || byName(a, b); // ties stay A–Z
    });
  // a header click sorts by that column (transactions start most first); clicking again flips it
  const sortBy = (by: Sort['by']) =>
    setSort((s) => (s.by === by ? { by, desc: !s.desc } : { by, desc: by === 'count' }));
  const ariaSort = (by: Sort['by']) => (sort.by === by ? (sort.desc ? 'descending' : 'ascending') : undefined);
  // a header you can sort by: always shows the up/down icon; the sorted one is teal with its direction lit
  const sortHeader = (by: Sort['by'], label: string) => (
    <Button variant="link" className={`th-sort${sort.by === by ? ' active' : ''}`} onClick={() => sortBy(by)}>
      {label}
      <svg className="th-sort-icon" viewBox="0 0 8 12" aria-hidden="true">
        <path d="M4 0.5 7.5 4.5H0.5z" className={sort.by === by && sort.desc ? 'dim' : undefined} />
        <path d="M4 11.5 0.5 7.5h7z" className={sort.by === by && !sort.desc ? 'dim' : undefined} />
      </svg>
    </Button>
  );

  return (
    <>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      <input
        type="search"
        className="merchant-filter"
        placeholder="Find a merchant"
        aria-label="Find a merchant"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <table className="register merchants">
        <thead>
          <tr>
            <th scope="col" aria-sort={ariaSort('name')}>
              {sortHeader('name', 'Merchant')}
            </th>
            <th scope="col">Remembered category</th>
            <th scope="col" className="num" aria-sort={ariaSort('count')}>
              {sortHeader('count', 'Transactions')}
            </th>
            <th scope="col">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map((m) => {
            const renaming = editing?.id === m.id && editing.mode === 'rename';
            const merging = editing?.id === m.id && editing.mode === 'merge';
            const aliases = m.merchant_aliases[0]?.count ?? 0;
            return [
              <tr key={m.id}>
                <td>
                  {renaming ? (
                    <input
                      type="text"
                      className="merchant-name-input"
                      aria-label={`New name for ${m.name}`}
                      value={draft}
                      autoFocus
                      disabled={busy}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && draft.trim()) rename(m);
                        if (e.key === 'Escape') setEditing(null);
                      }}
                    />
                  ) : (
                    <span title={plural(aliases, 'bank description')}>{m.name}</span>
                  )}
                </td>
                <td>{m.categories?.name ?? <span className="muted">None yet</span>}</td>
                <td className="num">{count(m)}</td>
                <td className="action">
                  {renaming ? (
                    <>
                      <Button
                        size="small"
                        disabled={busy || !draft.trim()}
                        title={draft.trim() ? undefined : 'Type a name first'}
                        onClick={() => rename(m)}
                      >
                        Save
                      </Button>
                      <Button size="small" variant="link" disabled={busy} onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button size="small" disabled={busy || merging} onClick={() => start(m, 'rename')}>
                        Rename
                      </Button>
                      <Button
                        size="small"
                        disabled={busy || merging || merchants.length < 2}
                        title={merchants.length < 2 ? 'There is no other merchant to merge into' : undefined}
                        aria-label={`Merge ${m.name} into another merchant`}
                        onClick={() => start(m, 'merge')}
                      >
                        Merge
                      </Button>
                    </>
                  )}
                </td>
              </tr>,
              merging && (
                <tr key={`${m.id}-merge`} className="merge-row">
                  <td colSpan={4}>
                    <div className="merge-form">
                      <span>Merge {m.name} into</span>
                      <Combobox
                        options={merchants.filter((x) => x.id !== m.id).map((x) => ({ value: x.id, text: x.name }))}
                        value={draft || null}
                        onChange={setDraft}
                        label={`Merchant to merge ${m.name} into`}
                        disabled={busy}
                        autoFocus
                      />
                      <Button
                        size="small"
                        variant="primary"
                        disabled={busy || !draft}
                        title={draft ? undefined : 'Choose a merchant first'}
                        onClick={() => merge(m)}
                      >
                        Merge
                      </Button>
                      <Button size="small" variant="link" disabled={busy} onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                    </div>
                    <p className="muted small">
                      Its {plural(count(m), 'transaction')} and{' '}
                      {plural(aliases, 'bank description')} move to the merchant you pick, and{' '}
                      {m.name} is removed.
                    </p>
                  </td>
                </tr>
              ),
            ];
          })}
        </tbody>
      </table>
      {shown.length === 0 && <p className="muted">No merchant matches "{filter}".</p>}
    </>
  );
}
