import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../lib/supabase';
import Button from './Button';
import { strings } from '../lib/strings';

const tt = strings.tags;
const common = strings.common;

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
    if (error) setError(error.code === '23505' ? tt.duplicate : error.message);
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
    if (await act(() => db().from('tags').insert({ name }), tt.added(name))) {
      setNewName('');
    }
  }

  const rename = (t: TagRow) =>
    act(() => db().from('tags').update({ name: draft.trim() }).eq('id', t.id), common.renamedTo(draft.trim()));

  const remove = (t: TagRow) => act(() => db().from('tags').delete().eq('id', t.id), common.deleted(t.name));

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
          placeholder={tt.newPlaceholder}
          aria-label={tt.newLabel}
          value={newName}
          disabled={busy}
          onChange={(e) => setNewName(e.target.value)}
        />
        <Button type="submit" size="small" disabled={busy || !newName.trim()} title={newName.trim() ? undefined : common.typeName}>
          {tt.addButton}
        </Button>
      </form>

      {tags.length === 0 ? (
        <p className="muted">{tt.empty}</p>
      ) : (
        <table className="register tags">
          <thead>
            <tr>
              <th scope="col">{tt.tag}</th>
              <th scope="col" className="num">{common.transactions}</th>
              <th scope="col">
                <span className="visually-hidden">{common.actions}</span>
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
                        aria-label={strings.merchants.newNameFor(t.name)}
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
                      <Link to={`/spending?month=all&tag=${t.id}`} title={tt.showEvery(t.name)}>
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
                          title={draft.trim() ? undefined : common.typeName}
                          onClick={() => rename(t)}
                        >
                          {common.save}
                        </Button>
                        <Button size="small" variant="link" disabled={busy} onClick={() => setEditing(null)}>
                          {common.cancel}
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button size="small" disabled={busy || deleting} onClick={() => start(t, 'rename')}>
                          {common.rename}
                        </Button>
                        <Button size="small" disabled={busy || deleting} onClick={() => start(t, 'delete')}>
                          {tt.deleteButton}
                        </Button>
                      </>
                    )}
                  </td>
                </tr>,
                deleting && (
                  <tr key={`${t.id}-delete`} className="merge-row">
                    <td colSpan={3}>
                      <div className="merge-form">
                        <span>{tt.confirmDelete(t.name, count(t))}</span>
                        <Button size="small" variant="primary" disabled={busy} onClick={() => remove(t)}>
                          {common.delete}
                        </Button>
                        <Button size="small" variant="link" disabled={busy} onClick={() => setEditing(null)}>
                          {common.cancel}
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
