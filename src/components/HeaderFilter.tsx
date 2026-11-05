import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import Button from './Button';

/** `count`: how many transactions have it in the current range, shown beside the name. */
type Item = { id: string; name: string; count?: number };

const WIDTH = 288; // 18rem
const GUTTER = 16;

/**
 * A column header that filters its column: tap it for a searchable checklist,
 * spreadsheet style. Everything is ticked (shown) by default; untick to hide.
 * "Select all" ticks or unticks whatever the search matches, and each row has
 * "Only". Closes on Esc or a tap outside; follows the header when the page scrolls.
 */
export default function HeaderFilter({
  label,
  items,
  hidden,
  onChange,
  onOnly,
  align = 'start',
  searchable = true,
  keepOne = false,
  children,
}: {
  label: string;
  items: Item[];
  /** ids unticked */
  hidden: string[];
  onChange: (hidden: string[]) => void;
  onOnly: (id: string) => void;
  /** which edge of the header the popover lines up with */
  align?: 'start' | 'end';
  /** false for a short list: no search box */
  searchable?: boolean;
  /** true where hiding everything makes no sense: the last ticked item can't be unticked */
  keepOne?: boolean;
  /** what the header shows, if not `label` */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; maxHeight: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const count = items.filter((i) => hidden.includes(i.id)).length;
  const typed = query.trim().toLowerCase();
  const matches = typed ? items.filter((i) => i.name.toLowerCase().includes(typed)) : items;
  const shownMatches = matches.filter((i) => !hidden.includes(i.id)).length;
  const allShown = matches.length > 0 && shownMatches === matches.length;
  const lastShown = keepOne && items.filter((i) => !hidden.includes(i.id)).length === 1;
  // with keepOne, unticking every match would hide everything
  const cantClearAll = keepOne && allShown && matches.length === items.length;

  function close(refocus = true) {
    setOpen(false);
    setQuery('');
    if (refocus) trigger.current?.focus();
  }

  // under the header (above it when there's more room there), kept inside the screen
  function place() {
    if (!trigger.current) return;
    const r = trigger.current.getBoundingClientRect();
    const width = Math.min(WIDTH, window.innerWidth - 2 * GUTTER);
    const wanted = align === 'end' ? r.right - width : r.left;
    const left = Math.max(GUTTER, Math.min(wanted, window.innerWidth - width - GUTTER));
    const below = window.innerHeight - r.bottom - 4 - GUTTER;
    const above = r.top - 4 - GUTTER;
    if (below >= 320 || below >= above) setPos({ top: r.bottom + 4, left, maxHeight: below });
    else setPos({ bottom: window.innerHeight - r.top + 4, left, maxHeight: above });
  }

  useLayoutEffect(() => {
    if (open) place();
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !trigger.current?.contains(t)) close(false);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close();
    // the page scrolling (e.g. a phone bringing the search box into view) moves it along
    const follow = (e: Event) => {
      if (!pop.current?.contains(e.target as Node)) place();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', follow);
    };
  }, [open]);

  const toggle = (id: string) => onChange(hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id]);
  const ids = matches.map((i) => i.id);
  const selectAll = () =>
    onChange(allShown ? [...new Set([...hidden, ...ids])] : hidden.filter((h) => !ids.includes(h)));

  return (
    <>
      <Button
        ref={trigger}
        variant="link"
        className={`th-filter${count ? ' active' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Filter ${label}${count ? ', filter on' : ''}`}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className="th-filter-label">{children ?? label}</span>
        {count > 0 && <span className="th-filter-dot" aria-hidden="true" />}
        <svg className="th-caret" viewBox="0 0 10 6" aria-hidden="true">
          <path d="M0.5 0.5h9L5 5.5z" />
        </svg>
      </Button>
      {open && (
        <div
          ref={pop}
          className="header-filter-pop"
          role="dialog"
          aria-labelledby={titleId}
          style={pos ? { ...pos, width: Math.min(WIDTH, window.innerWidth - 2 * GUTTER) } : { visibility: 'hidden' }}
        >
          <span id={titleId} className="visually-hidden">
            Filter {label}
          </span>
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
              disabled={matches.length === 0 || cantClearAll}
              title={cantClearAll ? 'At least one has to stay ticked' : undefined}
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
                    disabled={lastShown && !hidden.includes(i.id)}
                    title={lastShown && !hidden.includes(i.id) ? 'At least one has to stay ticked' : undefined}
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
                    close();
                  }}
                >
                  Only
                </Button>
              </li>
            ))}
            {matches.length === 0 && <li className="muted small">No matches.</li>}
          </ul>
          <div className="header-filter-foot">
            <Button
              variant="link"
              size="small"
              disabled={count === 0}
              title={count ? undefined : 'Nothing is hidden'}
              onClick={() => onChange([])}
            >
              Show all
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
