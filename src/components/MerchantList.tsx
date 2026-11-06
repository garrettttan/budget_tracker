import { useCallback, useEffect, useState } from 'react';
import { db } from '../lib/supabase';
import Button from './Button';
import Combobox from './Combobox';

type Merchant = {
  id: string;
  name: string;
  categories: { name: string } | null; // the remembered category
  transactions: { count: number }[];
  merchant_aliases: { count: number }[];
};

type Editing = { id: string; mode: 'rename' | 'merge' };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Settings → Merchants: rename a merchant, or merge duplicates into one. */
export default function MerchantList() {
  const [merchants, setMerchants] = useState<Merchant[] | null>(null);
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [draft, setDraft] = useState(''); // new name, or the merchant to merge into
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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

  const shown = filter ? merchants.filter((m) => m.name.toLowerCase().includes(filter.toLowerCase())) : merchants;
  const count = (m: Merchant) => m.transactions[0]?.count ?? 0;

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
            <th scope="col">Merchant</th>
            <th scope="col">Remembered category</th>
            <th scope="col" className="num">Transactions</th>
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
                    <span title={plural(aliases, 'bank description', 'bank descriptions')}>{m.name}</span>
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
                      Its {plural(count(m), 'transaction', 'transactions')} and{' '}
                      {plural(aliases, 'bank description', 'bank descriptions')} move to the merchant you pick, and{' '}
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
