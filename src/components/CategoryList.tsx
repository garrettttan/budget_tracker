import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../lib/supabase';
import { byUse, usageCount as count } from '../lib/categoryOrder';
import Button from './Button';
import EditCategory, { type EditableCategory } from './EditCategory';
import PencilIcon from './PencilIcon';

type CategoryRow = EditableCategory & { transactions: { count: number }[] };

/**
 * Settings → Categories: add, and edit or delete in a modal. Listed most-used
 * first (then A–Z), the order every category picker uses (lib/categoryOrder).
 */
export default function CategoryList() {
  const [categories, setCategories] = useState<CategoryRow[] | null>(null);
  const [newName, setNewName] = useState('');
  const [filter, setFilter] = useState('');
  const [adding, setAdding] = useState(false); // the name box shows only after Add category
  const [editing, setEditing] = useState<CategoryRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await db()
      .from('categories')
      .select('id, name, group_name, is_income, transactions(count)')
      .eq('archived', false);
    if (error) setError(error.message);
    else setCategories(byUse((data ?? []) as unknown as CategoryRow[]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** Clears the last message before a new action. */
  function reset() {
    setError(null);
    setNotice(null);
  }

  async function add() {
    const name = newName.trim();
    setBusy(true);
    reset();
    const { error } = await db().from('categories').insert({ name });
    if (error) setError(error.code === '23505' ? 'You already have a category with that name.' : error.message);
    else {
      setNewName('');
      setAdding(false);
      setNotice(`Added ${name}.`);
    }
    await load();
    setBusy(false);
  }

  if (!categories) return null;
  const typed = filter.trim().toLowerCase();
  const shown = typed
    ? categories.filter((c) => c.name.toLowerCase().includes(typed) || c.group_name?.toLowerCase().includes(typed))
    : categories;

  return (
    <>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      {/* search on the left, add on the right (stacked on phones) */}
      <div className="list-tools">
        <input
          type="search"
          className="merchant-filter"
          placeholder="Find a category"
          aria-label="Find a category"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {adding ? (
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
              autoFocus
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                // Esc closes just this box, not the modal around it
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setAdding(false);
                  setNewName('');
                }
              }}
            />
            <Button
              type="submit"
              size="small"
              disabled={busy || !newName.trim()}
              title={newName.trim() ? undefined : 'Type a name first'}
            >
              Add
            </Button>
            <Button
              size="small"
              variant="link"
              disabled={busy}
              onClick={() => {
                setAdding(false);
                setNewName('');
              }}
            >
              Cancel
            </Button>
          </form>
        ) : (
          <Button
            size="small"
            onClick={() => {
              reset();
              setAdding(true);
            }}
          >
            Add category
          </Button>
        )}
      </div>

      <table className="register categories">
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col">Group</th>
            <th scope="col" className="num">
              Transactions
            </th>
            <th scope="col">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map((c) => (
            <tr key={c.id}>
              <td>
                {c.name}
                {c.is_income && <span className="account-sub">Income</span>}
              </td>
              <td>{c.group_name ?? <span className="muted">None</span>}</td>
              <td className="num">
                {count(c) > 0 ? (
                  <Link to={`/spending?status=all&category=${c.id}`} title={`Show ${c.name} transactions`}>
                    {count(c)}
                  </Link>
                ) : (
                  0
                )}
              </td>
              <td className="action">
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
      {shown.length === 0 && <p className="muted">No category matches "{filter}".</p>}

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
