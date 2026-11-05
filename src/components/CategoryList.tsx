import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../lib/supabase';
import Button from './Button';
import PencilIcon from './PencilIcon';
import EditCategory, { type EditableCategory } from './EditCategory';

type CategoryRow = EditableCategory & { sort_order: number; transactions: { count: number }[] };

/**
 * Settings → Categories: add, reorder (the order every category picker uses),
 * and edit or delete in a modal.
 */
export default function CategoryList() {
  const [categories, setCategories] = useState<CategoryRow[] | null>(null);
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<CategoryRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await db()
      .from('categories')
      .select('id, name, group_name, is_income, sort_order, transactions(count)')
      .eq('archived', false)
      .order('sort_order')
      .order('name');
    if (error) setError(error.message);
    else setCategories((data ?? []) as unknown as CategoryRow[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function reset() {
    setError(null);
    setNotice(null);
  }

  async function add() {
    const name = newName.trim();
    const last = categories?.[categories.length - 1];
    setBusy(true);
    reset();
    const { error } = await db()
      .from('categories')
      .insert({ name, group_name: last?.group_name ?? null, sort_order: (last?.sort_order ?? 0) + 10 });
    if (error) setError(error.code === '23505' ? 'You already have a category with that name.' : error.message);
    else {
      setNewName('');
      setNotice(`Added ${name}.`);
    }
    await load();
    setBusy(false);
  }

  /** Swap a category with its neighbor, renumbering only the rows whose place changed. */
  async function move(index: number, by: -1 | 1) {
    if (!categories) return;
    const order = [...categories];
    [order[index], order[index + by]] = [order[index + by], order[index]];
    const changed = order
      .map((c, i) => ({ id: c.id, sort_order: (i + 1) * 10, was: c.sort_order }))
      .filter((c) => c.sort_order !== c.was);
    setBusy(true);
    reset();
    setCategories(order.map((c, i) => ({ ...c, sort_order: (i + 1) * 10 })));
    const results = await Promise.all(
      changed.map((c) => db().from('categories').update({ sort_order: c.sort_order }).eq('id', c.id)),
    );
    const failed = results.find((r) => r.error);
    if (failed) setError(failed.error!.message);
    await load();
    setBusy(false);
  }

  if (!categories) return null;
  const count = (c: CategoryRow) => c.transactions[0]?.count ?? 0;

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
          placeholder="New category"
          aria-label="New category name"
          value={newName}
          disabled={busy}
          onChange={(e) => setNewName(e.target.value)}
        />
        <Button type="submit" size="small" disabled={busy || !newName.trim()} title={newName.trim() ? undefined : 'Type a name first'}>
          Add category
        </Button>
      </form>

      <table className="register categories">
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col">Group</th>
            <th scope="col" className="num">Transactions</th>
            <th scope="col">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {categories.map((c, i) => (
            <tr key={c.id}>
              <td>
                {c.name}
                {c.is_income && <span className="account-sub">Income</span>}
              </td>
              <td>{c.group_name ?? <span className="muted">None</span>}</td>
              <td className="num">
                {count(c) > 0 ? (
                  <Link to={`/transactions?status=all&category=${c.id}`} title={`Show ${c.name} transactions`}>
                    {count(c)}
                  </Link>
                ) : (
                  0
                )}
              </td>
              <td className="action">
                <Button
                  variant="icon"
                  aria-label={`Move ${c.name} up`}
                  title="Move up"
                  disabled={busy || i === 0}
                  onClick={() => move(i, -1)}
                >
                  ↑
                </Button>
                <Button
                  variant="icon"
                  aria-label={`Move ${c.name} down`}
                  title="Move down"
                  disabled={busy || i === categories.length - 1}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </Button>
                <Button
                  variant="icon"
                  aria-label={`Edit ${c.name}`}
                  title="Edit"
                  disabled={busy}
                  onClick={() => {
                    reset();
                    setEditing(c);
                  }}
                >
                  <PencilIcon />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editing && (
        <EditCategory
          category={editing}
          transactionCount={count(editing)}
          others={categories.filter((c) => c.id !== editing.id)}
          groups={[...new Set(categories.map((c) => c.group_name).filter((g): g is string => Boolean(g)))]}
          onClose={() => setEditing(null)}
          onSaved={async (message) => {
            setNotice(message);
            setEditing(null);
            await load();
          }}
        />
      )}
    </>
  );
}
