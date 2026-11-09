import { type ReactNode, useId, useState } from 'react';
import Button from './Button';
import { usePopover } from './usePopover';

/** `count`: how many transactions have it in the current range, shown beside the name. */
export type Item = { id: string; name: string; count?: number };

const WIDTH = 288; // 18rem

/** What decides a checklist's ticks; shared by the header popover and the phones' Filters sheet. */
export type ChecklistProps = {
  label: string;
  items: Item[];
  /** ids unticked */
  hidden: string[];
  onChange: (hidden: string[]) => void;
  onOnly: (id: string) => void;
  /** false for a short list: no search box */
  searchable?: boolean;
  /** true where hiding everything makes no sense: the last ticked item can't be unticked */
  keepOne?: boolean;
  /** at most this many ticked (Trends' lines: one per chart color); the rest can't be ticked */
  max?: number;
  /** a footer button (Trends' Clear or Reset); Spending's have none */
  reset?: { label: string; onClick: () => void; disabled: boolean; title?: string };
};

/** "Filter on": anything unticked, unless the caller says otherwise. */
export const checklistOn = (items: Item[], hidden: string[], active?: boolean) =>
  active ?? items.some((i) => hidden.includes(i.id));

/**
 * A column header that filters its column: tap it for a searchable checklist,
 * spreadsheet style (FilterChecklist). Closes on Esc or a tap outside; follows
 * the header when the page scrolls.
 */
export default function HeaderFilter({
  align = 'start',
  active,
  children,
  ...list
}: ChecklistProps & {
  /** which edge of the header the popover lines up with */
  align?: 'start' | 'end';
  /** the "filter on" look; defaults to "anything unticked" (for an opt-in list, say when something's ticked) */
  active?: boolean;
  /** what the header shows, if not `label` */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const { label } = list;
  const on = checklistOn(list.items, list.hidden, active);

  function close(refocus = true) {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  }

  const { trigger, pop, style } = usePopover({ open, width: WIDTH, align, onDismiss: close });

  return (
    <>
      <Button
        ref={trigger}
        variant="link"
        className={`th-filter${on ? ' active' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Filter ${label}${on ? ', filter on' : ''}`}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className="th-filter-label">{children ?? label}</span>
        <svg className="th-caret" viewBox="0 0 10 6" aria-hidden="true">
          <path d="M0.5 0.5h9L5 5.5z" />
        </svg>
      </Button>
      {open && (
        <div ref={pop} className="header-filter-pop" role="dialog" aria-labelledby={titleId} style={style}>
          <span id={titleId} className="visually-hidden">
            Filter {label}
          </span>
          <FilterChecklist {...list} onDone={close} />
        </div>
      )}
    </>
  );
}

/**
 * The checklist itself. Everything is ticked (shown) by default; untick to
 * hide. "Select all" ticks or unticks whatever the search matches, and each
 * row has "Only" (which then calls `onDone`).
 */
export function FilterChecklist({
  label,
  items,
  hidden,
  onChange,
  onOnly,
  searchable = true,
  keepOne = false,
  max,
  reset,
  onDone,
}: ChecklistProps & { onDone: () => void }) {
  const [query, setQuery] = useState('');
  const typed = query.trim().toLowerCase();
  const matches = typed ? items.filter((i) => i.name.toLowerCase().includes(typed)) : items;
  const shownMatches = matches.filter((i) => !hidden.includes(i.id)).length;
  const allShown = matches.length > 0 && shownMatches === matches.length;
  const lastShown = keepOne && items.filter((i) => !hidden.includes(i.id)).length === 1;
  // with keepOne, unticking every match would hide everything
  const cantClearAll = keepOne && allShown && matches.length === items.length;
  const ticked = items.filter((i) => !hidden.includes(i.id)).length;
  const full = max !== undefined && ticked >= max;
  // ticking every match would pass max
  const cantSelectAll = max !== undefined && !allShown && ticked + (matches.length - shownMatches) > max;
  const lockedOut = (id: string) => full && hidden.includes(id);

  const toggle = (id: string) => onChange(hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id]);
  const ids = matches.map((i) => i.id);
  const selectAll = () =>
    onChange(allShown ? [...new Set([...hidden, ...ids])] : hidden.filter((h) => !ids.includes(h)));

  return (
    <>
      {searchable && (
        <input
          type="search"
          className="header-filter-search"
          placeholder={`Search ${label.toLowerCase()}`}
          aria-label={`Search ${label.toLowerCase()}`}
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      <label className="header-filter-all">
        {/* without a search box, focus lands here */}
        <input
          type="checkbox"
          autoFocus={!searchable}
          checked={allShown}
          disabled={matches.length === 0 || cantClearAll || cantSelectAll}
          title={cantClearAll ? 'At least one has to stay ticked' : cantSelectAll ? `Up to ${max} at a time` : undefined}
          ref={(el) => {
            if (el) el.indeterminate = shownMatches > 0 && !allShown;
          }}
          onChange={selectAll}
        />
        {typed ? 'Select all matches' : 'Select all'}
      </label>
      <ul className="header-filter-list">
        {matches.map((i) => (
          <li key={i.id}>
            <label>
              <input
                type="checkbox"
                checked={!hidden.includes(i.id)}
                disabled={(lastShown && !hidden.includes(i.id)) || lockedOut(i.id)}
                title={
                  lastShown && !hidden.includes(i.id)
                    ? 'At least one has to stay ticked'
                    : lockedOut(i.id)
                      ? `Up to ${max} at a time`
                      : undefined
                }
                onChange={() => toggle(i.id)}
              />
              <span>{i.name}</span>
              {i.count !== undefined && <span className="header-filter-count">{i.count}</span>}
            </label>
            <Button
              variant="link"
              size="small"
              className="header-filter-only"
              aria-label={`Only ${i.name}`}
              onClick={() => {
                onOnly(i.id);
                onDone();
              }}
            >
              Only
            </Button>
          </li>
        ))}
        {matches.length === 0 && <li className="muted small">No matches.</li>}
      </ul>
      {reset && (
        <div className="header-filter-foot">
          <Button variant="link" size="small" disabled={reset.disabled} title={reset.title} onClick={reset.onClick}>
            {reset.label}
          </Button>
        </div>
      )}
    </>
  );
}
