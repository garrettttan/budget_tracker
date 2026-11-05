import { useState } from 'react';
import { db } from '../lib/supabase';
import Button from './Button';
import Modal from './Modal';

export type EditableCategory = { id: string; name: string; group_name: string | null; is_income: boolean };

const plural = (n: number) => `${n} ${n === 1 ? 'transaction' : 'transactions'}`;

/**
 * Edit one category in a modal: name, group, and whether it's income (income
 * categories are left out of spending and count as income in cash flow).
 * Delete moves its transactions and merchant memory to another category, or
 * leaves them Uncategorized (`delete_category`).
 */
export default function EditCategory({
  category,
  transactionCount,
  others,
  groups,
  onClose,
  onSaved,
}: {
  category: EditableCategory;
  transactionCount: number;
  others: EditableCategory[];
  groups: string[];
  onClose: () => void;
  onSaved: (notice: string) => Promise<void>;
}) {
  const [name, setName] = useState(category.name);
  const [group, setGroup] = useState(category.group_name ?? '');
  const [income, setIncome] = useState(category.is_income);
  const [deleting, setDeleting] = useState(false);
  const [into, setInto] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const why = !name.trim() ? 'Type a name first' : undefined;
  const needsTarget = transactionCount > 0;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (why) return;
    const changes: Record<string, unknown> = {};
    if (name.trim() !== category.name) changes.name = name.trim();
    if ((group.trim() || null) !== category.group_name) changes.group_name = group.trim() || null;
    if (income !== category.is_income) changes.is_income = income;
    if (Object.keys(changes).length === 0) return onClose();

    setBusy(true);
    setError(null);
    const { error } = await db().from('categories').update(changes).eq('id', category.id);
    if (error) return fail(error.code === '23505' ? 'You already have a category with that name.' : error.message);
    await onSaved(`Saved ${name.trim()}.`);
  }

  async function remove() {
    setBusy(true);
    setError(null);
    const { error } = await db().rpc('delete_category', { p_id: category.id, p_into: into || null });
    if (error) return fail(error.message);
    const target = others.find((c) => c.id === into)?.name ?? 'Uncategorized';
    await onSaved(needsTarget ? `Deleted ${category.name}; its transactions are now ${target}.` : `Deleted ${category.name}.`);
  }

  function fail(message: string) {
    setError(message);
    setBusy(false);
  }

  return (
    <Modal labelledBy="edit-category-title" busy={busy} onClose={onClose}>
      {(close) =>
        deleting ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              remove();
            }}
          >
            <h2 id="edit-category-title">Delete {category.name}?</h2>
            {error && <p className="error" role="alert">Couldn’t delete: {error}</p>}
            {needsTarget ? (
              <div className="fields single">
                <label>
                  Move its {plural(transactionCount)} to
                  <select value={into} autoFocus disabled={busy} onChange={(e) => setInto(e.target.value)}>
                    <option value="">Uncategorized</option>
                    {others.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : (
              <p className="muted">No transactions use it.</p>
            )}
            <div className="form-actions">
              <Button
                type="submit"
                variant="primary"
                disabled={busy}
              >
                Delete
              </Button>
              <Button variant="link" disabled={busy} onClick={() => setDeleting(false)}>
                Back
              </Button>
            </div>
          </form>
        ) : (
          <form onSubmit={save}>
            <h2 id="edit-category-title">Edit category</h2>
            {error && <p className="error" role="alert">Couldn’t save: {error}</p>}
            <div className="fields single">
              <label>
                Name
                <input type="text" value={name} autoFocus disabled={busy} onChange={(e) => setName(e.target.value)} />
              </label>
              <label>
                Group
                <input
                  type="text"
                  list="category-groups"
                  value={group}
                  disabled={busy}
                  onChange={(e) => setGroup(e.target.value)}
                />
                <datalist id="category-groups">
                  {groups.map((g) => (
                    <option key={g} value={g} />
                  ))}
                </datalist>
              </label>
              <label className="checkbox-field">
                <input type="checkbox" checked={income} disabled={busy} onChange={(e) => setIncome(e.target.checked)} />
                Income (not spending)
              </label>
            </div>
            <div className="form-actions">
              <Button type="submit" variant="primary" disabled={busy || Boolean(why)} title={why}>
                Save
              </Button>
              <Button variant="link" disabled={busy} onClick={close}>
                Cancel
              </Button>
              <Button
                variant="link"
                className="danger push-right"
                disabled={busy}
                onClick={() => {
                  setError(null);
                  setDeleting(true);
                }}
              >
                Delete category
              </Button>
            </div>
          </form>
        )
      }
    </Modal>
  );
}
