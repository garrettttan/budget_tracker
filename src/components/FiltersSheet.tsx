import { useId, useRef, useState } from 'react';
import Button from './Button';
import Collapse, { COLLAPSE_MS } from './Collapse';
import { type ChecklistProps, FilterChecklist } from './HeaderFilter';
import { type FieldsProps, FieldsForm } from './HeaderFields';
import Modal from './Modal';

/** One column's filter, as Spending's headers have it (its label names the row), plus a short state for the sheet's row. */
export type SheetFilter = { key: string; on: boolean; summary: string } & (
  | { kind: 'checklist'; props: ChecklistProps }
  | { kind: 'fields'; props: FieldsProps }
);

/**
 * Phones: every column's filter in one place, since the narrow table hides
 * some columns (Date, Account). A "Filters" button opens a sheet listing each
 * filter with its state; tapping one opens the same checklist or form as its
 * column header, in place. Changes apply as they're made.
 *
 * One section is open at a time: opening another slides the first shut as it
 * slides open. The sheet sits at the top of the screen, so it grows and shrinks
 * downward instead of re-centering (only a section closing above the tapped
 * row moves it, in one glide). A section opening below the fold is scrolled
 * into view once it has slid open.
 */
export default function FiltersSheet({ filters, onShowAll }: { filters: SheetFilter[]; onShowAll: () => void }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const items = useRef(new Map<string, HTMLLIElement>());
  const titleId = useId();

  const shut = (key: string) => setExpanded((prev) => (prev === key ? null : prev));
  function toggle(key: string) {
    if (expanded === key) return setExpanded(null);
    setExpanded(key);
    window.setTimeout(() => {
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      items.current.get(key)?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
    }, COLLAPSE_MS);
  }
  const count = filters.filter((f) => f.on).length;

  return (
    <>
      <Button variant="link" className="phone-only filters-button" onClick={() => setOpen(true)}>
        {count ? `Filters (${count})` : 'Filters'}
      </Button>
      {open && (
        <Modal
          labelledBy={titleId}
          className="filters-sheet"
          onClose={() => {
            setOpen(false);
            setExpanded(null);
          }}
        >
          {(close) => (
            <>
              <div className="modal-head">
                <h2 id={titleId}>Filters</h2>
                <Button variant="icon" aria-label="Close" onClick={close}>
                  ×
                </Button>
              </div>
              <ul className="sheet-filters">
                {filters.map((f) => {
                  const isOpen = expanded === f.key;
                  return (
                    <li
                      key={f.key}
                      ref={(el) => {
                        if (el) items.current.set(f.key, el);
                        else items.current.delete(f.key);
                      }}
                    >
                      <Button
                        variant="link"
                        className="sheet-filter-row"
                        aria-expanded={isOpen}
                        onClick={() => toggle(f.key)}
                      >
                        <span className="sheet-filter-label">{f.props.label}</span>
                        <span className={f.on ? 'sheet-filter-summary on' : 'sheet-filter-summary'}>{f.summary}</span>
                        <svg className="sheet-chevron" viewBox="0 0 6 10" aria-hidden="true">
                          <path d="M1 1l4 4-4 4" />
                        </svg>
                      </Button>
                      <Collapse open={isOpen}>
                        <div className="sheet-filter-body">
                          {f.kind === 'checklist' ? (
                            <FilterChecklist {...f.props} onDone={() => shut(f.key)} />
                          ) : (
                            <FieldsForm {...f.props} onDone={() => shut(f.key)} />
                          )}
                        </div>
                      </Collapse>
                    </li>
                  );
                })}
              </ul>
              <div className="sheet-foot">
                <Button variant="secondary" disabled={count === 0} title={count ? undefined : 'No filters are on'} onClick={onShowAll}>
                  Show all
                </Button>
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
