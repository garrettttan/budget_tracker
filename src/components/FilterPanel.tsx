import { useState } from 'react';
import Button from './Button';
import Modal from './Modal';

type Item = { id: string; name: string };

/** Keys for the two category rows that aren't categories. */
export const NO_CATEGORY = 'none';
export const TRANSFER_KEY = 'transfer';

/**
 * "Filter" button and its modal: untick categories or tags to hide them.
 * Each change applies right away (the page behind updates), so Done only closes.
 */
export default function FilterPanel({
  categories,
  tags,
  hiddenCategories,
  hiddenTags,
  onChange,
}: {
  categories: Item[];
  tags: Item[];
  hiddenCategories: string[];
  hiddenTags: string[];
  onChange: (next: { categories: string[]; tags: string[] }) => void;
}) {
  const [open, setOpen] = useState(false);
  const count = hiddenCategories.length + hiddenTags.length;
  const categoryItems: Item[] = [
    ...categories,
    { id: NO_CATEGORY, name: 'No category yet' },
    { id: TRANSFER_KEY, name: 'Transfer' },
  ];
  const flip = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const checklist = (title: string, items: Item[], hidden: string[], toggle: (id: string) => void) => (
    <fieldset className="filter-list">
      <legend>{title}</legend>
      <ul>
        {items.map((it) => (
          <li key={it.id}>
            <label>
              <input type="checkbox" checked={!hidden.includes(it.id)} onChange={() => toggle(it.id)} />
              {it.name}
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );

  return (
    <>
      <Button size="small" className="filter-button" aria-pressed={count > 0} onClick={() => setOpen(true)}>
        {count ? `Filter · ${count} hidden` : 'Filter'}
      </Button>
      {open && (
        <Modal labelledBy="filter-title" className="modal-filter" onClose={() => setOpen(false)}>
          {(close) => (
            <>
              <div className="modal-head">
                <h2 id="filter-title">Filter</h2>
                <Button variant="icon" aria-label="Close" onClick={close}>
                  ×
                </Button>
              </div>
              <div className="filter-panel">
                {checklist('Categories', categoryItems, hiddenCategories, (id) =>
                  onChange({ categories: flip(hiddenCategories, id), tags: hiddenTags }),
                )}
                {tags.length > 0 &&
                  checklist('Tags', tags, hiddenTags, (id) => onChange({ categories: hiddenCategories, tags: flip(hiddenTags, id) }))}
              </div>
              <div className="form-actions">
                <Button variant="secondary" disabled={count === 0} title={count ? undefined : 'Nothing is hidden'} onClick={() => onChange({ categories: [], tags: [] })}>
                  Show all
                </Button>
                <Button variant="primary" className="push-right" onClick={close}>
                  Done
                </Button>
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
