import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../lib/supabase';
import { plural } from '../lib/format';
import Button from './Button';

type TagRow = { id: string; name: string; transaction_tags: { count: number }[] };

/** The row being renamed or confirming a delete. */
type Editing = { id: string; mode: 'rename' | 'delete' };

/** Settings → Tags: add, rename or delete tags. Tagging itself happens on Spending. */
export default function TagList() {
  const [tags, setTags] = useState<TagRow[] | null>(null);
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await db().from('tags').select('id, name, transaction_tags(count)').order('name');
    if (error) setError(error.message);
    else setTags((data ?? []) as unknown as TagRow[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** Runs one change and reloads; returns whether it worked. */
  async function act(action: () => PromiseLike<{ error: { message: string; code?: string } | null }>, success: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const { error } = await action();
    if (error) setError(error.code === '23505' ? 'You already have a tag with that name.' : error.message);
    else {
      setNotice(success);
      setEditing(null);
    }
    await load();
    setBusy(false);
    return !error;
  }

  async function add() {
    const name = newName.trim();
    if (await act(() => db().from('tags').insert({ name }), `Added ${name}. Tag transactions with it on Spending.`)) {
      setNewName('');
    }
  }

  const rename = (t: TagRow) =>
    act(() => db().from('tags').update({ name: draft.trim() }).eq('id', t.id), `Renamed to ${draft.trim()}.`);

  const remove = (t: TagRow) => act(() => db().from('tags').delete().eq('id', t.id), `Deleted ${t.name}.`);

  function start(t: TagRow, mode: Editing['mode']) {
    setEditing({ id: t.id, mode });
    setDraft(t.name);
    setError(null);
    setNotice(null);
  }

  if (!tags) return null;
  const count = (t: TagRow) => t.transaction_tags[0]?.count ?? 0;

  return (
    <>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      <form
        className="tag-new"
        onSubmit={(e) => {
          e.preventDefault();
          if (newName.trim()) add();
        }}
      >
        <input
          type="text"
          className="merchant-name-input"
          placeholder="New tag, e.g. Japan 2026"
          aria-label="New tag name"
          value={newName}
          disabled={busy}
          onChange={(e) => setNewName(e.target.value)}
        />
        <Button type="submit" size="small" disabled={busy || !newName.trim()} title={newName.trim() ? undefined : 'Type a name first'}>
          Add tag
        </Button>
      </form>

      {tags.length === 0 ? (
        <p className="muted">No tags yet. Add one here, or with + Tag on any transaction.</p>
      ) : (
        <table className="register tags">
          <thead>
            <tr>
              <th scope="col">Tag</th>
              <th scope="col" className="num">Transactions</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {tags.map((t) => {
              const renaming = editing?.id === t.id && editing.mode === 'rename';
              const deleting = editing?.id === t.id && editing.mode === 'delete';
              return [
                <tr key={t.id}>
                  <td>
                    {renaming ? (
                      <input
                        type="text"
                        className="merchant-name-input"
                        aria-label={`New name for ${t.name}`}
                        value={draft}
                        autoFocus
                        disabled={busy}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && draft.trim()) rename(t);
                          if (e.key === 'Escape') setEditing(null);
                        }}
                      />
                    ) : (
                      t.name
                    )}
                  </td>
                  <td className="num">
                    {count(t) > 0 ? (
                      <Link to={`/spending?status=all&tag=${t.id}`} title={`Show transactions tagged ${t.name}`}>
                        {count(t)}
                      </Link>
                    ) : (
                      0
                    )}
                  </td>
                  <td className="action">
                    {renaming ? (
                      <>
                        <Button
                          size="small"
                          disabled={busy || !draft.trim()}
                          title={draft.trim() ? undefined : 'Type a name first'}
                          onClick={() => rename(t)}
                        >
                          Save
                        </Button>
                        <Button size="small" variant="link" disabled={busy} onClick={() => setEditing(null)}>
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button size="small" disabled={busy || deleting} onClick={() => start(t, 'rename')}>
                          Rename
                        </Button>
                        <Button size="small" disabled={busy || deleting} onClick={() => start(t, 'delete')}>
                          Delete…
                        </Button>
                      </>
                    )}
                  </td>
                </tr>,
                deleting && (
                  <tr key={`${t.id}-delete`} className="merge-row">
                    <td colSpan={3}>
                      <div className="merge-form">
                        <span>
                          Delete {t.name}?{' '}
                          {count(t) > 0
                            ? `It comes off its ${plural(count(t), 'transaction')}; the transactions stay.`
                            : 'No transactions carry it.'}
                        </span>
                        <Button size="small" variant="primary" disabled={busy} onClick={() => remove(t)}>
                          Delete
                        </Button>
                        <Button size="small" variant="link" disabled={busy} onClick={() => setEditing(null)}>
                          Cancel
                        </Button>
                      </div>
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
