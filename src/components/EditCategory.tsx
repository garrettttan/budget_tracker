import { useState } from 'react';
import { db } from '../lib/supabase';
import Button from './Button';
import Modal from './Modal';
import { strings } from '../lib/strings';

const t = strings.categories;
const common = strings.common;

export type EditableCategory = { id: string; name: string; group_name: string | null; is_income: boolean };

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

  const why = !name.trim() ? common.typeName : undefined;
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
    if (error) return fail(error.code === '23505' ? t.duplicate : error.message);
    await onSaved(common.saved(name.trim()));
  }

  async function remove() {
    setBusy(true);
    setError(null);
    const { error } = await db().rpc('delete_category', { p_id: category.id, p_into: into || null });
    if (error) return fail(error.message);
    const target = others.find((c) => c.id === into)?.name ?? common.uncategorized;
    await onSaved(needsTarget ? t.deletedInto(category.name, target) : common.deleted(category.name));
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
            <h2 id="edit-category-title">{t.deleteTitle(category.name)}</h2>
            {error && <p className="error" role="alert">{t.couldntDelete(error)}</p>}
            {needsTarget ? (
              <div className="fields single">
                <label>
                  {t.moveTo(transactionCount)}
                  <select value={into} autoFocus disabled={busy} onChange={(e) => setInto(e.target.value)}>
                    <option value="">{common.uncategorized}</option>
                    {others.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : (
              <p className="muted">{t.unused}</p>
            )}
            <div className="form-actions">
              <Button type="submit" variant="primary" disabled={busy}>
                {common.delete}
              </Button>
              <Button variant="link" disabled={busy} onClick={() => setDeleting(false)}>
                {common.back}
              </Button>
            </div>
          </form>
        ) : (
          <form onSubmit={save}>
            <h2 id="edit-category-title">{t.editTitle}</h2>
            {error && <p className="error" role="alert">{common.couldntSave(error)}</p>}
            <div className="fields single">
              <label>
                {common.name}
                <input type="text" value={name} autoFocus data-autofocus disabled={busy} onChange={(e) => setName(e.target.value)} />
              </label>
              <label>
                {common.group}
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
                {t.incomeCheckbox}
              </label>
            </div>
            <div className="form-actions">
              <Button type="submit" variant="primary" disabled={busy || Boolean(why)} title={why}>
                {common.save}
              </Button>
              <Button variant="link" disabled={busy} onClick={close}>
                {common.cancel}
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
                {t.deleteButton}
              </Button>
            </div>
          </form>
        )
      }
    </Modal>
  );
}
